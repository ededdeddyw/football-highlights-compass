// 1試合1ページを生成: index.html を描画→各.matchカードを抽出→ site/match/{id}.html
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const DOMAIN = 'https://highlight-compass.com';
const html = readFileSync('site/index.html', 'utf8');

// 1) CSS を共有ファイルに抽出
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
writeFileSync('site/style.css', css);
console.log('site/style.css 抽出:', css.length, 'bytes');

mkdirSync('site/match', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: 'Mozilla/5.0 Chrome/124.0 Safari/537.36' });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2500);

const matches = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('details.match').forEach(d => {
    const ttl = (d.querySelector('.ttl') || {}).textContent || '';
    const meta = (d.querySelector('.meta') || {}).textContent || '';
    const league = d.dataset.league || '';
    const body = (d.querySelector('.body') || {}).innerHTML || '';
    const ifr = d.querySelector('iframe');
    let id = '';
    if (ifr) { const m = (ifr.getAttribute('src') || '').match(/embed\/([A-Za-z0-9_-]{6,})/); if (m) id = m[1]; }
    out.push({ ttl: ttl.trim(), meta: meta.trim(), league, body, id });
  });
  return out;
});
await browser.close();

const LG = { wc:'FIFAワールドカップ26', jl:'Jリーグ', laliga:'ラ・リーガ', seriea:'セリエA', ligue1:'リーグアン', bundes:'ブンデスリーガ', portugal:'ポルトガルリーグ', other:'' };
const esc = s => (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const slugs = []; let n = 0, skipped = 0;
for (let i = 0; i < matches.length; i++) {
  const m = matches[i];
  const slug = m.id || ('m' + i);
  if (slugs.includes(slug)) continue; // 同一動画IDの重複ページは1つに
  slugs.push(slug);
  const lg = LG[m.league] || '';
  const title = `${m.ttl}｜公式ハイライト${lg?'・'+lg:''} - Football Highlights Compass`;
  const desc = `${m.ttl}${lg?'（'+lg+'）':''}の公式ハイライト。出場選手・ネタバレ控えめ版/あり版を掲載。公式映像のみ・無断転載なし。`;
  const ogimg = m.id ? `https://i.ytimg.com/vi/${m.id}/hqdefault.jpg` : `${DOMAIN}/og.png`;
  const url = `${DOMAIN}/match/${slug}.html`;
  const jsonld = {
    "@context":"https://schema.org","@type":"VideoObject",
    "name":m.ttl+"｜公式ハイライト","description":desc,
    "thumbnailUrl":ogimg,"uploadDate":"2026-06-01",
    "embedUrl": m.id ? `https://www.youtube.com/embed/${m.id}` : url,
    "publisher":{"@type":"Organization","name":"Football Highlights Compass","url":DOMAIN+"/"}
  };
  const out = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="theme-color" content="#1b2a78">
<link rel="canonical" href="${url}">
<meta property="og:type" content="video.other">
<meta property="og:site_name" content="Football Highlights Compass">
<meta property="og:locale" content="ja_JP">
<meta property="og:title" content="${esc(m.ttl)}｜公式ハイライト">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ogimg}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(m.ttl)}｜公式ハイライト">
<meta name="twitter:image" content="${ogimg}">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<link rel="stylesheet" href="../style.css">
</head><body>
<div class="wrap">
  <header class="site"><span class="logo">⚽🧭</span><span class="name">Football Highlights Compass<small>公式ハイライトだけを、日本語で探しやすく。</small></span></header>
  <p style="margin:14px 0 6px"><a href="../" style="color:var(--accent2);text-decoration:none">← 全試合・検索トップへ戻る</a></p>
  <h1 style="font-size:22px;margin:8px 0 2px">${esc(m.ttl)}</h1>
  <p class="sub">${esc(m.meta)}${lg?'　／　'+lg:''}</p>
  <div class="notice warn" style="margin:10px 0 14px"><span class="i">⚠️</span><div>このページは試合結果・スコアを含みます。ネタバレを避けたい方はご注意ください。</div></div>
  <div class="match" open><div class="body" style="border-top:none;padding-top:4px">${m.body}</div></div>
  <footer><p>掲載は公式・権利元が公開している映像のみ。無断転載・切り抜きは扱いません。出場選手データ：Jリーグ公式。</p>
  <p><a href="../" style="color:var(--accent2)">▶ 他の試合を探す（W杯・Jリーグ・日本人所属クラブ）</a></p>
  <p>© 2026 Football Highlights Compass</p></footer>
</div>
</body></html>`;
  writeFileSync(`site/match/${slug}.html`, out);
  n++;
}
console.log(`生成: ${n} ページ -> site/match/  (重複IDスキップ: ${matches.length - n - skipped})`);

// sitemap 更新（トップ + 全試合ページ）
const today = '2026-06-23';
let sm = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
sm += `  <url><loc>${DOMAIN}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
for (const s of slugs) sm += `  <url><loc>${DOMAIN}/match/${s}.html</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
sm += `</urlset>\n`;
writeFileSync('site/sitemap.xml', sm);
console.log('sitemap.xml 更新:', slugs.length + 1, 'URL');
