// 1試合1ページ生成（固有コンテンツ肉付け版）
// 各ページ: 固有サマリー + 試合データ + 関連試合リンク + 公式埋め込み(+Jリーグ出場選手)
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const DOMAIN = 'https://highlight-compass.com';
const html = readFileSync('site/index.html', 'utf8');
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
writeFileSync('site/style.css', css);
mkdirSync('site/match', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: 'Mozilla/5.0 Chrome/124.0 Safari/537.36' });
await page.goto('http://localhost:8124/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2500);
const raw = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('details.match').forEach(d => {
    const ttl = (d.querySelector('.ttl')||{}).textContent||'';
    const meta = (d.querySelector('.meta')||{}).textContent||'';
    const league = d.dataset.league||'';
    const body = (d.querySelector('.body')||{}).innerHTML||'';
    const facts = (d.querySelector('.facts')||{}).textContent||'';
    const lineupEl = d.querySelector('.lineup');
    const lineup = lineupEl ? (lineupEl.textContent.replace(/^出場選手：/,'').replace(/／データ：Jリーグ公式.*$/,'').trim()) : '';
    const dual = !!d.querySelector('.dualnote');
    const ifr = d.querySelector('iframe'); let id='';
    if (ifr){ const m=(ifr.getAttribute('src')||'').match(/embed\/([A-Za-z0-9_-]{6,})/); if(m) id=m[1]; }
    out.push({ ttl:ttl.trim(), meta:meta.trim(), league, body, facts:facts.trim(), lineup, dual, id });
  });
  return out;
});
await browser.close();

