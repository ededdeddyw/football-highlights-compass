// ============================================================================
// U-NEXT フットボール（@UNEXT_football）のプレミアリーグ公式ショートハイライトを
// 取得して data/league-pl-<season>.json の各試合に videoId を突合して埋めるスクリプト。
//
// ★ なぜ「あなたの日本の端末」で実行するのか
//   U-NEXTのハイライトは日本限定公開。GitHub Actions（米国サーバ）からは動画が
//   一切見えない（実証済み：チャンネルページは開けるが動画0件）。日本のあなたの端末
//   なら普通に見えるので、ここで取得すればVPN無しで確実に拾える。
//
// ★ 誤リンク防止（突合の担保）
//   U-NEXTのタイトル「【HOME v AWAY｜ショートハイライト】プレミアリーグ2026/27 第N節」
//   から HOME/AWAY・節・シーズンを取り出し、既存の日程表データ（home/away/matchday/
//   season）と一致した試合にだけ videoId を入れる。両チーム名＋（あれば）節番号＋
//   現行シーズンが揃わないと採用しない。
//
// ★ 使い方（Node 18以降が必要。リポジトリのルートで実行）
//   node scripts/fetch-unext-pl.mjs                # プレミアリーグ（既定）を更新
//   node scripts/fetch-unext-pl.mjs --league=cl    # チャンピオンズリーグを更新（配信元は自動でWOWOW @wowowsoccer）
//   node scripts/fetch-unext-pl.mjs --league=j1    # J1リーグ（DAZN @DAZNJapan）。日程APIが無いため
//                                                  # ハイライトのタイトルから試合を生成する（動画ファースト）。
//   node scripts/fetch-unext-pl.mjs --league=j2    # J2リーグ（DAZN @DAZNJapan・動画ファースト）
//   node scripts/fetch-unext-pl.mjs --league=j3    # J3リーグ（DAZN @DAZNJapan・動画ファースト）
//   node scripts/fetch-unext-pl.mjs --league=belgium # ベルギー・プロリーグ（DAZN @DAZNJapan・日本人選手多数）
//   node scripts/fetch-unext-pl.mjs --league=nations # UEFAネーションズリーグ（DAZN @DAZNJapan・代表）
//   ※環境変数 YOUTUBE_API_KEY を設定すると YouTube Data API v3（無料枠）で取得する。
//     APIはconsent画面に当たらないため、クラウド/GitHub Actions でも確実に取得できる（自動更新の要）。
//     未設定時は従来のWebスクレイプにフォールバック（ローカル実行向け）。
//   node scripts/fetch-unext-pl.mjs --season=2026  # シーズン開始年を明示（2026=2026/27）
//   ※動画ファーストは取得0件のとき既存データを保護（空で上書きしない）。意図的に空へ戻すときだけ --force。
//   node scripts/fetch-unext-pl.mjs --dry-run      # 書き込まず結果だけ表示（まず --dry-run で候補数を確認）
//   node scripts/fetch-unext-pl.mjs --purge        # U-NEXTで拾えなかった既存videoIdを消す（初回の掃除用）
//   ※チャンネル取得は全リーグ横断。候補0本時は「チャンネル内のリーグ別本数」を表示するので、
//     U-NEXTがそのリーグ（例: cl）を配信しているかを判断できます。
//   ※既定では既存videoIdは消しません（過去に埋めたU-NEXT動画を守るため）。初回の掃除だけ --purge を付けてください。
//   ※試合の finished 状態は問いません（ハイライトがある＝実施済み。スコアは次回のリーグ取得で自動で埋まります）。
//   実行後: git add data/league-pl-*.json && git commit && git push で本番に反映されます。
// ============================================================================
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const FORCE = args.includes('--force');   // 動画ファーストで取得0件でも既存を上書きする（安全ガード解除）
const KEEP = args.includes('--keep-existing');   // 後方互換（既定でクリアしなくなったため実質no-op）
const PURGE = args.includes('--purge') && !KEEP; // U-NEXTで拾えなかった既存videoId（NBC等）を消す。既定はOFF（消さない）
const SEASON_ARG = (args.find(a => a.startsWith('--season=')) || '').split('=')[1] || '';
// 対象リーグ（既定 pl）。例: --league=cl でチャンピオンズリーグ。データは data/league-<LEAGUE>-<season>.json。
const LEAGUE_ARG = ((args.find(a => a.startsWith('--league=')) || '').split('=')[1] || 'pl').toLowerCase();
const LEAGUE_JP = { pl:'プレミアリーグ', laliga:'ラ・リーガ', sa:'セリエA', bl:'ブンデスリーガ', ligue1:'リーグアン', cl:'チャンピオンズリーグ', eredivisie:'エールディヴィジ', j1:'J1リーグ', j2:'J2リーグ', j3:'J3リーグ', belgium:'ベルギー・プロリーグ', nations:'UEFAネーションズリーグ' };
// 動画ファースト（日程APIが無いリーグ）：DAZN等のハイライト・タイトルから試合を生成する。
const VIDEO_FIRST = new Set(['j1', 'j2', 'j3', 'belgium', 'nations']);
// Jリーグ（J1/J2/J3）クラブ 日本語名→URLスラッグ（長いキー優先の包含マッチで表記ゆれを吸収）。
// 全クラブを1表にまとめる（tier非依存）。J2/J3の試合ハイライトでも同じ表からスラッグを付ける。
const J1_SLUGS = [
  ['北海道コンサドーレ札幌','sapporo'],['コンサドーレ札幌','sapporo'],['鹿島アントラーズ','kashima'],['浦和レッズ','urawa'],
  ['柏レイソル','kashiwa'],['FC東京','fc-tokyo'],['東京ヴェルディ','tokyo-verdy'],['FC町田ゼルビア','machida'],['町田ゼルビア','machida'],
  ['川崎フロンターレ','kawasaki'],['横浜F・マリノス','yokohama-fm'],['横浜FC','yokohama-fc'],['湘南ベルマーレ','shonan'],
  ['アルビレックス新潟','niigata'],['名古屋グランパス','nagoya'],['ジュビロ磐田','iwata'],['清水エスパルス','shimizu'],
  ['京都サンガ','kyoto'],['ガンバ大阪','gamba-osaka'],['セレッソ大阪','cerezo-osaka'],['ヴィッセル神戸','kobe'],
  ['サンフレッチェ広島','hiroshima'],['アビスパ福岡','fukuoka'],['サガン鳥栖','tosu'],['ファジアーノ岡山','okayama'],
  ['V・ファーレン長崎','nagasaki'],['ヴァンフォーレ甲府','kofu'],['ジェフユナイテッド千葉','chiba'],['ジェフ千葉','chiba'],
  ['大分トリニータ','oita'],['モンテディオ山形','yamagata'],['水戸ホーリーホック','mito'],['いわきFC','iwaki'],
  ['ロアッソ熊本','kumamoto'],['レノファ山口','yamaguchi'],['徳島ヴォルティス','tokushima'],['ザスパ群馬','gunma'],
  ['ブラウブリッツ秋田','akita'],['藤枝MYFC','fujieda'],['愛媛FC','ehime'],['RB大宮アルディージャ','omiya'],['大宮アルディージャ','omiya'],
  // --- J2で見かけるクラブ ---
  ['ベガルタ仙台','sendai'],['栃木SC','tochigi'],['カターレ富山','toyama'],['鹿児島ユナイテッド','kagoshima'],
  ['ジェフユナイテッド市原・千葉','chiba'],['東京ヴェルディ1969','tokyo-verdy'],['ザスパクサツ群馬','gunma'],
  ['ツエーゲン金沢','kanazawa'],['FC岐阜','gifu'],['ファジアーノ岡山ネクスト','okayama'],['大分','oita'],
  // --- J3で見かけるクラブ ---
  ['ヴァンラーレ八戸','hachinohe'],['いわてグルージャ盛岡','iwate'],['福島ユナイテッド','fukushima'],
  ['Y.S.C.C.横浜','yscc'],['YSCC横浜','yscc'],['SC相模原','sagamihara'],['松本山雅','matsumoto'],
  ['AC長野パルセイロ','nagano'],['長野パルセイロ','nagano'],['アスルクラロ沼津','numazu'],['ガイナーレ鳥取','tottori'],
  ['カマタマーレ讃岐','sanuki'],['FC今治','imabari'],['ギラヴァンツ北九州','kitakyushu'],['テゲバジャーロ宮崎','miyazaki'],
  ['FC琉球','ryukyu'],['奈良クラブ','nara'],['栃木シティ','tochigi-city'],['高知ユナイテッド','kochi'],
  ['アトレチコ鈴鹿','suzuka'],['鈴鹿ポイントゲッターズ','suzuka'],
  // --- ベルギー・プロリーグ（表記ゆれ・略称も網羅） ---
  ['クラブ・ブルッヘ','club-brugge'],['クルブ・ブルッヘ','club-brugge'],['セルクル・ブルッヘ','cercle-brugge'],
  ['KRCヘンク','genk'],['ヘンク','genk'],['ロイヤル・アントワープ','antwerp'],['アントワープ','antwerp'],
  ['ユニオン・サン・ジロワーズ','union-sg'],['ユニオン・サン=ジロワーズ','union-sg'],['ユニオン・サン＝ジロワーズ','union-sg'],['ユニオンSG','union-sg'],
  ['シント＝トロイデン','sint-truiden'],['シント=トロイデン','sint-truiden'],['シントトロイデン','sint-truiden'],['STVV','sint-truiden'],
  ['ウェステルロー','westerlo'],['RSCアンデルレヒト','anderlecht'],['アンデルレヒト','anderlecht'],
  ['KAAヘント','gent'],['ヘント','gent'],['スタンダール・リエージュ','standard-liege'],['スタンダール','standard-liege'],
  ['シャルルロワ','charleroi'],['OHルーヴェン','oh-leuven'],['ルーヴェン','oh-leuven'],
  ['KVメヘレン','mechelen'],['メヘレン','mechelen'],['デンデル','dender'],['ラ・ルヴィエール','la-louviere'],
  ['ズルテ・ワレヘム','zulte-waregem'],['ズルテ・ヴァレヘム','zulte-waregem'],['RWDモランベーク','rwdm'],
  ['ベフェレン','beveren'],['SKベフェレン','beveren'],
  // --- UEFAネーションズリーグ（代表）。※長い名称を先に（北アイルランド>アイルランド等の誤マッチ回避＝最長一致） ---
  ['北アイルランド','northern-ireland'],['北マケドニア','north-macedonia'],['ボスニア・ヘルツェゴビナ','bosnia'],
  ['ポルトガル','portugal'],['ウェールズ','wales'],['スペイン','spain'],['フランス','france'],['ドイツ','germany'],
  ['イングランド','england'],['イタリア','italy'],['オランダ','netherlands'],['ベルギー','belgium'],['クロアチア','croatia'],
  ['デンマーク','denmark'],['スイス','switzerland'],['ポーランド','poland'],['ハンガリー','hungary'],['オーストリア','austria'],
  ['スコットランド','scotland'],['セルビア','serbia'],['チェコ','czech'],['トルコ','turkey'],['ウクライナ','ukraine'],
  ['スウェーデン','sweden'],['ノルウェー','norway'],['アイルランド','ireland'],['ギリシャ','greece'],['ルーマニア','romania'],
  ['スロベニア','slovenia'],['スロヴェニア','slovenia'],['スロバキア','slovakia'],['スロヴァキア','slovakia'],['フィンランド','finland'],
  ['アイスランド','iceland'],['ジョージア','georgia'],['アルバニア','albania'],['モンテネグロ','montenegro'],['ブルガリア','bulgaria'],
  ['イスラエル','israel'],['コソボ','kosovo'],['アルメニア','armenia'],['アゼルバイジャン','azerbaijan'],['キプロス','cyprus'],
  ['ルクセンブルク','luxembourg'],['カザフスタン','kazakhstan'],['ベラルーシ','belarus'],['エストニア','estonia'],['ラトビア','latvia'],['リトアニア','lithuania'],['モルドバ','moldova'],['マルタ','malta'],
];
const LG_LABEL = LEAGUE_JP[LEAGUE_ARG] || LEAGUE_ARG;
// リーグごとの配信元チャンネル（日本で視聴可能な公式ハイライトを出しているYouTubeチャンネル）。
//   PL/ラ・リーガ/エールディビジ: U-NEXT（@UNEXT_football）
//   CL: WOWOW（@wowowsoccer、2026-27 日本独占。各試合の3分ハイライトを無料公開）
const CHANNELS = {
  pl:         { handle: '@UNEXT_football', author: 'unext' },
  laliga:     { handle: '@UNEXT_football', author: 'unext' },
  eredivisie: { handle: '@UNEXT_football', author: 'unext' },
  sa:         { handle: '@DAZNJapan',      author: 'dazn' },   // セリエA（DAZN Japanが配信・ハイライト投稿）
  bl:         { handle: '@DAZNJapan',      author: 'dazn' },   // ブンデスリーガ（DAZN Japan）
  ligue1:     { handle: '@DAZNJapan',      author: 'dazn' },   // リーグアン（DAZN Japan）
  cl:         { handle: '@wowowsoccer',    author: 'wowow' },
  j1:         { handle: '@DAZNJapan',      author: 'dazn' },   // JリーグJ1（DAZN Japan公式）
  j2:         { handle: '@DAZNJapan',      author: 'dazn' },   // JリーグJ2（DAZN Japan公式）
  j3:         { handle: '@DAZNJapan',      author: 'dazn' },   // JリーグJ3（DAZN Japan公式）
  belgium:    { handle: '@DAZNJapan',      author: 'dazn' },   // ベルギー・プロリーグ（DAZN Japan公式）
  nations:    { handle: '@DAZNJapan',      author: 'dazn' },   // UEFAネーションズリーグ（DAZN Japan公式・代表）
};
const CH = CHANNELS[LEAGUE_ARG] || CHANNELS.pl;
const HANDLE = (args.find(a => a.startsWith('--channel=')) || '').split('=')[1] || CH.handle;   // 配信元チャンネル（--channel=@handle で上書き可）
const AUTHOR_TOKEN = ((args.find(a => a.startsWith('--author=')) || '').split('=')[1] || CH.author).toLowerCase();  // 投稿者名に含むべき語（関連動画を除外）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 現行シーズン開始年（欧州は7月以降を新シーズン扱い）。--season 指定があればそれ。
const now = new Date();
const CUR_START = SEASON_ARG ? +SEASON_ARG : ((now.getUTCMonth() + 1) >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);

