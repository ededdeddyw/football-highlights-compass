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
//   node scripts/fetch-unext-pl.mjs --league=cl    # チャンピオンズリーグを更新（データは data/league-cl-<season>.json）
//   node scripts/fetch-unext-pl.mjs --season=2026  # シーズン開始年を明示（2026=2026/27）
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
const KEEP = args.includes('--keep-existing');   // 後方互換（既定でクリアしなくなったため実質no-op）
const PURGE = args.includes('--purge') && !KEEP; // U-NEXTで拾えなかった既存videoId（NBC等）を消す。既定はOFF（消さない）
const SEASON_ARG = (args.find(a => a.startsWith('--season=')) || '').split('=')[1] || '';
// 対象リーグ（既定 pl）。例: --league=cl でチャンピオンズリーグ。データは data/league-<LEAGUE>-<season>.json。
const LEAGUE_ARG = ((args.find(a => a.startsWith('--league=')) || '').split('=')[1] || 'pl').toLowerCase();
const LEAGUE_JP = { pl:'プレミアリーグ', laliga:'ラ・リーガ', sa:'セリエA', bl:'ブンデスリーガ', ligue1:'リーグアン', cl:'チャンピオンズリーグ' };
const LG_LABEL = LEAGUE_JP[LEAGUE_ARG] || LEAGUE_ARG;
const HANDLE = '@UNEXT_football';
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
async function channelVideos() {
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
  if (/チャンピオンズリーグ|champions\s*league|UEFA\s*CL|欧州CL|ＵＥＦＡ/i.test(t)) return 'cl';
  if (/プレミアリーグ|premier\s*league/i.test(t)) return 'pl';
  if (/ラ・?リーガ|la\s*liga/i.test(t)) return 'laliga';
  if (/セリエ\s*a|serie\s*a/i.test(t)) return 'sa';
  if (/ブンデスリーガ|bundesliga/i.test(t)) return 'bl';
  if (/リーグ\s*アン|ligue\s*1/i.test(t)) return 'ligue1';
  if (/エールディヴィジ|eredivisie/i.test(t)) return 'eredivisie';
  return null;
}
function parseTitle(title) {
  const league = detectLeague(title);
  const isHi = /ハイライト|highlight/i.test(title);
  const md = (title.match(/第\s*0*(\d+)\s*節/) || [])[1];
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
console.log(`U-NEXT(@UNEXT_football) 投稿取得: ${vids.length}本`);
const parsed = vids.map(v => ({ ...v, p: parseTitle(v.title) }))
  .filter(v => nsp(v.author || '').includes('unext'))   // U-NEXT自身の投稿だけ（ページ内の関連動画等を除外）
  .filter(v => v.p.league === LEAGUE_ARG && v.p.isHi && v.p.home && v.p.away && (v.p.seasonStart == null || v.p.seasonStart === CUR_START));
console.log(`うち${LG_LABEL}・現行シーズン(${CUR_START}/${String((CUR_START + 1) % 100).padStart(2, '0')})のハイライト候補: ${parsed.length}本`);
if (parsed.length === 0 && vids.length) {
  console.log('  [診断] 候補0件のため、取得動画の先頭20本を表示します（author ｜ title ｜ 解析結果）:');
  vids.slice(0, 20).forEach(v => { const p = parseTitle(v.title); console.log(`     ${v.author} ｜ ${v.title} ｜ league=${p.league} Hi=${p.isHi} home=${p.home} away=${p.away} md=${p.md} season=${p.seasonStart}`); });
  // どのリーグの動画が何本あるかも表示（U-NEXTがそのリーグを配信しているかの判断材料）
  const byLg = {}; for (const v of vids) { const lg = parseTitle(v.title).league || '(不明)'; byLg[lg] = (byLg[lg]||0)+1; }
  console.log('  [診断] チャンネル内のリーグ別本数:', JSON.stringify(byLg));
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