const LG = { wc:'FIFAワールドカップ26', jl:'Jリーグ2026', laliga:'ラ・リーガ', seriea:'セリエA', ligue1:'リーグアン', bundes:'ブンデスリーガ', portugal:'ポルトガルリーグ', other:'' };
const CANON = ['久保建英','鈴木彩艶','南野拓実','堂安律','守田英正','佐野海舟','伊藤洋輝','菅原由勢','藤田譲瑠チマ','川﨑颯太','長田澪','鎌田大地','上田綺世','伊東純也'];
const esc = s => (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// 解析: チーム・選手・節/活躍
function parse(m){
  let mt=m.ttl, prefix=null;
  if (mt.includes('─')){ const p=mt.split('─'); prefix=p[0].trim(); mt=p.slice(1).join('─').trim(); }
  const teams = mt.split(/\s*vs\s*/i).map(s=>s.trim()).filter(Boolean);
  const players = CANON.filter(p => m.ttl.includes(p) || m.facts.includes(p));
  // 日本人選手の活躍（facts内 "日本人選手：…。"）
  let jpNote=''; const fm = m.facts.match(/日本人選手：([^。]*)/); if (fm) jpNote = fm[1].trim();
  // metaの末尾「・◯◯」を見どころに
  let topic=''; const tm = m.meta.match(/[・/]\s*([^・/]*(?:弾|ゴール|アシスト|勝|敗|ドロー|無失点|セーブ|MOM|優勝|首位|ダービー|決定|突破|快勝|大勝|初[^・/]*)[^・/]*)\s*$/); if (tm) topic = tm[1].trim();
  return { teams, players, jpNote, topic };
}
const data = raw.map(m => ({ ...m, ...parse(m) }));

// 関連: チーム別・選手別
const byTeam={}, byPlayer={};
data.forEach(m=>{ m.teams.forEach(t=>{ (byTeam[t]=byTeam[t]||[]).push(m); }); m.players.forEach(p=>{ (byPlayer[p]=byPlayer[p]||[]).push(m); }); });
function related(m){
  const seen=new Set([m.id]); const rel=[];
  m.players.forEach(p=> (byPlayer[p]||[]).forEach(x=>{ if(!seen.has(x.id)&&x.id){seen.add(x.id);rel.push({m:x,why:p})} }));
  m.teams.forEach(t=> (byTeam[t]||[]).forEach(x=>{ if(!seen.has(x.id)&&x.id){seen.add(x.id);rel.push({m:x,why:t})} }));
  return rel.slice(0,8);
}

const slugs=[]; let n=0;
for (let i=0;i<data.length;i++){
  const m=data[i]; const slug=m.id||('m'+i);
  if (slugs.includes(slug)) continue; slugs.push(slug);
  const lg=LG[m.league]||''; const teamsTxt=m.teams.join(' vs ');
  // 固有サマリー
  const sents=[];
  sents.push(`${teamsTxt||m.ttl}${lg?'、'+lg:''}の公式ハイライトです。`);
  if (m.players.length) sents.push(`${m.players.join('・')}が出場${m.jpNote && m.jpNote!==m.players.join('・')?`し、${m.jpNote.replace(new RegExp(m.players.join('|'),'g'),'').replace(/[（）]/g,'').trim()||'プレー'}が見どころ`:''}。`);
  else if (m.topic) sents.push(`見どころは${m.topic}。`);
  sents.push(m.dual?`映像は「ネタバレ控えめ版（結果が出ないMATCH RECAP）」と「ネタバレあり版（ハイライト）」の2種類を用意。お好みで選べます。`:`公式映像のみを掲載し、無断転載は扱いません。`);
  if (m.lineup) sents.push(`両チームの出場選手も公式データから掲載しています。`);
  const summary = sents.join('');
  const desc = `${teamsTxt||m.ttl}${lg?'（'+lg+'）':''}の公式ハイライト。${m.players.length?m.players.join('・')+'出場。':''}${m.topic?m.topic+'。':''}公式映像のみ・ネタバレ防止。`.slice(0,120);
  // 試合データ
  const facts=[];
  if (lg) facts.push(['大会', lg + (m.meta ? '　/　' + m.meta : '')]);
  facts.push(['対戦', teamsTxt||m.ttl]);
  if (m.players.length) facts.push(['日本人選手', m.jpNote||m.players.join('・')]);
  if (m.topic) facts.push(['見どころ', m.topic]);
  const factsHtml = facts.map(f=>`<tr><th style="text-align:left;color:var(--muted);padding:6px 12px 6px 0;white-space:nowrap;vertical-align:top">${esc(f[0])}</th><td style="padding:6px 0">${esc(String(f[1]))}</td></tr>`).join('');
  // 関連試合
  const rel = related(m);
  const relHtml = rel.length ? `<h2 style="font-size:16px;margin:26px 0 10px">関連する試合</h2><ul style="margin:0;padding-left:18px;line-height:2">${rel.map(r=>`<li><a href="${r.m.id}.html" style="color:var(--accent2);text-decoration:none">${esc(r.m.ttl)}</a> <span style="color:var(--muted);font-size:12px">（${esc(r.why)}）</span></li>`).join('')}</ul>` : '';

  const ogimg = m.id ? `https://i.ytimg.com/vi/${m.id}/hqdefault.jpg` : `${DOMAIN}/og.png`;
  const url = `${DOMAIN}/match/${slug}.html`;
  const jsonld = {"@context":"https://schema.org","@type":"VideoObject","name":m.ttl+"｜公式ハイライト","description":desc,"thumbnailUrl":ogimg,"uploadDate":"2026-06-01","embedUrl":m.id?`https://www.youtube.com/embed/${m.id}`:url,"publisher":{"@type":"Organization","name":"Football Highlights Compass","url":DOMAIN+"/"}};

  const out = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(m.ttl)}｜公式ハイライト${lg?'・'+lg:''} - Football Highlights Compass</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow,max-image-preview:large"><meta name="theme-color" content="#1b2a78">
<link rel="canonical" href="${url}">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7948789271209448" crossorigin="anonymous"></script>
<meta property="og:type" content="video.other"><meta property="og:site_name" content="Football Highlights Compass"><meta property="og:locale" content="ja_JP">
<meta property="og:title" content="${esc(m.ttl)}｜公式ハイライト"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}"><meta property="og:image" content="${ogimg}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(m.ttl)}｜公式ハイライト"><meta name="twitter:image" content="${ogimg}">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<link rel="stylesheet" href="../style.css">
</head><body>
<div class="wrap">
  <header class="site"><span class="logo">⚽🧭</span><span class="name">Football Highlights Compass<small>公式ハイライトだけを、日本語で探しやすく。</small></span></header>
  <p style="margin:14px 0 6px"><a href="../" style="color:var(--accent2);text-decoration:none">← 全試合・検索トップへ戻る</a></p>
  <h1 style="font-size:22px;margin:8px 0 2px">${esc(m.ttl)}</h1>
  <p class="sub">${esc(m.meta)}${lg?'　／　'+lg:''}</p>
  <p style="font-size:15px;line-height:1.85;margin:10px 0 16px">${esc(summary)}</p>
  <table style="border-collapse:collapse;font-size:14px;margin:0 0 16px">${factsHtml}</table>
  <div class="notice warn" style="margin:0 0 14px"><span class="i">⚠️</span><div>このページは試合結果・スコアを含みます。ネタバレを避けたい方はご注意ください。</div></div>
  <div class="match" open><div class="body" style="border-top:none;padding-top:4px">${m.body}</div></div>
  ${relHtml}
  <footer><p>掲載は公式・権利元が公開している映像のみ。無断転載・切り抜きは扱いません。${m.lineup?'出場選手データ：Jリーグ公式。':''}</p>
  <p><a href="../" style="color:var(--accent2)">▶ 他の試合を探す（W杯・Jリーグ・日本人所属クラブ）</a></p>
  <p>© 2026 Football Highlights Compass</p></footer>
</div></body></html>`;
  writeFileSync(`site/match/${slug}.html`, out); n++;
}
console.log('生成:', n, 'ページ（固有サマリー+データ+関連リンク付き）');

const today='2026-06-23';
let sm=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${DOMAIN}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
for (const s of slugs) sm+=`  <url><loc>${DOMAIN}/match/${s}.html</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
sm+=`</urlset>\n`; writeFileSync('site/sitemap.xml', sm);
console.log('sitemap:', slugs.length+1, 'URL');