// ---- 正規化・チーム名突合（watch-league と同じ考え方。日本語名も含めて畳む）----
const ALIASES = (() => { try { return JSON.parse(readFileSync('data/league-team-aliases.json', 'utf8')); } catch { return {}; } })();
const fold = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const nsp = s => fold(s).toLowerCase().replace(/[\s\-・･‐-―.,'’`｜|()（）]/g, '');  // ASCIIハイフン(U+002D)も除去（U-NEXT → unext）
const variants = ja => [ja, ...(ALIASES[ja] || [])].map(nsp).filter(v => v.length >= 2);
// トークン（U-NEXTタイトル中のチーム表記）が、日程表のチーム ja に一致するか（部分一致・双方向）
const teamMatch = (ja, token) => { const t = nsp(token); if (!t) return false; return variants(ja).some(v => t === v || t.includes(v) || v.includes(t)); };

// ---- YouTube: チャンネル投稿一覧を取得（構造非依存：正規表現でvideoId抽出→oembedでタイトル取得）----
// ページのJSON構造は頻繁に変わるため、videoIdは正規表現で拾い、タイトルは各動画のoembedで確実に取る。
const HDRS = { 'user-agent': UA, 'accept-language': 'ja-JP,ja;q=0.9,en;q=0.5', 'cookie': 'SOCS=CAISNQgDEitib3; CONSENT=YES+1' };
const grabIds = txt => { const seen = new Set(), out = []; for (const m of (txt || '').matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); } return out; };
async function oembed(id) {
  try { const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`); if (!r.ok) return null; const j = await r.json(); return { title: j.title || '', author: j.author_name || '' }; } catch { return null; }
}
// ---- YouTube Data API v3 経由の取得（推奨）----
// 無料枠（1日1万ユニット）で十分。APIなのでconsent画面に当たらず、クラウド/CIから確実に取得できる。
// YOUTUBE_API_KEY があればこちらを使い、無ければ従来のスクレイプにフォールバックする。
const API_KEY = process.env.YOUTUBE_API_KEY || '';
async function channelVideosApi(handle) {
  const h = handle.startsWith('@') ? handle : '@' + handle;
  // 1) ハンドル→アップロード用プレイリストID
  const cr = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet&forHandle=${encodeURIComponent(h)}&key=${API_KEY}`);
  if (!cr.ok) throw new Error(`channels.list HTTP ${cr.status}`);
  const cj = await cr.json();
  const ch = (cj.items || [])[0];
  if (!ch) throw new Error(`チャンネルが見つかりません: ${h}`);
  const uploads = ch.contentDetails.relatedPlaylists.uploads;
  const author = (ch.snippet && ch.snippet.title) || '';
  // 2) アップロード一覧をページング取得（最大約250本）
  const out = []; let pageToken = '', pages = 0;
  while (pages < 5) {
    pages++;
    const u = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploads}&maxResults=50&key=${API_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const r = await fetch(u);
    if (!r.ok) throw new Error(`playlistItems.list HTTP ${r.status}`);
    const j = await r.json();
    for (const it of (j.items || [])) {
      const s = it.snippet || {}; const vid = s.resourceId && s.resourceId.videoId;
      if (vid && s.title && s.title !== 'Private video' && s.title !== 'Deleted video') out.push({ id: vid, title: s.title, author: s.channelTitle || author });
    }
    pageToken = j.nextPageToken || '';
    if (!pageToken) break;
  }
  console.log(`  [診断] YouTube Data API 取得: チャンネル ${author} / 動画 ${out.length}件`);
  return out;
}
async function channelVideos() {
  if (API_KEY) {
    try { return await channelVideosApi(HANDLE); }
    catch (e) { console.error(`  ⚠ API取得失敗（${e.message}）→ スクレイプにフォールバック`); }
  }
  const r = await fetch(`https://www.youtube.com/${HANDLE}/videos?hl=ja&gl=JP`, { headers: HDRS });
  const html = r.ok ? await r.text() : '';
  const idset = new Set(grabIds(html));
  console.log(`  [診断] チャンネル取得: HTTP ${r.status} / ページ長 ${html.length} / ytInitialData ${html.includes('ytInitialData') ? 'あり' : 'なし'} / 抽出videoId ${idset.size}件`);
  const key = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
  const ver = (html.match(/"clientVersion":"([^"]+)"/) || [])[1] || '2.20240101.00.00';
  let token = (html.match(/"continuationCommand":\{"token":"([^"]+)"/) || [])[1], pages = 0;
  while (token && key && pages < 6 && idset.size < 200) {
    pages++;
    const cr = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${key}&prettyPrint=false`, {
      method: 'POST', headers: { ...HDRS, 'content-type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: ver, hl: 'ja', gl: 'JP' } }, continuation: token })
    });
    if (!cr.ok) break;
    const ct = await cr.text();
    const before = idset.size; for (const id of grabIds(ct)) idset.add(id);
    token = (ct.match(/"continuationCommand":\{"token":"([^"]+)"/) || [])[1];
    if (idset.size === before) break;
    await new Promise(r => setTimeout(r, 400));
  }
  // 各videoIdのタイトルを oembed で取得（構造変化に強い）
  const out = [];
  for (const id of idset) { const t = await oembed(id); if (t) out.push({ id, title: t.title, author: t.author }); await new Promise(r => setTimeout(r, 90)); }
  return out;
}

// ---- タイトル解析：実タイトル例「【<煽り文>｜HOME v AWAY｜ショートハイライト】プレミアリーグ2026/27 第N節」----
// U-NEXTは複数リーグを同一チャンネルで配信するため、リーグ判定→プレミアだけ採用する。
function detectLeague(t) {
  if (/女子|women/i.test(t)) return null;   // 女子CL等は対象外（男子リーグの日程表に無い）
  if (/ネーションズリーグ|nations\s*league/i.test(t)) return 'nations';   // UEFAネーションズリーグ（代表・DAZN Japan）
  if (/明治安田J1|J1リーグ|J1\s*LEAGUE/i.test(t)) return 'j1';   // JリーグJ1（DAZN Japan）
  if (/明治安田J2|J2リーグ|J2\s*LEAGUE/i.test(t)) return 'j2';   // JリーグJ2（DAZN Japan）
  if (/明治安田J3|J3リーグ|J3\s*LEAGUE/i.test(t)) return 'j3';   // JリーグJ3（DAZN Japan）
  if (/チャンピオンズリーグ|champions\s*league|UEFA\s*CL|欧州CL|ＵＥＦＡ/i.test(t)) return 'cl';
  if (/プレミアリーグ|premier\s*league/i.test(t)) return 'pl';
  if (/ラ・?リーガ|la\s*liga/i.test(t)) return 'laliga';
  if (/セリエ\s*a|serie\s*a/i.test(t)) return 'sa';
  if (/ブンデスリーガ|bundesliga/i.test(t)) return 'bl';
  if (/リーグ\s*アン|ligue\s*1/i.test(t)) return 'ligue1';
  if (/エールディヴィジ|eredivisie/i.test(t)) return 'eredivisie';
  if (/ベルギーリーグ|ジュピラー|jupiler|belgian\s*pro\s*league|pro\s*league/i.test(t)) return 'belgium';   // ベルギー・プロリーグ（DAZN Japan・日本人選手多数）
  return null;
}
function parseTitle(title) {
  const league = detectLeague(title);
  const isHi = /ハイライト|highlight/i.test(title);
  // 節/マッチデー：U-NEXTは「第N節」、WOWOWは「MD6」「リーグフェーズ MD6」表記。両対応。
  const md = (title.match(/第\s*0*(\d+)\s*節/) || title.match(/\bMD\s*0*(\d+)\b/i) || title.match(/マッチデー\s*0*(\d+)/) || [])[1];
  // シーズン開始年：2026/27・2026/2027・26/27 のいずれの表記にも対応
  let seasonStart = null;
  let sm = title.match(/20(\d\d)\s*[\/\-]\s*(?:20)?\d{2}/);          // 2026/27, 2026/2027
  if (sm) seasonStart = 2000 + (+sm[1]);
  else { sm = title.match(/(?<!\d)(\d{2})\s*[\/\-]\s*(\d{2})(?!\d)/); if (sm) seasonStart = 2000 + (+sm[1]); } // 26/27
  // 「HOME v AWAY」を含むセグメントを探す（｜ 【 】 [ ] で分割し、対戦表記のある区切りだけ拾う）
  let home = null, away = null;
  for (const seg of title.split(/[｜|【】\[\]]/)) {
    const m = seg.match(/^\s*([^｜|]+?)\s+(?:v|vs\.?)\s+([^｜|]+?)\s*$/i)
          || seg.match(/^\s*([^｜|]+?)\s*(?:×|✕|ｖｓ|対)\s*([^｜|]+?)\s*$/);
    if (m && m[1] && m[2]) { home = m[1].trim(); away = m[2].trim(); break; }
  }
  return { league, isHi, md: md ? +md : null, seasonStart, home, away };
}

// ---- 実行 ----
const vids = await channelVideos();
console.log(`配信元(${HANDLE}) 投稿取得: ${vids.length}本`);

// ---- 診断モード：このチャンネルの「ハイライト動画」を大会別に一覧（未対応＝(未対応)に集約）。網羅拡張の材料。 ----
if (args.includes('--diagnose') || process.env.DIAGNOSE) {
  const hi = vids.map(v => ({ ...v, p: parseTitle(v.title) }))
    .filter(v => nsp(v.author || '').includes(AUTHOR_TOKEN) && v.p.isHi);
  const byLg = {}; for (const v of hi) { const lg = v.p.league || '(未対応)'; (byLg[lg] = byLg[lg] || []).push(v.title); }
  console.log(`\n=== [診断] ${HANDLE} のハイライト動画（${hi.length}本）を大会別に表示 ===`);
  for (const [lg, ts] of Object.entries(byLg).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n■ ${lg}（${ts.length}本）`);
    ts.slice(0, 20).forEach(t => console.log('   ' + t));
  }
  process.exit(0);
}
const parsed = vids.map(v => ({ ...v, p: parseTitle(v.title) }))
  .filter(v => nsp(v.author || '').includes(AUTHOR_TOKEN))   // 配信元チャンネル自身の投稿だけ（ページ内の関連動画等を除外）
  .filter(v => v.p.league === LEAGUE_ARG && v.p.isHi && v.p.home && v.p.away && (v.p.seasonStart == null || v.p.seasonStart === CUR_START));
console.log(`うち${LG_LABEL}・現行シーズン(${CUR_START}/${String((CUR_START + 1) % 100).padStart(2, '0')})のハイライト候補: ${parsed.length}本`);
if (parsed.length === 0 && vids.length) {
  console.log('  [診断] 候補0件のため、取得動画の先頭20本を表示します（author ｜ title ｜ 解析結果）:');
  vids.slice(0, 20).forEach(v => { const p = parseTitle(v.title); console.log(`     ${v.author} ｜ ${v.title} ｜ league=${p.league} Hi=${p.isHi} home=${p.home} away=${p.away} md=${p.md} season=${p.seasonStart}`); });
  // どのリーグの動画が何本あるかも表示（U-NEXTがそのリーグを配信しているかの判断材料）
  const byLg = {}; for (const v of vids) { const lg = parseTitle(v.title).league || '(不明)'; byLg[lg] = (byLg[lg]||0)+1; }
  console.log('  [診断] チャンネル内のリーグ別本数:', JSON.stringify(byLg));
}

// ---- 動画ファースト（日程APIが無いリーグ：J1等）：タイトルから試合を生成して data を作る ----
if (VIDEO_FIRST.has(LEAGUE_ARG)) {
  const slugFor = jp => { const n = nsp(jp); let best = 'x-' + n.slice(0, 10), bl = 0; for (const [k, v] of J1_SLUGS) { const kn = nsp(k); if (kn && n.includes(kn) && kn.length > bl) { best = v; bl = kn.length; } } return best; };
  const path = `data/league-${LEAGUE_ARG}-${CUR_START}.json`;
  const byKey = new Map();   // homeSlug|awaySlug|md → 試合
  // 蓄積型：まず既存データを読み込む。動画ファーストは配信元チャンネルの「直近ウィンドウ」しか取れないため、
  // 毎回作り直すと古い試合が抜け落ちて減っていく。過去分を保持し、新規のみ足して積み上げる（サイトが育つ）。
  try { for (const m of (JSON.parse(readFileSync(path, 'utf8')).matches || [])) { byKey.set(`${m.homeSlug}|${m.awaySlug}|${m.matchday || ''}`, m); } } catch {}
  const before = byKey.size;
  for (const v of parsed) {
    const hs = slugFor(v.p.home), as = slugFor(v.p.away);
    const key = `${hs}|${as}|${v.p.md || ''}`;
    if (!byKey.has(key)) byKey.set(key, { matchday: v.p.md, dateUTC: '', home: v.p.home, away: v.p.away, homeSlug: hs, awaySlug: as, finished: true, score: '', videoId: v.id });
    else { const ex = byKey.get(key); if (v.id && !ex.videoId) ex.videoId = v.id; }   // 既存は保持、videoId未設定なら補完
  }
  const added = byKey.size - before;
  const matches = [...byKey.values()].sort((a, b) => (a.matchday || 0) - (b.matchday || 0) || String(a.home).localeCompare(String(b.home), 'ja'));
  // 安全ガード：取得0件のとき既存の非空データを空で上書きしない（YouTubeがconsent画面等を返した場合の誤消去を防ぐ）。
  // 意図的に空へ戻す場合だけ --force を付ける。
  if (matches.length === 0 && !FORCE) {
    let existing = 0;
    try { existing = (JSON.parse(readFileSync(path, 'utf8')).matches || []).length; } catch {}
    if (existing > 0) {
      console.error(`  ⛔ 取得0件のため書き込みを中止（既存 ${existing}件を保護）。ネットワーク/consent画面の可能性。空で上書きするなら --force。`);
      process.exit(2);
    }
  }
  if (!DRY) writeFileSync(path, JSON.stringify({ code: LEAGUE_ARG, jp: LG_LABEL, season: String(CUR_START), updated: '', matches }, null, 2) + '\n');
  const unslugged = matches.filter(m => m.homeSlug.startsWith('x-') || m.awaySlug.startsWith('x-'));
  console.log(`${path}: ${matches.length}試合（動画ファースト・蓄積）／今回新規 ${added}件・既存 ${before}件`);
  if (unslugged.length) { console.log(`  ⚠ スラッグ未登録のクラブを含む試合 ${unslugged.length}件（J1_SLUGS に追記推奨）:`); [...new Set(unslugged.flatMap(m => [m.home, m.away]).filter(n => slugFor(n).startsWith('x-')))].forEach(n => console.log(`     ${n}`)); }
  console.log(DRY ? '\n(--dry-run: 書き込みなし)' : '\n書き込み完了。git add/commit/push で本番反映されます。');
  process.exit(0);
}

const files = readdirSync('data').filter(n => new RegExp(`^league-${LEAGUE_ARG}-\\d{4}\\.json$`).test(n))
  .filter(n => n.endsWith(`-${CUR_START}.json`));
if (!files.length) { console.error(`対象ファイルが見つかりません（data/league-${LEAGUE_ARG}-${CUR_START}.json）。--season / --league を確認してください。`); process.exit(1); }

let filled = 0, replaced = 0, cleared = 0; const used = new Set(); const unmatchedVids = [];
for (const f of files) {
  const path = `data/${f}`; const j = JSON.parse(readFileSync(path, 'utf8'));
  for (const m of (j.matches || [])) {
    // finished は要求しない：U-NEXTがハイライトを出している＝試合実施済み。スコアは次回のリーグ取得で埋まる。
    // 節番号(matchday)は必須にして、同カード（往復対戦）の取り違えを防ぐ。
    if (m.matchday == null || !m.home || !m.away) continue;
    // この試合に一致するU-NEXT動画を探す（両オリエンテーション・節番号があれば一致必須）
    const hit = parsed.find(v => used.has(v.id) ? false : (
      ((teamMatch(m.home, v.p.home) && teamMatch(m.away, v.p.away)) ||
       (teamMatch(m.home, v.p.away) && teamMatch(m.away, v.p.home)))
      && (v.p.md == null || v.p.md === m.matchday)
    ));
    if (hit) {
      used.add(hit.id);
      if (m.videoId === hit.id) { /* 変更なし */ }
      else if (m.videoId) { m.videoId = hit.id; replaced++; }
      else { m.videoId = hit.id; filled++; }
    } else if (m.videoId && PURGE) {
      // --purge 指定時のみ：U-NEXTで拾えなかった既存videoId（＝日本で見られないNBC等）をクリア
      m.videoId = ''; cleared++;
    }
  }
  if (!DRY) writeFileSync(path, JSON.stringify(j, null, 2) + '\n');
  const withV = (j.matches || []).filter(m => m.videoId).length;
  const finN = (j.matches || []).filter(m => m.finished).length;
  console.log(`${path}: 完了${finN}試合中 videoId付き ${withV}件`);
}
// 突合できなかったU-NEXT動画（日程表に無い＝表記ゆれ/カップ戦等）を表示（要確認）
for (const v of parsed) if (!used.has(v.id)) unmatchedVids.push(v);
console.log(`\n新規${filled} / 差し替え${replaced} / クリア（日本再生不可の既存を除去）${cleared}`);
if (unmatchedVids.length) {
  console.log(`\n⚠ 日程表と突合できなかったU-NEXT動画 ${unmatchedVids.length}件（表記ゆれ等・要確認）:`);
  unmatchedVids.slice(0, 15).forEach(v => console.log(`   ${v.id}  ${v.title}`));
  console.log('   → 一致すべき試合があれば data/league-team-aliases.json に日本語別名を足すと拾えます。');
}
console.log(DRY ? '\n(--dry-run: 書き込みなし)' : '\n書き込み完了。git add/commit/push で本番反映されます。');
