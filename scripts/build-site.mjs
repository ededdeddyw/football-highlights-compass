// 純Node生成（Playwright/サーバ不要）
// site/index.html を直接パースして
//  - site/article.css（Gizmodo風・個別ページ共通CSS）
//  - site/match/<id>.html（試合ページ・リデザイン）
//  - site/country/<slug>.html, site/club/<slug>.html（国/クラブ個別ページ＋歴史）
//  - site/sitemap.xml
//  - index.html 内 ENTITY_PAGES マップを注入
// を生成する。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { COUNTRIES, CLUBS } from './entities.mjs';

const DOMAIN = 'https://highlight-compass.com';
const TODAY = '2026-06-23';
const html = readFileSync('site/index.html', 'utf8');

const CANON = ['久保建英','鈴木彩艶','南野拓実','堂安律','守田英正','佐野海舟','伊藤洋輝','菅原由勢','藤田譲瑠チマ','川﨑颯太','長田澪','鎌田大地','上田綺世','伊東純也'];
const LG = { wc:'FIFAワールドカップ26', jl:'Jリーグ2026', laliga:'ラ・リーガ', seriea:'セリエA', ligue1:'リーグアン', bundes:'ブンデスリーガ', portugal:'ポルトガルリーグ', other:'' };
const esc = s => (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escA = s => (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');

// 国旗（COUNTRIES から name→iso）
const ISO = {}; for (const [n,c] of Object.entries(COUNTRIES)) ISO[n]=c.iso;
function flagImg(name){ const c=ISO[name]; return c?`<img class="flag" src="https://flagcdn.com/w40/${c}.png" srcset="https://flagcdn.com/w80/${c}.png 2x" alt="" loading="lazy">`:''; }

function leagueOf(t){
  if(/グループ|ワールドカップ/.test(t)) return 'wc';
  if(/Jリーグ|オールスター/.test(t)) return 'jl';
  if(/ラ・リーガ/.test(t)) return 'laliga';
  if(/セリエA/.test(t)) return 'seriea';
  if(/リーグアン/.test(t)) return 'ligue1';
  if(/ブンデスリーガ|DFBポカール/.test(t)) return 'bundes';
  if(/ポルトガル/.test(t)) return 'portugal';
  return 'other';
}

// ---------- index.html から動的データ抽出 ----------
function slice(start, end){ const a=html.indexOf(start); if(a<0) return ''; const b=html.indexOf(end, a+start.length); return html.slice(a+start.length, b<0?undefined:b); }

// JL_PLAYERS
let JL_PLAYERS = {};
{ const block = slice('/*JL_PLAYERS_START*/','/*JL_PLAYERS_END*/'); const a=block.indexOf('{'), b=block.lastIndexOf('}'); if(a>=0&&b>a){ try{ JL_PLAYERS = JSON.parse(block.slice(a,b+1)); }catch(e){ console.warn('JL_PLAYERS parse fail', e.message); } } }

// SPOILER_ALT
const SPOILER_ALT = {};
{ const block = slice('var SPOILER_ALT = {','};'); const re=/'([A-Za-z0-9_-]{6,})'\s*:\s*\{\s*clean:\s*'([^']+)'\s*,\s*spoiler:\s*'([^']+)'\s*\}/g; let m; while((m=re.exec(block))) SPOILER_ALT[m[1]]={clean:m[2],spoiler:m[3]}; }

// EXTRA arrays
function extra(name){ const block = slice('const '+name+' = [', '\n];'); const objs=block.match(/\{[^{}]*\}/g)||[]; return objs.map(o=>({ ttl:(o.match(/ttl:"([^"]*)"/)||[])[1]||'', meta:(o.match(/meta:"([^"]*)"/)||[])[1]||'', jp:(o.match(/jp:"([^"]*)"/)||[])[1]||'', id:(o.match(/id:"([^"]*)"/)||[])[1]||'' })); }
const EXTRA_WC = extra('EXTRA_WC'), EXTRA_JL = extra('EXTRA_JL'), EXTRA_CLUB = extra('EXTRA_CLUB');

// mkMatch / emb 移植（EXTRA の body 再構築用）
function escJ(s){return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');}
function mkBody(m){
  const jp = m.jp ? '<b>日本人選手：</b>'+m.jp+'。' : '';
  const lu = (JL_PLAYERS[m.id] && JL_PLAYERS[m.id].length) ? '<div class="lineup"><b>出場選手：</b>'+JL_PLAYERS[m.id].join('・')+'<span class="src2">／データ：Jリーグ公式</span></div>' : '';
  const emb = (id,cls,txt,geo)=> '<div class="source"><div class="source-head"><span class="tag '+cls+'">'+txt+'</span><span class="name">DAZN Japan（YouTube）</span><span class="geo">'+geo+'</span></div><div class="embedwrap"><iframe src="https://www.youtube-nocookie.com/embed/'+id+'" loading="lazy" title="'+escJ(m.ttl)+'" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div></div>';
  const sp = SPOILER_ALT[m.id]; let sources, note='';
  if (sp){
    note = '<div class="dualnote">🟢 ネタバレ控えめ版 と ⚠️ ネタバレあり版、両方あります。お好みでどうぞ。</div>';
    sources = emb(sp.clean,'clean','🟢 ネタバレ控えめ（RECAP・タイトルに結果なし）','日本から視聴可') + emb(sp.spoiler,'spoiler','⚠️ ネタバレあり（ハイライト・結果が映る）','日本から視聴可');
  } else { sources = emb(m.id,'embed','▶ 埋め込みOK（DAZN Japan）','日本から視聴可'); }
  return '<div class="body"><ul class="facts"><li><b>ソース：</b>DAZN Japan 公式YouTube。'+jp+'<b>スコア：</b>公式映像でご確認ください（ネタバレ防止）。</li></ul>'+ note + '<div class="sources">'+sources+'</div>'+lu+'</div>';
}

// 静的 details.match（EXTRA定義より前のHTMLのみ）
function staticMatches(){
  const region = html.slice(0, html.indexOf('const EXTRA_WC'));
  const re = /<details class="match">([\s\S]*?)<\/details>/g; const out=[]; let m;
  while((m=re.exec(region))){
    const blk = m[1];
    const ttl = ((blk.match(/<div class="ttl">([\s\S]*?)<\/div>/)||[])[1]||'').replace(/<[^>]+>/g,'').trim();
    const meta = ((blk.match(/<div class="meta">([\s\S]*?)<\/div>/)||[])[1]||'').replace(/<[^>]+>/g,'').trim();
    const bi = blk.indexOf('<div class="body">');
    let body=''; if(bi>=0){ const inner = blk.slice(bi+'<div class="body">'.length); const last = inner.lastIndexOf('</div>'); body = inner.slice(0, last); }
    out.push({ ttl, meta, body: '<div class="body">'+body+'</div>' });
  }
  return out;
}

// すべての試合レコードへ正規化
function norm(m){
  const body = m.body || mkBody(m);
  const id = (body.match(/embed\/([A-Za-z0-9_-]{6,})/)||[])[1] || m.id || '';
  const league = leagueOf(m.ttl+' '+m.meta+' '+body.replace(/<[^>]+>/g,' '));
  // チーム・選手解析
  let mt=m.ttl, prefix=null;
  if (mt.includes('─')){ const p=mt.split('─'); prefix=p[0].trim(); mt=p.slice(1).join('─').trim(); }
  const teams = mt.split(/\s*vs\s*/i).map(s=>s.trim()).filter(Boolean);
  const factsBlock = (body.match(/<ul class="facts">([\s\S]*?)<\/ul>/)||[])[1]||'';
  const factsText = factsBlock.replace(/<[^>]+>/g,' ');
  const players = CANON.filter(p => m.ttl.includes(p) || factsText.includes(p));
  let jpNote=''; const fm = factsText.match(/日本人選手：([^。<]*)/); if (fm) jpNote=fm[1].trim();
  let topic=''; const tm = m.meta.match(/[・/]\s*([^・/]*(?:弾|ゴール|アシスト|勝|敗|ドロー|無失点|セーブ|MOM|優勝|首位|ダービー|決定|突破|快勝|大勝|初[^・/]*)[^・/]*)\s*$/); if (tm) topic=tm[1].trim();
  const dual = /class="dualnote"/.test(body);
  const lineup = /class="lineup"/.test(body);
  return { id, ttl:m.ttl, mt, prefix, meta:m.meta, league, teams, players, jpNote, topic, dual, lineup, body };
}

const all = [...staticMatches().map(norm), ...EXTRA_WC.map(norm), ...EXTRA_JL.map(norm), ...EXTRA_CLUB.map(norm)];
// id 重複排除（先勝ち）
const seenId=new Set(); const data=[];
for(const m of all){ const key=m.id||m.ttl; if(seenId.has(key))continue; seenId.add(key); data.push(m); }

// 関連（チーム別・選手別）
const byTeam={}, byPlayer={};
data.forEach(m=>{ m.teams.forEach(t=>{ (byTeam[t]=byTeam[t]||[]).push(m); }); m.players.forEach(p=>{ (byPlayer[p]=byPlayer[p]||[]).push(m); }); });
function relatedMatches(m){
  const seen=new Set([m.id]); const rel=[];
  m.players.forEach(p=> (byPlayer[p]||[]).forEach(x=>{ if(x.id&&!seen.has(x.id)){seen.add(x.id);rel.push({m:x,why:p})} }));
  m.teams.forEach(t=> (byTeam[t]||[]).forEach(x=>{ if(x.id&&!seen.has(x.id)){seen.add(x.id);rel.push({m:x,why:t})} }));
  return rel.slice(0,8);
}
function entityMatches(name){ return (byTeam[name]||[]).filter(m=>m.id); }
// 個別ページの有無（試合ページ→ハブページの内部リンク用に先に確定）
const PAGE_OF = {};
for(const [n,info] of Object.entries(COUNTRIES)) if(entityMatches(n).length) PAGE_OF[n]=`country/${info.slug}.html`;
for(const [n] of Object.entries(CLUBS)) PAGE_OF[n]=`club/${CLUBS[n].slug}.html`;

// ========================= 共通パーツ =========================
const HEAD = (o)=>`<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(o.title)}</title>
<meta name="description" content="${escA(o.desc)}">
<meta name="robots" content="index,follow,max-image-preview:large"><meta name="theme-color" content="#0c1657">
<link rel="canonical" href="${o.url}">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7948789271209448" crossorigin="anonymous"></script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet">
<link rel="icon" type="image/svg+xml" href="../favicon.svg"><link rel="apple-touch-icon" href="../apple-touch-icon.png">
<meta property="og:type" content="${o.ogtype||'article'}"><meta property="og:site_name" content="Football Highlights Compass"><meta property="og:locale" content="ja_JP">
<meta property="og:title" content="${escA(o.ogtitle||o.title)}"><meta property="og:description" content="${escA(o.desc)}">
<meta property="og:url" content="${o.url}"><meta property="og:image" content="${o.ogimg}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escA(o.ogtitle||o.title)}"><meta name="twitter:image" content="${o.ogimg}">
${o.jsonld?`<script type="application/ld+json">${JSON.stringify(o.jsonld)}</script>`:''}
<link rel="stylesheet" href="../article.css">
</head><body>`;

const TOPBAR = `<nav class="topbar"><div class="tinner">
  <a class="brand" href="../"><img src="../favicon.svg" alt="" width="26" height="26"><span>Football Highlights Compass</span></a>
  <a class="tback" href="../">← トップ</a>
</div></nav>`;

const FOOTER = (extra='')=>`<footer class="post-foot">
  ${extra}
  <p>掲載は公式・権利元が公開している映像のみ。無断転載・切り抜きは扱いません。動画は各権利元の公式プレイヤーで再生されます。</p>
  <p><a href="../">▶ トップで他の試合を探す（W杯・Jリーグ・日本人所属クラブ）</a></p>
  <p class="cc">© 2026 Football Highlights Compass — 公式映像の発見サイト</p>
</footer></article></body></html>`;

function crumb(items){ return `<nav class="crumb">${items.map((it,i)=> it.href?`<a href="${it.href}">${esc(it.label)}</a>`:`<span>${esc(it.label)}</span>`).join('<i>›</i>')}</nav>`; }

// 試合カード（関連・一覧用）
function matchCard(m, sub){
  const t = titleWithFlags(m);
  const thumb = m.id?`https://i.ytimg.com/vi/${m.id}/hqdefault.jpg`:'';
  return `<a class="mcard" href="../match/${m.id}.html">
    <span class="mthumb">${thumb?`<img src="${thumb}" alt="" loading="lazy">`:''}<span class="mplay">▶</span></span>
    <span class="mttl">${t}</span>${sub?`<span class="msub">${esc(sub)}</span>`:''}</a>`;
}
function titleWithFlags(m){
  if(m.league==='wc' && m.teams.length===2) return (flagImg(m.teams[0])||'')+' '+esc(m.teams[0])+' <em>vs</em> '+(flagImg(m.teams[1])||'')+' '+esc(m.teams[1]);
  if(m.prefix) return `<span class="mpre">${esc(m.prefix)}</span> `+esc(m.mt);
  return esc(m.ttl);
}

// ========================= article.css =========================
const CSS = `:root{
  --bg:#f3f5fb; --paper:#ffffff; --ink:#16203a; --ink2:#33405e; --muted:#5f6b86; --soft:#8a95b2;
  --line:#e4e9f5; --line2:#d3dcf0; --accent:#1b2a78; --accent2:#2746c9; --warn:#b9760a; --red:#e11d48;
  --pill:#eef2fd; --card2:#f4f7fe;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:"Helvetica Neue",Helvetica,Arial,"Noto Sans JP","Hiragino Kaku Gothic ProN","Yu Gothic UI",sans-serif;
  line-height:1.8;-webkit-font-smoothing:antialiased;font-feature-settings:"palt" 1}
a{color:var(--accent2)}
img{max-width:100%}
/* topbar */
.topbar{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.86);backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--line)}
.tinner{max-width:1040px;margin:0 auto;display:flex;align-items:center;gap:12px;padding:9px 18px}
.brand{display:flex;align-items:center;gap:9px;text-decoration:none;color:var(--accent);font-weight:800;font-size:14px;letter-spacing:.01em;min-width:0}
.brand img{border-radius:6px;flex:0 0 auto}
.brand span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tback{margin-left:auto;font-size:13px;text-decoration:none;color:var(--muted);white-space:nowrap}
.tback:hover{color:var(--accent2)}
/* article shell */
.post{max-width:720px;margin:0 auto;padding:18px 20px 70px}
.crumb{font-size:12px;color:var(--soft);margin:6px 0 18px;display:flex;flex-wrap:wrap;align-items:center;gap:2px}
.crumb a{color:var(--muted);text-decoration:none}.crumb a:hover{color:var(--accent2)}
.crumb i{font-style:normal;margin:0 7px;color:var(--line2)}
.kicker{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--accent2);margin:0 0 10px}
.kicker .flag{height:15px}
.headline{font-size:33px;line-height:1.28;font-weight:900;letter-spacing:.01em;margin:0 0 14px;color:var(--ink)}
.headline em{font-style:normal;color:var(--soft);font-weight:700;font-size:.7em;margin:0 4px;vertical-align:.05em}
.headline .flag{height:24px;border-radius:3px;vertical-align:-3px;box-shadow:0 0 0 .5px rgba(0,0,0,.12)}
.headline .mpre{display:inline-block;color:var(--accent2);font-size:.62em;font-weight:800;letter-spacing:.04em;margin-right:6px}
.dek{font-size:18px;line-height:1.75;color:var(--ink2);margin:0 0 18px;font-weight:500}
.byline{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;font-size:13px;color:var(--muted);padding:13px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin:0 0 22px}
.byline .b{display:inline-flex;align-items:center;gap:5px}
.byline .lg{font-weight:800;color:var(--accent)}
/* body prose */
.post-body{font-size:16.5px;line-height:1.95}
.post-body p{margin:0 0 18px}
.post-body h2{font-size:21px;font-weight:900;letter-spacing:.01em;margin:34px 0 12px;padding-top:6px}
.post-body h2.lined{border-top:2px solid var(--ink);padding-top:14px}
.warn-strip{display:flex;gap:10px;align-items:flex-start;background:#fff8ec;border:1px solid #f0dcb4;border-left:3px solid var(--warn);border-radius:10px;padding:11px 13px;font-size:13.5px;color:#7a5410;margin:0 0 22px}
/* ===== 試合本文の埋め込みコンポーネント（index と共通の見た目） ===== */
.score{font-size:26px;font-weight:900;margin:6px 0 4px;letter-spacing:.02em}
.score .n{color:var(--accent)}
ul.facts{margin:10px 0 18px;padding-left:20px;font-size:15.5px;line-height:1.9}
ul.facts li{margin:5px 0}
.sources{display:grid;gap:14px;margin:14px 0}
.source{border:1px solid var(--line2);border-radius:14px;background:var(--paper);overflow:hidden;box-shadow:0 2px 10px rgba(20,30,90,.05)}
.source:first-child{box-shadow:0 8px 26px rgba(20,30,90,.12)}
.source-head{display:flex;align-items:center;gap:9px;padding:11px 14px;font-size:13px;flex-wrap:wrap}
.source-head .name{font-weight:800}
.source-head .geo{color:var(--muted)}
.tag{font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;white-space:nowrap;border:1px solid transparent}
.tag.embed,.tag.clean{background:rgba(37,99,235,.13);color:var(--accent);border-color:rgba(37,99,235,.34)}
.tag.link{background:rgba(59,130,246,.12);color:#1d4ed8;border-color:rgba(59,130,246,.34)}
.tag.blocked,.tag.spoiler{background:rgba(244,183,64,.14);color:var(--warn);border-color:rgba(244,183,64,.4)}
.dualnote{font-size:13px;color:var(--accent);margin:4px 0 10px;font-weight:700}
.embedwrap{position:relative;width:100%;aspect-ratio:16/9;background:#000;border-top:1px solid var(--line)}
.embedwrap iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
a.golink{display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit;padding:14px;border-top:1px solid var(--line)}
a.golink:hover{background:var(--card2)}
a.golink .play{flex:0 0 auto;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--red);color:#fff;font-size:15px}
a.golink .play.fifa{background:#326efd}a.golink .play.dazn{background:#f8f400;color:#111}
a.golink .lbl{font-size:14px}a.golink .lbl small{display:block;color:var(--muted);font-size:12px}
a.golink .go{margin-left:auto;color:var(--accent2);font-size:12.5px;white-space:nowrap}
.src{color:var(--muted);font-size:12.5px;margin-top:14px}.src a{color:var(--muted)}
.lineup{margin-top:14px;padding:12px 14px;background:var(--card2);border:1px solid var(--line);border-radius:12px;font-size:13.5px;line-height:2;color:var(--ink)}
.lineup .src2{color:var(--muted);font-size:11px;margin-left:6px}
/* fact card */
.factcard{background:var(--card2);border:1px solid var(--line2);border-radius:14px;padding:6px 18px;margin:24px 0}
.factcard table{width:100%;border-collapse:collapse;font-size:14.5px}
.factcard th{text-align:left;color:var(--muted);font-weight:700;white-space:nowrap;vertical-align:top;padding:10px 14px 10px 0;width:1%}
.factcard td{padding:10px 0;vertical-align:top}
.factcard tr+tr th,.factcard tr+tr td{border-top:1px solid var(--line)}
/* related cards */
.mcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:13px;margin:14px 0 6px}
.mcard{display:flex;flex-direction:column;text-decoration:none;color:inherit;background:var(--paper);border:1px solid var(--line2);border-radius:13px;overflow:hidden;box-shadow:0 2px 9px rgba(20,30,90,.06);transition:transform .09s,box-shadow .15s}
.mcard:hover{transform:translateY(-2px);box-shadow:0 9px 22px rgba(20,30,90,.15)}
.mthumb{position:relative;aspect-ratio:16/9;background:#0b1430;display:block}
.mthumb img{width:100%;height:100%;object-fit:cover;display:block}
.mplay{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:38px;height:38px;border-radius:50%;background:rgba(225,29,72,.92);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 3px 12px rgba(0,0,0,.34)}
.mttl{padding:10px 12px 4px;font-size:13px;font-weight:700;line-height:1.46}
.mttl .flag{height:13px;border-radius:2px;vertical-align:-2px}
.mttl em{font-style:normal;color:var(--soft);font-size:.85em;margin:0 2px}
.mttl .mpre{display:block;color:var(--accent2);font-size:11px;font-weight:800;margin-bottom:1px}
.msub{padding:0 12px 11px;font-size:11.5px;color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0 6px}
.chips a{font-size:13px;text-decoration:none;padding:6px 13px;border-radius:999px;border:1px solid var(--line2);background:var(--paper);color:var(--ink)}
.chips a:hover{border-color:var(--accent);color:var(--accent)}
.chips a .flag{height:12px;vertical-align:-1px;margin-right:4px}
/* entity hero */
.ehero{position:relative;border-radius:18px;overflow:hidden;margin:0 0 22px;color:#fff;background:linear-gradient(120deg,#0c1657,#1b2a78 58%,#26368f);box-shadow:0 10px 30px rgba(16,26,86,.24)}
.ehero .ei{display:flex;align-items:center;gap:18px;padding:26px 24px}
.ehero .crest{flex:0 0 auto;width:74px;height:74px;border-radius:16px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.28);display:flex;align-items:center;justify-content:center;font-size:34px;overflow:hidden}
.ehero .crest img{width:60px;height:auto;border-radius:5px;box-shadow:0 1px 6px rgba(0,0,0,.4)}
.ehero h1{font-size:30px;font-weight:900;letter-spacing:.01em;margin:0 0 4px;line-height:1.2}
.ehero .esub{color:#cdd6f6;font-size:13.5px;font-weight:600}
.post-foot{margin-top:40px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13.5px}
.post-foot p{margin:7px 0}.post-foot a{color:var(--accent2);text-decoration:none}
.post-foot .cc{color:var(--soft);font-size:12.5px;margin-top:14px}
@media(max-width:560px){
  .headline{font-size:27px}.dek{font-size:16.5px}.post{padding:14px 16px 60px}
  .ehero h1{font-size:24px}.ehero .ei{padding:20px 18px;gap:14px}.ehero .crest{width:60px;height:60px}.ehero .crest img{width:48px}
}
/* ページ表示時のフェードイン（カルーセル等からの切替を滑らかに） */
@keyframes pageIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.post{animation:pageIn .42s cubic-bezier(.2,.7,.2,1) both}
@media(prefers-reduced-motion:reduce){.post{animation:none}}
/* 広告枠（レスポンシブ） */
.ad{margin:28px auto 6px;max-width:728px;text-align:center;min-height:100px}
.ad .adlabel{display:block;font-size:10px;letter-spacing:.08em;color:var(--muted);margin-bottom:4px}
.ad ins{display:block}`;

// 広告枠（slot は AdSense 管理画面で作成した広告ユニットIDに置換する）
const AD = `<div class="ad"><span class="adlabel">広告</span><ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-7948789271209448" data-ad-slot="__AD_SLOT__" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(function(){var i=document.currentScript.previousElementSibling;if(i&&i.getAttribute('data-ad-slot')==='__AD_SLOT__'){var b=i.closest('.ad');if(b)b.style.display='none';}else{(adsbygoogle=window.adsbygoogle||[]).push({});}})();</script></div>`;

mkdirSync('site/match', { recursive:true });
mkdirSync('site/country', { recursive:true });
mkdirSync('site/club', { recursive:true });
writeFileSync('site/article.css', CSS);

// ========================= 試合ページ =========================
const slugs=[];
function buildMatch(m){
  if(!m.id || slugs.includes(m.id)) return; slugs.push(m.id);
  const lg = LG[m.league]||''; const teamsTxt = m.teams.join(' vs ');
  // dek（固有サマリー）
  const s=[];
  s.push(`${m.prefix?m.prefix+'が出場した':''}${teamsTxt||m.mt}${lg?'、'+lg:''}の公式ハイライトです。`);
  if (m.players.length){
    let extra = (m.jpNote||'').replace(new RegExp(m.players.join('|'),'g'),'').replace(/[（）()・,，\s]/g,' ').replace(/ほか|など/g,'').trim();
    s.push(`${m.players.join('・')}が出場${extra?`（${extra}）`:''}。`);
  }
  else if (m.topic) s.push(`見どころは${m.topic}。`);
  s.push(m.dual?'映像は「ネタバレ控えめ版（結果が出ないMATCH RECAP）」と「ネタバレあり版」を用意。お好みで選べます。':'公式映像のみを掲載しています。');
  const dek = s.join('');
  const desc = `${teamsTxt||m.mt}${lg?'（'+lg+'）':''}の公式ハイライト。${m.players.length?m.players.join('・')+'出場。':''}${m.topic?m.topic+'。':''}公式映像のみ・ネタバレ防止。`.slice(0,120);
  // fact card
  const facts=[];
  if(lg) facts.push(['大会', lg]);
  facts.push(['対戦', teamsTxt||m.mt]);
  if(m.meta) facts.push(['節・日程', m.meta]);
  if(m.players.length) facts.push(['日本人選手', m.jpNote||m.players.join('・')]);
  if(m.topic) facts.push(['見どころ', m.topic]);
  const factHtml = `<div class="factcard"><table>${facts.map(f=>`<tr><th>${esc(f[0])}</th><td>${esc(String(f[1]))}</td></tr>`).join('')}</table></div>`;
  // チーム/国のハブページへの内部リンク
  const teamLinks = m.teams.map(t=> PAGE_OF[t] ? `<a href="../${PAGE_OF[t]}">${m.league==='wc'?flagImg(t):''}${esc(t)}</a>` : '').filter(Boolean);
  const teamHtml = teamLinks.length ? `<h2>チーム・${m.league==='wc'?'国':'クラブ'}を深掘り</h2><div class="chips">${teamLinks.join('')}</div>` : '';
  // related
  const rel = relatedMatches(m);
  const relHtml = rel.length ? `<h2 class="lined">関連する試合</h2><div class="mcards">${rel.map(r=>matchCard(r.m, r.why)).join('')}</div>` : '';
  const ogimg = m.id?`https://i.ytimg.com/vi/${m.id}/hqdefault.jpg`:`${DOMAIN}/og.png`;
  const url = `${DOMAIN}/match/${m.id}.html`;
  const head = HEAD({
    title:`${m.ttl}｜公式ハイライト${lg?'・'+lg:''} - Football Highlights Compass`,
    ogtitle:`${m.ttl}｜公式ハイライト`, desc, url, ogimg, ogtype:'video.other',
    jsonld:{"@context":"https://schema.org","@type":"VideoObject","name":m.ttl+"｜公式ハイライト","description":desc,"thumbnailUrl":ogimg,"uploadDate":"2026-06-01","embedUrl":m.id?`https://www.youtube.com/embed/${m.id}`:url,"publisher":{"@type":"Organization","name":"Football Highlights Compass","url":DOMAIN+"/"}}
  });
  const catLabel = lg||'試合';
  const out = head + TOPBAR + `<article class="post">
  ${crumb([{label:'トップ',href:'../'},{label:catLabel},{label:m.mt}])}
  <p class="kicker">${m.league==='wc'&&m.teams.length===2?flagImg(m.teams[0])+flagImg(m.teams[1]):'⚽'} ${esc(lg||'公式ハイライト')}</p>
  <h1 class="headline">${titleWithFlags(m)}</h1>
  <p class="dek">${esc(dek)}</p>
  <div class="byline"><span class="b lg">${esc(lg||'')}</span>${m.meta?`<span class="b">📅 ${esc(m.meta)}</span>`:''}${m.players.length?`<span class="b">🇯🇵 ${esc(m.players.join('・'))}</span>`:''}</div>
  <div class="warn-strip"><span>⚠️</span><div>このページは試合結果・スコアを含みます。ネタバレを避けたい方はご注意ください。</div></div>
  <div class="post-body">${m.body.replace(/^<div class="body"[^>]*>/,'').replace(/<\/div>\s*$/,'')}</div>
  ${AD}
  ${factHtml}
  ${teamHtml}
  ${relHtml}
  ` + FOOTER(`<p>${m.lineup?'出場選手データ：Jリーグ公式。':''}</p>`);
  writeFileSync(`site/match/${m.id}.html`, out);
}
data.forEach(buildMatch);

// ========================= 国・クラブ個別ページ =========================
const ENTITY_PAGES = PAGE_OF; // name -> "country/slug.html"|"club/slug.html"

function buildCountry(name, info){
  const ms = entityMatches(name); if(!ms.length && !info) return;
  const slug = info.slug; const path=`country/${slug}.html`;
  const flag = flagImg(name);
  const url=`${DOMAIN}/${path}`;
  const ogimg = ms[0]?`https://i.ytimg.com/vi/${ms[0].id}/hqdefault.jpg`:`${DOMAIN}/og.png`;
  const dek = info.blurb[0]||'';
  const desc = `${name}代表のW杯26 公式ハイライトと歴史。${info.confed}／最高成績：${info.peak}。公式映像のみ・ネタバレ防止で${ms.length}試合を掲載。`.slice(0,120);
  const head = HEAD({ title:`${name}代表｜W杯公式ハイライトと歴史 - Football Highlights Compass`, ogtitle:`${name}代表｜W杯公式ハイライトと歴史`, desc, url, ogimg,
    jsonld:{"@context":"https://schema.org","@type":"SportsTeam","name":name+"代表","sport":"Football","memberOf":{"@type":"SportsOrganization","name":info.confed}} });
  const blurbHtml = info.blurb.map(p=>`<p>${esc(p)}</p>`).join('');
  const factHtml = `<div class="factcard"><table>
    <tr><th>所属連盟</th><td>${esc(info.confed)}</td></tr>
    <tr><th>W杯最高成績</th><td>${esc(info.peak)}</td></tr>
    ${info.talent?`<tr><th>主なタレント</th><td>${esc(info.talent)}</td></tr>`:''}
  </table></div>`;
  const list = ms.length?`<h2 class="lined">${esc(name)}の公式ハイライト（${ms.length}試合）</h2><div class="mcards">${ms.slice(0,30).map(m=>matchCard(m, m.meta)).join('')}</div>`:'';
  // 関連：同連盟の他国
  const sameConfed = Object.entries(COUNTRIES).filter(([n,i])=>n!==name && i.confed===info.confed && entityMatches(n).length>0).slice(0,12);
  const related = sameConfed.length?`<h2>同じ連盟の国</h2><div class="chips">${sameConfed.map(([n,i])=>`<a href="../country/${i.slug}.html">${flagImg(n)}${esc(n)}</a>`).join('')}</div>`:'';
  const out = head + TOPBAR + `<article class="post entity">
  ${crumb([{label:'トップ',href:'../'},{label:'国（ワールドカップ）'},{label:name}])}
  <p class="kicker">${flag} ${esc(info.confed)}</p>
  <div class="ehero"><div class="ei"><span class="crest">${flag||'🌍'}</span><div><h1>${esc(name)}代表</h1><div class="esub">FIFAワールドカップ26 ／ 最高成績：${esc(info.peak)}</div></div></div></div>
  <p class="dek">${esc(dek)}</p>
  <div class="post-body">${info.blurb.slice(1).map(p=>`<p>${esc(p)}</p>`).join('')||''}</div>
  ${factHtml}
  ${AD}
  ${list}
  ${related}
  ` + FOOTER();
  writeFileSync(`site/${path}`, out);
}

function buildClub(name, info){
  const ms = entityMatches(name); const slug=info.slug; const path=`club/${slug}.html`;
  const flag = flagImg2(info.iso);
  const url=`${DOMAIN}/${path}`;
  const ogimg = ms[0]?`https://i.ytimg.com/vi/${ms[0].id}/hqdefault.jpg`:`${DOMAIN}/og.png`;
  const dek = info.blurb[0]||'';
  const desc = `${name}（${info.league}）の公式ハイライトとクラブの歴史。${info.founded}年創設・本拠地${info.stadium}。公式映像のみ・ネタバレ防止で${ms.length}試合を掲載。`.slice(0,120);
  const head = HEAD({ title:`${name}｜公式ハイライトとクラブの歴史 - Football Highlights Compass`, ogtitle:`${name}｜公式ハイライトとクラブの歴史`, desc, url, ogimg,
    jsonld:{"@context":"https://schema.org","@type":"SportsTeam","name":name,"sport":"Football","foundingDate":String(info.founded),"location":info.country} });
  const factHtml = `<div class="factcard"><table>
    <tr><th>国・リーグ</th><td>${flag} ${esc(info.country)}／${esc(info.league)}</td></tr>
    <tr><th>創設</th><td>${esc(String(info.founded))}年</td></tr>
    <tr><th>本拠地</th><td>${esc(info.stadium)}</td></tr>
    ${info.honors?`<tr><th>主なタイトル</th><td>${esc(info.honors)}</td></tr>`:''}
  </table></div>`;
  const list = ms.length?`<h2 class="lined">${esc(name)}の公式ハイライト（${ms.length}試合）</h2><div class="mcards">${ms.slice(0,30).map(m=>matchCard(m, m.meta)).join('')}</div>`:'';
  const sameLeague = Object.entries(CLUBS).filter(([n,i])=>n!==name && i.league===info.league).slice(0,12);
  const related = sameLeague.length?`<h2>同じリーグのクラブ</h2><div class="chips">${sameLeague.map(([n,i])=>`<a href="../club/${i.slug}.html">${esc(n)}</a>`).join('')}</div>`:'';
  const out = head + TOPBAR + `<article class="post entity">
  ${crumb([{label:'トップ',href:'../'},{label:'クラブ'},{label:name}])}
  <p class="kicker">${flag} ${esc(info.league)}</p>
  <div class="ehero"><div class="ei"><span class="crest">${flag||'🛡️'}</span><div><h1>${esc(name)}</h1><div class="esub">${esc(info.country)} ／ ${esc(info.league)} ／ ${esc(String(info.founded))}年創設</div></div></div></div>
  <p class="dek">${esc(dek)}</p>
  <div class="post-body">${info.blurb.slice(1).map(p=>`<p>${esc(p)}</p>`).join('')||''}</div>
  ${factHtml}
  ${AD}
  ${list}
  ${related}
  ` + FOOTER();
  writeFileSync(`site/${path}`, out);
}
function flagImg2(iso){ return iso?`<img class="flag" src="https://flagcdn.com/w40/${iso}.png" srcset="https://flagcdn.com/w80/${iso}.png 2x" alt="" loading="lazy">`:''; }

let nc=0, ncl=0;
for(const [name,info] of Object.entries(COUNTRIES)){ if(entityMatches(name).length){ buildCountry(name,info); nc++; } }
for(const [name,info] of Object.entries(CLUBS)){ buildClub(name,info); ncl++; }

// ENTITY_PAGES を index.html に注入
{
  const map = JSON.stringify(ENTITY_PAGES);
  const re = /\/\*ENTITY_PAGES_START\*\/[\s\S]*?\/\*ENTITY_PAGES_END\*\//;
  const next = html.replace(re, `/*ENTITY_PAGES_START*/\nvar ENTITY_PAGES = ${map};\n/*ENTITY_PAGES_END*/`);
  writeFileSync('site/index.html', next);
}

// ========================= sitemap =========================
let sm = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${DOMAIN}/</loc><lastmod>${TODAY}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
for(const p of new Set(Object.values(ENTITY_PAGES))) sm += `  <url><loc>${DOMAIN}/${p}</loc><lastmod>${TODAY}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
for(const s of slugs) sm += `  <url><loc>${DOMAIN}/match/${s}.html</loc><lastmod>${TODAY}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
sm += `</urlset>\n`; writeFileSync('site/sitemap.xml', sm);

console.log(`試合ページ: ${slugs.length} / 国: ${nc} / クラブ: ${ncl} / sitemap URL: ${slugs.length + new Set(Object.values(ENTITY_PAGES)).size + 1}`);
