// ブンデス（等）の公式ハイライトが「見つかるか」「日本で見られるか」を切り分ける診断。
// YouTube検索→候補のタイトル/投稿者(oEmbed)＋地域制限/埋め込み可否(watchページ)をまとめて出す。
// 使い方: node scripts/diag-league-video.mjs "Bayern Leipzig Bundesliga highlights 2025"
const q = process.argv.slice(2).join(' ') || 'Bayern Leipzig Bundesliga highlights';
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36', 'accept-language': 'ja' };

async function searchIds(query) {
  const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { headers: UA });
  const html = await r.text();
  const seg = html.slice(Math.max(0, html.indexOf('ytInitialData')));
  const ids = []; const seen = new Set();
  for (const m of seg.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) { if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); } if (ids.length >= 12) break; }
  return ids;
}
async function oembed(id) {
  try { const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`); if (!r.ok) return null; const j = await r.json(); return { title: j.title || '', author: j.author_name || '' }; } catch { return null; }
}
async function region(id) {
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${id}&hl=ja&gl=JP`, { headers: UA });
    const h = await r.text(); const i = h.indexOf('ytInitialPlayerResponse'); const seg = i >= 0 ? h.slice(i, i + 200000) : h;
    const ac = (seg.match(/"availableCountries":\[([^\]]*)\]/) || [])[1];
    const countries = ac ? ac.replace(/"/g, '').split(',').filter(Boolean) : null;
    const jp = countries ? countries.includes('JP') : null;
    const embed = /"playableInEmbed":true/.test(seg) ? true : /"playableInEmbed":false/.test(seg) ? false : null;
    const status = (seg.match(/"status":"([A-Z_]+)"/) || [])[1];
    return { jp, n: countries ? countries.length : null, embed, status };
  } catch { return {}; }
}

console.log(`検索クエリ: ${q}\n`);
const ids = await searchIds(q);
for (const id of ids) {
  const o = await oembed(id); if (!o) { console.log(`● ${id}: oEmbed取得失敗`); continue; }
  const rg = await region(id);
  const jpTxt = rg.jp === true ? '日本○' : rg.jp === false ? '日本×' : rg.n === null ? '地域制限なし?' : '不明';
  console.log(`● ${id} [${o.author}] ${jpTxt} embed=${rg.embed} status=${rg.status || '-'}`);
  console.log(`   ${o.title}`);
  await new Promise(r => setTimeout(r, 200));
}
