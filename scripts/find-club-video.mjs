// クラブ図鑑ページ用の「雰囲気動画」（応援歌・スタジアム映像など）候補を YouTube から探し、
// 各候補の チャンネル / 日本(JP)視聴可否 / 埋め込み可否 / status をまとめて診断する。
// CIランナー（YouTubeに到達できる環境）で回す前提。ローカルのプロキシ環境からは使えない。
// 使い方: node scripts/find-club-video.mjs "napoli un giorno all'improvviso" [--channel=SSC Napoli] [--n=8]
//   FIND_QUERY / FIND_CHANNEL / FIND_N 環境変数でも指定可（ワークフロー入力用）。
const args = process.argv.slice(2);
const QUERY = (args.find(a => !a.startsWith('--')) || process.env.FIND_QUERY || '').trim();
const CHANNEL = ((args.find(a => a.startsWith('--channel=')) || '').split('=')[1] || process.env.FIND_CHANNEL || '').trim();
const N = (() => { const v = +(((args.find(a => a.startsWith('--n=')) || '').split('=')[1]) || process.env.FIND_N); return Number.isFinite(v) && v > 0 ? v : 8; })();
if (!QUERY) { console.log('検索クエリが指定されていません（例: node scripts/find-club-video.mjs "napoli anthem stadium"）'); process.exit(0); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pick = (s, re) => { const m = s.match(re); return m ? m[1] : null; };

async function searchIds(query) {
  try {
    const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36', 'accept-language': 'en' } });
    if (!r.ok) return [];
    const html = await r.text(); const seg = html.slice(Math.max(0, html.indexOf('ytInitialData')));
    const ids = []; const seen = new Set();
    for (const m of seg.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) { if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); } if (ids.length >= 20) break; }
    return ids;
  } catch { return []; }
}
// oEmbed：動画が公開状態か（＝非公開/削除でないか）とタイトル/チャンネルを取得。bot対策の影響を受けにくく最も安定。
async function oembed(id) {
  try { const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`); if (!r.ok) return null; const j = await r.json(); return { title: j.title || '', author: j.author_name || '' }; } catch { return null; }
}
// InnerTube ANDROID クライアント（gl=JP）で日本での再生可否を best-effort 判定。
// WEB系は poToken 必須化で ERROR を返すため、まだ無認証で通りやすい ANDROID を使う。
//   status: OK=日本で再生可 / UNPLAYABLE・LOGIN_REQUIRED=不可 / それ以外=判定不可（不明）。
//   埋め込み禁止(embed-disable)は ANDROID では判別できないが、サイト側は onError で「YouTubeで見る」に自動フォールバックする。
const YT_KEY = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w'; // ANDROID クライアントの公開InnerTubeキー
async function playerProbe(id) {
  try {
    const body = {
      videoId: id,
      context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'ja', gl: 'JP', userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip' } },
    };
    const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${YT_KEY}&prettyPrint=false`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip', 'x-goog-api-format-version': '2' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { status: `HTTP_${r.status}`, reason: '', jp: null, countries: null };
    const j = await r.json();
    const ps = j.playabilityStatus || {};
    const mf = (j.microformat && j.microformat.playerMicroformatRenderer) || {};
    const countries = Array.isArray(mf.availableCountries) ? mf.availableCountries : null;
    const jp = countries ? countries.includes('JP') : (ps.status === 'OK' ? true : ps.status === 'UNPLAYABLE' ? false : null);
    const reason = ps.reason || (ps.errorScreen && ps.errorScreen.playerErrorMessageRenderer && ps.errorScreen.playerErrorMessageRenderer.reason && ps.errorScreen.playerErrorMessageRenderer.reason.simpleText) || '';
    return { status: ps.status || '不明', reason, jp, countries: countries ? countries.length : null };
  } catch (e) { return { status: 'ERR', reason: e.message, jp: null, countries: null }; }
}

const ids = await searchIds(QUERY);
console.log(`検索: "${QUERY}"${CHANNEL ? `  チャンネル絞り込み: "${CHANNEL}"` : ''}\n候補 ${ids.length} 件を診断します（oEmbedで公開確認＋ANDROIDクライアントで日本再生可否）…\n`);
const chN = norm(CHANNEL);
let shown = 0;
for (const id of ids) {
  if (shown >= N) break;
  const mt = await oembed(id); await sleep(150);
  if (!mt) continue; // 非公開/削除はスキップ
  if (chN && !norm(mt.author).includes(chN)) continue;
  const rg = await playerProbe(id); await sleep(250);
  const jpTxt = rg.jp === null ? '不明' : rg.jp ? '○ 視聴可' : '× 除外';
  const ok = rg.status === 'OK' && rg.jp !== false;
  console.log(`${ok ? '✅' : '⚠️'} ${id}  [${mt.author || '?'}]`);
  console.log(`    ${mt.title || '(タイトル取得不可)'}`);
  console.log(`    日本再生=${rg.status}${rg.reason ? '（' + rg.reason + '）' : ''}  JP=${jpTxt}${rg.countries != null ? '  許可国=' + rg.countries : ''}`);
  console.log(`    → https://youtu.be/${id}\n`);
  shown++;
}
console.log(shown ? '✅=公開済み＋日本で再生OK（採用可。埋め込み禁止は onError で YouTube 導線に自動フォールバック）／⚠️=要確認（reason参照）。' : '該当なし。クエリを変えて再実行してください。');
