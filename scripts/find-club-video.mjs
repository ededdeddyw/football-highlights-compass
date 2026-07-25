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
// YouTube InnerTube プレイヤーAPI（WEB_EMBEDDED_PLAYER クライアント＋gl=JP）で、
// 「日本での埋め込み再生可否」を1回で判定する。サイトが実際に行う埋め込み再生と同じ経路。
//   playabilityStatus.status:
//     OK          → 日本で埋め込み再生できる（そのまま採用可）
//     UNPLAYABLE  → 不可（reason 例: 別サイト埋め込み禁止／お住まいの国では公開されていません）
//     LOGIN_REQUIRED / AGE_CHECK_REQUIRED → 年齢制限など（サイトで再生不可）
//   videoDetails からタイトル/チャンネルも取得（oEmbed不要）。availableCountries があれば件数も表示。
const YT_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'; // 公開Web鍵（InnerTubeの標準キー）
async function playerProbe(id) {
  try {
    const body = {
      videoId: id,
      context: {
        client: { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '1.20240101.00.00', hl: 'ja', gl: 'JP' },
        thirdParty: { embedUrl: 'https://highlight-compass.com/' },
      },
    };
    const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${YT_KEY}&prettyPrint=false`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36', 'origin': 'https://www.youtube.com' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { status: `HTTP_${r.status}`, reason: '', jp: null, countries: null, title: '', author: '' };
    const j = await r.json();
    const ps = j.playabilityStatus || {};
    const vd = j.videoDetails || {};
    const mf = (j.microformat && j.microformat.playerMicroformatRenderer) || {};
    const countries = Array.isArray(mf.availableCountries) ? mf.availableCountries : null;
    const jp = countries ? countries.includes('JP') : (ps.status === 'OK' ? true : ps.status === 'UNPLAYABLE' ? false : null);
    const reason = ps.reason || (ps.errorScreen && ps.errorScreen.playerErrorMessageRenderer && ps.errorScreen.playerErrorMessageRenderer.reason && ps.errorScreen.playerErrorMessageRenderer.reason.simpleText) || '';
    return { status: ps.status || '不明', reason, jp, countries: countries ? countries.length : null, title: vd.title || '', author: vd.author || '' };
  } catch (e) { return { status: 'ERR', reason: e.message, jp: null, countries: null, title: '', author: '' }; }
}

const ids = await searchIds(QUERY);
console.log(`検索: "${QUERY}"${CHANNEL ? `  チャンネル絞り込み: "${CHANNEL}"` : ''}\n候補 ${ids.length} 件を診断します（日本での埋め込み再生可否を InnerTube で判定）…\n`);
const chN = norm(CHANNEL);
let shown = 0;
for (const id of ids) {
  if (shown >= N) break;
  const rg = await playerProbe(id); await sleep(300);
  if (!rg.title && rg.status === '不明') continue; // 取得失敗はスキップ
  if (chN && !norm(rg.author).includes(chN)) continue;
  const jpTxt = rg.jp === null ? '不明' : rg.jp ? '○ 視聴可' : '× 除外';
  const ok = rg.status === 'OK';
  console.log(`${ok ? '✅' : '⚠️'} ${id}  [${rg.author || '?'}]`);
  console.log(`    ${rg.title || '(タイトル取得不可)'}`);
  console.log(`    日本での埋め込み再生=${rg.status}${rg.reason ? '（' + rg.reason + '）' : ''}  JP=${jpTxt}${rg.countries != null ? '  許可国=' + rg.countries : ''}`);
  console.log(`    → https://youtu.be/${id}\n`);
  shown++;
}
console.log(shown ? '✅=日本で埋め込み再生OK（そのまま採用可）／⚠️=不可・要確認（reason参照）。' : '該当なし。クエリやチャンネル絞り込みを変えて再実行してください。');
