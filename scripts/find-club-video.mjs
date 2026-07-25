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
async function oembed(id) {
  try { const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`); if (!r.ok) return null; const j = await r.json(); return { title: j.title || '', author: j.author_name || '' }; } catch { return null; }
}
// サイトが実際に使う youtube-nocookie の embed エンドポイントで再生可否を診断する。
// watch ページは近年データセンターIPに LOGIN_REQUIRED を返すため、埋め込み経路を直接見るのが確実。
//   playabilityStatus.status: OK=埋め込み再生可 / UNPLAYABLE・ERROR=不可（reason に理由） / LOGIN_REQUIRED=判定不可。
// availableCountries が取れた場合のみ日本(JP)可否も返す（取れなければ「不明」）。
async function embedProbe(id) {
  try {
    const r = await fetch(`https://www.youtube-nocookie.com/embed/${id}`, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36', 'accept-language': 'ja', 'referer': 'https://highlight-compass.com/' } });
    const html = await r.text();
    const status = pick(html, /"playabilityStatus":\{"status":"([A-Z_]+)"/) || pick(html, /"status":"([A-Z_]+)"/);
    const reason = pick(html, /"reason":\{"simpleText":"([^"]+)"/) || pick(html, /"reason":"([^"]+)"/);
    const embed = /"playableInEmbed":true/.test(html) ? true : /"playableInEmbed":false/.test(html) ? false : null;
    const ac = pick(html, /"availableCountries":\[([^\]]*)\]/);
    const countries = ac ? ac.replace(/"/g, '').split(',').filter(Boolean) : null;
    const jp = countries ? countries.includes('JP') : null;
    return { jp, embed, status, reason, countries: countries ? countries.length : null };
  } catch { return { jp: null, embed: null, status: null, reason: null, countries: null }; }
}

const ids = await searchIds(QUERY);
console.log(`検索: "${QUERY}"${CHANNEL ? `  チャンネル絞り込み: "${CHANNEL}"` : ''}\n候補 ${ids.length} 件を診断します…\n`);
const chN = norm(CHANNEL);
let shown = 0;
for (const id of ids) {
  if (shown >= N) break;
  const mt = await oembed(id); await sleep(150);
  if (!mt) { continue; }
  if (chN && !norm(mt.author).includes(chN)) continue;
  const rg = await embedProbe(id); await sleep(250);
  const jpTxt = rg.jp === null ? '不明' : rg.jp ? '○ 視聴可' : '× 除外';
  const emTxt = rg.embed === false ? '× 不可' : rg.embed === true ? '○ 可' : (rg.status === 'OK' ? '○ 可(推定)' : '不明');
  const ok = (rg.status === 'OK') && (rg.jp !== false) && (rg.embed !== false);
  console.log(`${ok ? '✅' : '⚠️'} ${id}  [${mt.author}]`);
  console.log(`    ${mt.title}`);
  console.log(`    埋め込み再生=${rg.status || '不明'}${rg.reason ? '（' + rg.reason + '）' : ''}  playableInEmbed=${emTxt}  JP=${jpTxt}`);
  console.log(`    → https://youtu.be/${id}\n`);
  shown++;
}
console.log(shown ? '✅=そのまま採用可（JP視聴可＋埋め込み可）／⚠️=要確認。' : '該当なし。クエリやチャンネル絞り込みを変えて再実行してください。');
