// 純Node生成（Playwright/サーバ不要）
// site/index.html を直接パースして
//  - site/article.css（Gizmodo風・個別ページ共通CSS）
//  - site/match/<id>.html（試合ページ・リデザイン）
//  - site/country/<slug>.html, site/club/<slug>.html（国/クラブ個別ページ＋歴史）
//  - site/sitemap.xml
//  - index.html 内 ENTITY_PAGES マップを注入
// を生成する。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { COUNTRIES, CLUBS, DEEP } from './entities.mjs';

const DOMAIN = 'https://highlight-compass.com';
const TODAY = new Date().toISOString().slice(0,10);   // ビルド実行日（動的）
const html = readFileSync('site/index.html', 'utf8');

// ---------- W杯スケジュール（P2でデータ投入。無くてもフォールバックで動く） ----------
let SCHEDULE = [];
try { if (existsSync('data/wc2026-schedule.json')) SCHEDULE = (JSON.parse(readFileSync('data/wc2026-schedule.json','utf8')).matches)||[]; }
catch(e){ console.warn('schedule読込失敗:', e.message); }
const SCHED_BY_VID = new Map(), SCHED_BY_TEAMS = new Map();
for (const s of SCHEDULE){ if(s.videoId) SCHED_BY_VID.set(s.videoId, s); if(s.home?.ja && s.away?.ja) SCHED_BY_TEAMS.set([s.home.ja,s.away.ja].sort().join('|'), s); }
function schedFor(m){
  if (m.id && SCHED_BY_VID.has(m.id)) return SCHED_BY_VID.get(m.id);
  if (m.league==='wc' && m.teams && m.teams.length===2){ const k=[...m.teams].sort().join('|'); if(SCHED_BY_TEAMS.has(k)) return SCHED_BY_TEAMS.get(k); }
  return null;
}

// ---------- クラブ紋章（TheSportsDB・slug→URL。無いクラブは国旗フォールバック） ----------
let CREST = {};
try { if (existsSync('data/club-crests.json')) CREST = JSON.parse(readFileSync('data/club-crests.json','utf8')); } catch(e){ console.warn('crest読込失敗:', e.message); }

// ---------- スコア（videoId→"2-3" 等。実結果ベースで data/scores.json に手動記録。ネタバレOFF時のみ各一覧で表示） ----------
let SCORES = {};
try { if (existsSync('data/scores.json')) SCORES = JSON.parse(readFileSync('data/scores.json','utf8')); } catch(e){ console.warn('scores読込失敗:', e.message); }

// ---------- エンティティ解説（name→独自の1段落。Web検証で data/entity-sections.json に記録。国・クラブの本文に追記） ----------
let SECTIONS = {};
try { if (existsSync('data/entity-sections.json')) SECTIONS = JSON.parse(readFileSync('data/entity-sections.json','utf8')); } catch(e){ console.warn('sections読込失敗:', e.message); }

// ---------- アフィリエイト（DAZN）。data/affiliate.json の daznUrl に成果リンクを設定。空なら通常リンクにフォールバック ----------
let AFFILIATE = {};
try { if (existsSync('data/affiliate.json')) AFFILIATE = JSON.parse(readFileSync('data/affiliate.json','utf8')); } catch(e){ console.warn('affiliate読込失敗:', e.message); }

// ---------- 広告（Google AdSense）。data/ads.json の adSlot に広告ユニットIDを設定。空なら __AD_SLOT__ のまま＝空枠ガードで非表示 ----------
let ADS = {};
try { if (existsSync('data/ads.json')) ADS = JSON.parse(readFileSync('data/ads.json','utf8')); } catch(e){ console.warn('ads読込失敗:', e.message); }
const AD_CLIENT = (ADS.adClient||'ca-pub-7948789271209448').trim();
const AD_SLOT = (ADS.adSlot||'').trim() || '__AD_SLOT__';   // 空なら placeholder のまま（スクリプトが枠を自動非表示）

// ---------- アクセス解析（Google Analytics 4）。data/analytics.json の ga4MeasurementId に G-XXXX を設定。空なら出力なし ----------
let ANALYTICS = {};
try { if (existsSync('data/analytics.json')) ANALYTICS = JSON.parse(readFileSync('data/analytics.json','utf8')); } catch(e){ console.warn('analytics読込失敗:', e.message); }
const GA4_ID = (ANALYTICS.ga4MeasurementId||'').trim();
const GA = GA4_ID ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_ID}"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA4_ID}');</script>` : '';

// ---------- W杯グループ戦の公式結果（matchId→"H-A" ホーム-アウェイ順）。順位表を全72試合準拠にする。Web検証で記録 ----------
let WCRESULTS = {};
try { if (existsSync('data/wc-results.json')) WCRESULTS = JSON.parse(readFileSync('data/wc-results.json','utf8')); } catch(e){ console.warn('wc-results読込失敗:', e.message); }

// ---------- W杯 決勝トーナメントの対戦カード（data/wc-knockout.json）。r32等の home/away/result/videoId。結果はネタバレ防止で既定隠し ----------
let WCKO = {};
try { if (existsSync('data/wc-knockout.json')) WCKO = JSON.parse(readFileSync('data/wc-knockout.json','utf8')); } catch(e){ console.warn('wc-knockout読込失敗:', e.message); }
// DAZN訴求CTA。アフィリリンク設定時は rel="sponsored"＋「PR」表記（ステマ規制対応）。未設定時は公式リンク(nofollow)。
function daznCta(context){
  const aff = (AFFILIATE.daznUrl||'').trim();
  const url = aff || 'https://www.dazn.com/ja-JP/';
  const rel = aff ? 'sponsored nofollow noopener' : 'nofollow noopener';
  const pr = aff ? '<span class="dc-pr">PR</span>' : '';
  return `<aside class="dazn-cta">${pr}<div class="dc-txt"><b>フル・見逃し配信を観るなら</b><span>${esc(context||'ハイライトの先は、DAZNで全試合フル＆見逃し配信。')}</span></div><a class="dc-btn" href="${url}" target="_blank" rel="${rel}">▶ DAZNで観る</a></aside>`;
}

// ---------- 構造化データ（JSON-LD）ヘルパ ----------
const ORG = {"@type":"Organization","name":"Football Highlights Compass","url":DOMAIN+"/","logo":DOMAIN+"/apple-touch-icon.png"};
// 配列なら @graph でまとめる
const ld = x => Array.isArray(x) ? {"@context":"https://schema.org","@graph":x} : x;
// パンくず（表示用 crumb() と同じ並びから生成）。items:[{name,url?}]
// 全 ListItem に item(URL) を必須付与（Google: 末尾以外は必須／無いと「itemがありません」エラー）。url未指定はトップにフォールバック。
function crumbLd(items){ return {"@type":"BreadcrumbList","itemListElement":items.map((it,i)=>({"@type":"ListItem","position":i+1,"name":it.name,"item":it.url||DOMAIN+'/'}))}; }
// 試合一覧の ItemList
function itemListLd(ms){ return {"@type":"ItemList","itemListElement":ms.slice(0,30).map((mm,i)=>({"@type":"ListItem","position":i+1,"name":mm.ttl,"item":`${DOMAIN}/match/${mm.id}.html`}))}; }

const CANON = ['久保建英','鈴木彩艶','南野拓実','堂安律','守田英正','佐野海舟','伊藤洋輝','菅原由勢','藤田譲瑠チマ','川﨑颯太','長田澪','鎌田大地','上田綺世','伊東純也'];
const LG = { wc:'FIFAワールドカップ26', jl:'Jリーグ2026', laliga:'ラ・リーガ', seriea:'セリエA', ligue1:'リーグアン', bundes:'ブンデスリーガ', portugal:'ポルトガルリーグ', other:'' };
// 欧州リーグのハブページ定義（clubLabel は entities.mjs の CLUBS[].league 表記に一致させる）
const LEAGUE_HUBS = [
  { name:'ラ・リーガ', slug:'laliga', clubLabel:'ラ・リーガ', country:'スペイン', blurb:'スペイン1部リーグ。世界屈指の技術レベルで知られ、日本人選手も活躍しています。' },
  { name:'セリエA', slug:'serie-a', clubLabel:'セリエA', country:'イタリア', blurb:'イタリア1部リーグ。堅守と戦術の伝統で知られます。' },
  { name:'ブンデスリーガ', slug:'bundesliga', clubLabel:'ブンデスリーガ', country:'ドイツ', blurb:'ドイツ1部リーグ。多くの日本人選手が在籍してきたリーグです。' },
  { name:'リーグアン', slug:'ligue-1', clubLabel:'リーグアン', country:'フランス', blurb:'フランス1部リーグ。' },
  { name:'プリメイラ・リーガ', slug:'primeira-liga', clubLabel:'プリメイラ・リーガ', country:'ポルトガル', blurb:'ポルトガル1部リーグ。' },
];
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
const parseObjs = s => (s.match(/\{[^{}]*\}/g)||[]).map(o=>({ ttl:(o.match(/ttl:"([^"]*)"/)||[])[1]||'', meta:(o.match(/meta:"([^"]*)"/)||[])[1]||'', jp:(o.match(/jp:"([^"]*)"/)||[])[1]||'', id:(o.match(/id:"([^"]*)"/)||[])[1]||'' }));
function extra(name){ return parseObjs(slice('const '+name+' = [', '\n];')); }
// 自動検知ぶん（inject-wc.mjs が /*WC_AUTO*/ マーカーに注入する EXTRA_WC_AUTO）も合流
function extraAuto(){ const m = html.match(/EXTRA_WC_AUTO\s*=\s*(\[[\s\S]*?\]);/); return m ? parseObjs(m[1]) : []; }
const EXTRA_WC = [...extra('EXTRA_WC'), ...extraAuto()], EXTRA_JL = extra('EXTRA_JL'), EXTRA_CLUB = extra('EXTRA_CLUB');

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
  // スコア：data/scores.json 優先、無ければ静的 details.match の .score（<span class="n">）から抽出
  let score = SCORES[id] || '';
  if(!score){ const sm = body.match(/<div class="score">([\s\S]*?)<\/div>/); if(sm){ const ns = (sm[1].match(/<span class="n">([^<]*)<\/span>/g)||[]).map(x=>x.replace(/<[^>]+>/g,'').trim()); if(ns.length>=2) score = ns[0]+'-'+ns[1]; } }
  // W杯の試合動画は wc-results.json から自動補完（scores.json 未登録でも必ず出す）。カードのチーム表示順に合わせて向き補正
  if(!score && id){
    let s = SCHED_BY_VID.get(id);
    if(!s && league==='wc' && teams.length===2){ const k=[...teams].sort().join('|'); s = SCHED_BY_TEAMS.get(k); }
    if(s && s.matchId && WCRESULTS[s.matchId]){
      const r = String(WCRESULTS[s.matchId]).match(/^(\d+)-(\d+)$/);
      if(r){ const h=s.home&&s.home.ja, a=s.away&&s.away.ja;
        if(teams[0]===a && teams[1]===h) score = r[2]+'-'+r[1];            // タイトルがアウェイ先
        else { if(teams[0]!==h) console.warn('WCスコア向き不明・H-A既定:', id, m.ttl); score = r[1]+'-'+r[2]; }
      }
    }
  }
  return { id, ttl:m.ttl, mt, prefix, meta:m.meta, league, teams, players, jpNote, topic, dual, lineup, body, score };
}

const all = [...staticMatches().map(norm), ...EXTRA_WC.map(norm), ...EXTRA_JL.map(norm), ...EXTRA_CLUB.map(norm)];
// id 重複排除（先勝ち）
const seenId=new Set(); const data=[];
for(const m of all){ const key=m.id||m.ttl; if(seenId.has(key))continue; seenId.add(key); data.push(m); }

// 関連（チーム別・選手別）
const byTeam={}, byPlayer={};
data.forEach(m=>{ m.teams.forEach(t=>{ (byTeam[t]=byTeam[t]||[]).push(m); }); m.players.forEach(p=>{ (byPlayer[p]=byPlayer[p]||[]).push(m); }); });

// 欧州リーグハブ：所属クラブ（CLUBS）の試合を集約。試合があるリーグだけ採用（薄いページ回避）
function leagueMatches(clubLabel){
  const clubsIn = Object.entries(CLUBS).filter(([,i])=>i.league===clubLabel).map(([n])=>n);
  const seen=new Set(), ms=[];
  clubsIn.forEach(c=> (byTeam[c]||[]).forEach(m=>{ if(m.id&&!seen.has(m.id)){ seen.add(m.id); ms.push(m); } }));
  return { clubsIn, ms };
}
const LEAGUE_LIST = LEAGUE_HUBS.filter(h=> leagueMatches(h.clubLabel).ms.length>0);
function leagueNavHtml(prefix){ return LEAGUE_LIST.length ? `<nav class="nav-guides nav-eu" aria-label="欧州リーグ"><div class="ng-h">🇪🇺 欧州リーグ</div>${LEAGUE_LIST.map(h=>`<a href="${prefix}league/${h.slug}.html">${esc(h.name)}</a>`).join('')}</nav>` : ''; }
function relatedMatches(m){
  const seen=new Set([m.id]); const rel=[];
  const add=(x,why)=>{ if(x&&x.id&&!seen.has(x.id)){ seen.add(x.id); rel.push({m:x,why}); } };
  // ① 同じ日本人選手 ② 同じ国・クラブ（最も関連が強い）
  m.players.forEach(p=> (byPlayer[p]||[]).forEach(x=>add(x,p)));
  m.teams.forEach(t=> (byTeam[t]||[]).forEach(x=>add(x,t)));
  // ③ W杯は同じグループの試合で補完
  if(m.league==='wc'){ const g=(schedFor(m)||{}).group; if(g){ data.forEach(x=>{ if(x.league==='wc' && (schedFor(x)||{}).group===g) add(x,`グループ${g}`); }); } }
  // ④ それでも少なければ同じ大会・リーグの試合で補完
  const lgName = LG[m.league]||'同じ大会';
  if(rel.length<12) data.forEach(x=>{ if(x.league===m.league) add(x,lgName); });
  return rel.slice(0,12);
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
<meta name="robots" content="${o.robots||'index,follow,max-image-preview:large'}"><meta name="theme-color" content="#0c1657">
<link rel="canonical" href="${o.url}">
${GA?GA+'\n':''}<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7948789271209448" crossorigin="anonymous"></script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://i.ytimg.com"><link rel="dns-prefetch" href="https://i.ytimg.com">
<link rel="preconnect" href="https://flagcdn.com"><link rel="dns-prefetch" href="https://flagcdn.com">
<link rel="dns-prefetch" href="https://r2.thesportsdb.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet">
<link rel="icon" type="image/svg+xml" href="../favicon.svg"><link rel="apple-touch-icon" href="../apple-touch-icon.png">
<meta property="og:type" content="${o.ogtype||'article'}"><meta property="og:site_name" content="Football Highlights Compass"><meta property="og:locale" content="ja_JP">
<meta property="og:title" content="${escA(o.ogtitle||o.title)}"><meta property="og:description" content="${escA(o.desc)}">
<meta property="og:url" content="${o.url}"><meta property="og:image" content="${o.ogimg}"><meta property="og:image:alt" content="${escA(o.ogtitle||o.title)}">${o.ogimg.includes('ytimg')?'<meta property="og:image:width" content="480"><meta property="og:image:height" content="360">':o.ogimg.endsWith('/og.png')?'<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">':''}
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escA(o.ogtitle||o.title)}"><meta name="twitter:image" content="${o.ogimg}"><meta name="twitter:image:alt" content="${escA(o.ogtitle||o.title)}"><meta name="twitter:description" content="${escA(o.desc)}">
${o.published?`<meta property="article:published_time" content="${o.published}">`:''}${o.modified?`<meta property="article:modified_time" content="${o.modified}">`:''}
${o.jsonld?`<script type="application/ld+json">${JSON.stringify(ld(o.jsonld))}</script>`:''}
<link rel="stylesheet" href="../article.css">
<script>try{if(localStorage.getItem('fhc_spoiler')==='0')document.documentElement.className+=' spoiler-off';}catch(e){}</script>
</head><body>`;

const TOPBAR = `<nav class="topbar"><div class="tinner">
  <a class="brand" href="../"><img src="../favicon.svg" alt="" width="26" height="26"><span>Football Highlights Compass</span></a>
  <a class="tback" href="../">← トップ</a>
</div></nav>`;

// クリック時の演出（Loading…→Go!）。a.mcard クリックを横取りして同じ演出で遷移
const BOOM = `<div class="boom" id="boom" aria-hidden="true"><div class="boom-bg"></div><div class="boom-center"><div class="boom-load">Loading…</div><div class="boom-stamp"><b>Go!</b></div><div class="boom-sub"></div></div></div>
<script>(function(){var rm=window.matchMedia&&matchMedia('(prefers-reduced-motion:reduce)').matches;var b=document.getElementById('boom');if(!b)return;var s=b.querySelector('.boom-sub');function go(h,l){if(rm){location.href=h;return;}s.textContent=l||'';b.className='boom go phase-load';void b.offsetWidth;setTimeout(function(){b.classList.remove('phase-load');b.classList.add('phase-go');},420);setTimeout(function(){b.classList.add('leaving');},760);setTimeout(function(){location.href=h;},860);}document.addEventListener('click',function(e){var a=e.target.closest('a.mcard');if(!a)return;if(e.metaKey||e.ctrlKey||e.shiftKey||e.button===1)return;e.preventDefault();var t=a.querySelector('.mttl');go(a.getAttribute('href'),t?t.textContent.trim():'');});window.addEventListener('pageshow',function(){b.className='boom';});}())</script>`;

// モバイルでは details.m-collapse の open を外して既定で折りたたむ（PC・no-JSは展開のまま＝SEO/アクセシビリティ維持）
const COLLAPSE_JS = `<script>(function(){try{var w=window.innerWidth||document.documentElement.clientWidth||0;if(w&&w<=700){document.querySelectorAll('details.m-collapse[open]').forEach(function(d){d.removeAttribute('open');});}}catch(e){}})();</script>`;
// 長い一覧をモバイルで折りたためるセクション。title はプレーンテキスト見出し
function collapsible(title, content){ return `<details class="m-collapse" open><summary>${title}<span class="mc-ico"></span></summary>${content}</details>`; }

const FOOTER = (extra='')=>`<footer class="post-foot">
  ${extra}
  <p>掲載は公式・権利元が公開している映像のみ。無断転載・切り抜きは扱いません。動画は各権利元の公式プレイヤーで再生されます。</p>
  <p><a href="../">▶ トップで他の試合を探す（W杯・Jリーグ・日本人所属クラブ）</a></p>
  <p>ガイド：<a href="../guide/world-cup-2026-how-to-watch.html">W杯26を日本から観る方法</a> ／ <a href="../guide/kubo-takefusa-highlights.html">久保建英 ハイライトまとめ</a></p>
  <p><a href="../about.html">このサイトについて</a> ／ <a href="../privacy.html">プライバシーポリシー</a> ／ <a href="../contact.html">お問い合わせ</a></p>
  <p class="cc">© 2026 Football Highlights Compass — 公式映像の発見サイト</p>
</footer></article>${COLLAPSE_JS}${BOOM}</body></html>`;

// 試合ページ用：メニューボタン付きトップバー
const TOPBAR_NAV = `<nav class="topbar"><div class="tinner">
  <button class="menu-btn" id="menuBtn" aria-label="ナビを開く">☰</button>
  <a class="brand" href="../"><img src="../favicon.svg" alt="" width="26" height="26"><span>Football Highlights Compass</span></a>
  <a class="tback" href="../">← トップ</a>
</div></nav>`;

// 試合ページ用：左の横断ナビ（トップと同内容を ../ プレフィックスで）
function subSideNav(){
  const ls = [...new Set(SCHEDULE.filter(s=>s.stage==='group' && s.group).map(s=>s.group))].sort();
  const groups = ls.map(L=>`<a href="../group/${L.toLowerCase()}.html" title="グループ${L}のハイライト・順位">${L}</a>`).join('');
  return `<div class="side-head"><b>⚽ 横断ナビ</b><button class="menu-close" id="menuClose" aria-label="閉じる">×</button></div>
  <nav class="nav-guides" aria-label="ガイド">
    <div class="ng-h">📘 ガイド</div>
    <a href="../guide/world-cup-2026-how-to-watch.html">W杯26を日本から観る方法</a>
    <a href="../guide/kubo-takefusa-highlights.html">久保建英 ハイライトまとめ</a>
    <a href="../guide/suzuki-zion-highlights.html">鈴木彩艶 ハイライトまとめ</a>
    <a href="../guide/minamino-takumi-highlights.html">南野拓実 ハイライトまとめ</a>
    <a href="../guide/doan-ritsu-highlights.html">堂安律 ハイライトまとめ</a>
  </nav>
  <nav class="nav-guides nav-wc" aria-label="ワールドカップ26">
    <div class="ng-h">⚽ ワールドカップ26</div>
    <a class="wc-ko" href="../group/knockout.html">🏆 決勝トーナメント（進出国・日程）</a>
    <div class="wc-groups">${groups}</div>
  </nav>
  ${leagueNavHtml('../')}`;
}

// 試合ページ用：モバイルメニュー開閉＋ネタバレ防止ON/OFFトグル（localStorage連動・ページに即反映）
const NAVJS = `<div class="nav-backdrop" id="navBackdrop"></div>
<script>(function(){var mb=document.getElementById('menuBtn'),mc=document.getElementById('menuClose'),bd=document.getElementById('navBackdrop');function o(){document.body.classList.add('nav-open');}function c(){document.body.classList.remove('nav-open');}mb&&mb.addEventListener('click',o);mc&&mc.addEventListener('click',c);bd&&bd.addEventListener('click',c);function sOn(){try{return localStorage.getItem('fhc_spoiler')!=='0';}catch(e){return true;}}var ST=document.getElementById('spoilerToggle');function paint(){if(!ST)return;var on=sOn();ST.className='spoiler-toggle'+(on?' on':'');ST.setAttribute('aria-pressed',on?'true':'false');ST.textContent=on?'🟢 ネタバレ防止：ON':'⚪ ネタバレ防止：OFF';}if(ST){paint();ST.addEventListener('click',function(){try{localStorage.setItem('fhc_spoiler',sOn()?'0':'1');}catch(e){}document.documentElement.classList.toggle('spoiler-off',!sOn());paint();});}})();</script>`;

function crumb(items){ return `<nav class="crumb">${items.map((it,i)=> it.href?`<a href="${it.href}">${esc(it.label)}</a>`:`<span>${esc(it.label)}</span>`).join('<i>›</i>')}</nav>`; }

// 試合カード（関連・一覧用）
function matchCard(m, sub){
  const t = titleWithFlags(m);
  const thumb = m.id?`https://i.ytimg.com/vi/${m.id}/hqdefault.jpg`:'';
  const sc = m.score?`<span class="mscore">${esc(m.score)}</span>`:'';
  return `<a class="mcard" href="../match/${m.id}.html">
    <span class="mthumb">${thumb?`<img src="${thumb}" alt="" loading="lazy">`:''}<span class="mplay">▶</span>${sc}</span>
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
.topbar .menu-btn{display:none;background:none;border:1px solid var(--line2);color:var(--accent);width:34px;height:34px;border-radius:8px;font-size:17px;line-height:1;cursor:pointer;align-items:center;justify-content:center;flex:0 0 auto}
/* ===== 試合ページ等の3カラムシェル（左ナビ／本文／右サイド） ===== */
.appgrid{max-width:1240px;margin:14px auto 0;padding:0 18px;display:grid;grid-template-columns:230px minmax(0,1fr) 300px;grid-template-areas:"left main right";gap:22px;align-items:start}
.col-left{grid-area:left}.col-main{grid-area:main;min-width:0}.col-right{grid-area:right}
.col-left,.col-right{position:sticky;top:64px;align-self:start;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:14px;box-shadow:0 2px 10px rgba(20,30,90,.05)}
.col-left{max-height:calc(100vh - 78px);overflow:auto;overscroll-behavior:contain}
.col-main .post{max-width:none;margin:0;padding:6px 0 60px}
.side-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px}
.side-head b{font-size:13px;letter-spacing:.03em;color:var(--ink)}
.side-head .menu-close{display:none;background:none;border:0;font-size:22px;line-height:1;color:var(--muted);cursor:pointer}
.col-right .side-h{font-size:11px;color:var(--muted);letter-spacing:.04em;margin:14px 2px 7px;font-weight:700}
.nav-guides{margin:0 0 14px;padding:0 0 12px;border-bottom:1px solid var(--line)}
.nav-guides:last-child{border-bottom:0;margin-bottom:0;padding-bottom:0}
.nav-guides .ng-h{font-size:11px;color:var(--muted);letter-spacing:.04em;margin:0 2px 7px}
.nav-guides a{display:block;font-size:12.5px;font-weight:700;color:var(--accent);text-decoration:none;padding:6px 9px;border-radius:8px;border:1px solid var(--line);border-left:3px solid var(--accent2);background:var(--card2);margin:5px 0;line-height:1.4}
.nav-guides a:hover{border-color:var(--accent2)}
.nav-wc .wc-ko{border-left-color:var(--red)}
.nav-wc .wc-groups{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;margin:7px 2px 2px}
.nav-wc .wc-groups a{display:block;text-align:center;font-size:12.5px;font-weight:800;padding:7px 0;margin:0;border:1px solid var(--line);border-left:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--accent)}
.nav-wc .wc-groups a:hover{border-color:var(--accent2);color:var(--accent2)}
.spoiler-toggle{width:100%;margin:0 0 12px;padding:13px 12px;border-radius:11px;border:1px solid var(--line2);background:var(--card2);color:var(--ink);font-size:14px;font-weight:800;cursor:pointer;text-align:center;letter-spacing:.02em;line-height:1.4}
.spoiler-toggle.on{background:rgba(16,185,129,.13);border-color:rgba(16,185,129,.42);color:#047857}
.spoiler-toggle:hover{border-color:var(--accent2)}
.nav-backdrop{display:none;position:fixed;inset:0;background:rgba(8,14,40,.5);z-index:55}
@media(max-width:1080px){
  .appgrid{grid-template-columns:1fr;grid-template-areas:"right" "main";gap:14px}
  .col-right{position:static;max-height:none;overflow:visible}
  .col-left{position:fixed;top:0;left:0;width:min(86%,330px);height:100%;max-height:none;z-index:60;border-radius:0;transform:translateX(-100%);transition:transform .22s;padding:16px 16px 40px}
  body.nav-open .col-left{transform:translateX(0)}
  body.nav-open .nav-backdrop{display:block}
  body.nav-open{overflow:hidden}
  .side-head .menu-close{display:flex}
  .topbar .menu-btn{display:flex}
}
/* article shell */
.post{max-width:860px;margin:0 auto;padding:18px 20px 70px}
/* 国・クラブの個別ページは横幅を活かす：上部を2カラム（左=本文+深掘り / 右=ファクト+関連）、試合一覧は全幅 */
.post.entity{max-width:1160px}
.ent-grid{display:grid;grid-template-columns:minmax(0,1fr) 326px;gap:32px;align-items:start;margin:2px 0 10px}
.ent-main{min-width:0}
.ent-side{position:sticky;top:14px}
.ent-side .factcard{margin:0 0 14px}
.ent-side h2{font-size:15px;font-weight:800;margin:16px 0 8px;border:none;padding:0;color:var(--ink)}
.ent-side .chips{margin:6px 0 0}
.side-guides{margin:14px 0 0}
.side-guides .guide-link{display:block;font-size:13px;font-weight:700;color:var(--accent);text-decoration:none;background:var(--paper);border:1px solid var(--line2);border-left:3px solid var(--accent2);border-radius:9px;padding:9px 12px;margin:6px 0;line-height:1.45}
.side-guides .guide-link:hover{background:var(--card2)}
@media(max-width:880px){.post.entity{max-width:860px}.ent-grid{grid-template-columns:1fr;gap:0}.ent-side{position:static;margin-top:8px}}
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
/* モバイルで過剰スクロールを抑える折りたたみ（PCは常時オープン、スマホは既定で閉じる：JSが open を外す） */
.m-collapse{margin:18px 0 6px}
.m-collapse>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:1.18em;font-weight:800;color:var(--ink);padding-top:14px;border-top:2px solid var(--ink)}
.m-collapse>summary::-webkit-details-marker{display:none}
.m-collapse>summary .mc-ico{margin-left:auto;font-size:12px;font-weight:800;color:var(--accent2);border:1px solid var(--line2);border-radius:8px;padding:4px 10px;white-space:nowrap;display:none}
@media(max-width:700px){
  .m-collapse>summary .mc-ico{display:inline-block}
  .m-collapse:not([open])>summary .mc-ico::before{content:'タップで開く ▾'}
  .m-collapse[open]>summary .mc-ico::before{content:'閉じる ▴'}
}
/* 紋章つきクラブチップ（リーグハブを華やかに） */
.clubchips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 6px}
.clubchip{display:inline-flex;align-items:center;gap:7px;font-size:13px;text-decoration:none;padding:6px 13px 6px 8px;border-radius:999px;border:1px solid var(--line2);background:var(--paper);color:var(--ink)}
.clubchip:hover{border-color:var(--accent);color:var(--accent)}
.clubchip img{width:20px;height:20px;object-fit:contain;border-radius:4px}
.mcard{display:flex;flex-direction:column;text-decoration:none;color:inherit;background:var(--paper);border:1px solid var(--line2);border-radius:13px;overflow:hidden;box-shadow:0 2px 9px rgba(20,30,90,.06);transition:transform .09s,box-shadow .15s}
.mcard:hover{transform:translateY(-2px);box-shadow:0 9px 22px rgba(20,30,90,.15)}
.mthumb{position:relative;aspect-ratio:16/9;background:#0b1430;display:block}
.mthumb img{width:100%;height:100%;object-fit:cover;display:block}
.mplay{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:38px;height:38px;border-radius:50%;background:rgba(225,29,72,.92);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 3px 12px rgba(0,0,0,.34)}
.mscore{position:absolute;right:6px;top:6px;display:none;font-size:13px;font-weight:900;color:#fff;background:rgba(11,22,87,.92);padding:3px 9px;border-radius:8px;letter-spacing:.04em;box-shadow:0 2px 8px rgba(0,0,0,.3)}
html.spoiler-off .mscore{display:inline-block}
/* ネタバレ防止中（既定）は結果に触れる要素を隠す。OFF（html.spoiler-off）または「タップで結果表示」で開示 */
html:not(.spoiler-off) .spoiler-cover{display:none!important}
.reveal-spoiler{display:none;align-items:center;gap:8px;font-size:14px;font-weight:800;padding:11px 16px;border-radius:10px;border:1px solid var(--line2);background:var(--card2);color:var(--accent);cursor:pointer;margin:2px 0 22px}
html:not(.spoiler-off) .reveal-spoiler{display:inline-flex}
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
.ehero .crest img{width:46px;height:auto;border-radius:5px;box-shadow:0 1px 6px rgba(0,0,0,.4)}
.score .reveal-score{font-size:14.5px;font-weight:800;padding:8px 16px;border-radius:10px;border:1px solid var(--line2);background:var(--card2);color:var(--accent);cursor:pointer}
/* 深掘りセクション */
.deep{margin:6px 0 4px}
.form-card{display:flex;align-items:center;gap:20px;background:var(--card2);border:1px solid var(--line2);border-radius:14px;padding:14px 20px;margin:12px 0 16px}
.formsvg{width:138px;height:auto;flex:0 0 auto}
.formsvg .ln{fill:none;stroke:var(--line2);stroke-width:1.5}
.formsvg .dot{fill:var(--accent2);stroke:#fff;stroke-width:2}
.form-meta .form-no{font-size:30px;font-weight:900;letter-spacing:.06em;color:var(--accent);line-height:1}
.form-meta .form-cap{font-size:12px;color:var(--soft);margin-top:4px}
.form-meta .form-era{font-size:13.5px;color:var(--muted);font-weight:700;margin-top:8px}
.deep-style{font-size:15.5px;line-height:1.95;margin:0 0 8px}
.deep-h{font-size:13.5px;font-weight:800;color:var(--muted);margin:18px 0 9px;letter-spacing:.03em}
.legend-chip{font-size:13px;padding:6px 14px;border-radius:999px;border:1px solid var(--line2);background:var(--paper);color:var(--ink);display:inline-block}
.jp-time{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.jp-time li{background:var(--paper);border:1px solid var(--line);border-left:3px solid var(--accent2);border-radius:10px;padding:10px 14px;font-size:14.5px}
.jp-time li b{color:var(--ink);font-weight:800}
.jp-time li span{color:var(--muted);font-size:13px;margin-left:10px}
@media(max-width:560px){.form-card{gap:14px;padding:12px 14px}.formsvg{width:112px}.form-meta .form-no{font-size:25px}}
/* クリック時の演出（Loading…→Go!）個別ページ用 */
.boom{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;pointer-events:none}
.boom.go{display:flex}
.boom-bg{position:absolute;inset:0;opacity:0;background:radial-gradient(125% 125% at 50% 38%, rgba(22,34,108,.88), rgba(7,11,34,.97));backdrop-filter:blur(7px) saturate(1.15);-webkit-backdrop-filter:blur(7px) saturate(1.15)}
.boom.go .boom-bg{animation:boomBgIn .2s ease-out forwards}
.boom.leaving .boom-bg{animation:boomBgOut .34s ease-in forwards}
.boom-center{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:18px;text-align:center}
.boom-load{display:none;font-size:clamp(20px,5.4vw,33px);font-weight:800;letter-spacing:.16em;color:#dbe2fb}
.boom.phase-load .boom-load{display:block;animation:boomBlink .2s ease-in-out 2}
.boom-stamp{display:none;width:clamp(132px,33vw,184px);height:clamp(132px,33vw,184px);border-radius:50%;border:6px solid #ff463b;color:#ff564c;align-items:center;justify-content:center;transform:rotate(-9deg);box-shadow:0 0 0 2px rgba(255,70,59,.22) inset,0 12px 44px rgba(0,0,0,.45);text-shadow:0 1px 0 rgba(0,0,0,.18)}
.boom-stamp b{font-size:clamp(42px,12vw,72px);font-weight:900;letter-spacing:.02em}
.boom.phase-go .boom-stamp{display:flex;animation:boomStamp .42s cubic-bezier(.2,1.4,.35,1) forwards}
.boom-sub{display:none;font-size:clamp(13px,3.2vw,18px);font-weight:700;color:#aeb9e6;letter-spacing:.05em}
.boom.go .boom-sub{display:block;animation:boomSubIn .5s ease-out forwards}
@keyframes boomBgIn{from{opacity:0}to{opacity:1}}
@keyframes boomBgOut{from{opacity:1}to{opacity:0}}
@keyframes boomBlink{0%,100%{opacity:.18}50%{opacity:1}}
@keyframes boomStamp{0%{transform:scale(2.5) rotate(-17deg);opacity:0;filter:blur(3px)}55%{transform:scale(.9) rotate(-9deg);opacity:1;filter:blur(0)}72%{transform:scale(1.05) rotate(-9deg)}100%{transform:scale(1) rotate(-9deg);opacity:1}}
@keyframes boomSubIn{0%{opacity:0;transform:translateY(6px)}60%{opacity:1}100%{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.boom.go *{animation:none!important}}
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
.ad ins{display:block}
/* DAZN訴求CTA */
.dazn-cta{position:relative;display:flex;align-items:center;gap:16px;flex-wrap:wrap;background:linear-gradient(120deg,#0b1430,#16225f);color:#fff;border-radius:14px;padding:16px 20px;margin:20px 0;box-shadow:0 6px 20px rgba(12,22,87,.22)}
.dazn-cta .dc-txt{flex:1 1 200px;min-width:0}
.dazn-cta .dc-txt b{display:block;font-size:15.5px;font-weight:800;margin-bottom:3px}
.dazn-cta .dc-txt span{font-size:13px;color:#c4cef2;line-height:1.6}
.dazn-cta .dc-btn{flex:0 0 auto;background:#f8f400;color:#0b1430;font-weight:900;font-size:14.5px;text-decoration:none;padding:12px 22px;border-radius:10px;white-space:nowrap;box-shadow:0 3px 12px rgba(0,0,0,.25)}
.dazn-cta .dc-btn:hover{filter:brightness(1.05)}
.dazn-cta .dc-pr{position:absolute;top:7px;right:10px;font-size:9.5px;font-weight:800;letter-spacing:.06em;color:#9fb0e8;border:1px solid rgba(159,176,232,.5);border-radius:4px;padding:1px 5px}
.ent-side .dazn-cta{margin:14px 0 0;padding:14px 16px}
.ent-side .dazn-cta .dc-btn{padding:10px 16px;font-size:13.5px}
/* グループページ：順位表＆日程 */
.standings{width:100%;border-collapse:collapse;font-size:13.5px}
.standings th{color:var(--muted);font-weight:700;text-align:center;padding:7px 4px;border-bottom:2px solid var(--line2);font-size:12px}
.standings td{text-align:center;padding:8px 4px;border-bottom:1px solid var(--line)}
.standings td.st-team{text-align:left;white-space:nowrap}
.standings td.st-team a{color:var(--ink);text-decoration:none;font-weight:700}
.standings .flag{height:13px;vertical-align:-2px;margin-right:5px;border-radius:2px}
.note-sm{font-size:12px;color:var(--muted);margin:8px 2px 0;line-height:1.7}
.standings td.tbd{color:var(--soft);font-style:italic;text-align:center}
.ko-qual td.st-team a{font-weight:700}
.gx-list{display:flex;flex-direction:column;gap:8px;margin:12px 0}
.gx-row{display:grid;grid-template-columns:54px 1fr auto auto;align-items:center;gap:12px;background:var(--paper);border:1px solid var(--line2);border-radius:11px;padding:11px 14px}
.gx-row .gx-rd{font-size:11.5px;color:var(--muted);font-weight:700}
.gx-row .gx-tm{font-size:14.5px;font-weight:700;color:var(--ink);min-width:0}
.gx-row .gx-tm em{font-style:normal;color:var(--soft);font-size:.85em;margin:0 4px}
.gx-row .gx-tm .flag{height:14px;vertical-align:-2px;margin:0 3px;border-radius:2px}
.gx-row .gx-meta{font-size:12px;color:var(--muted);white-space:nowrap}
.gx-row .gx-link{font-size:13px;font-weight:800;color:#fff;background:var(--accent2);padding:7px 13px;border-radius:8px;text-decoration:none;white-space:nowrap}
.gx-row .gx-soon{font-size:12px;color:var(--soft);white-space:nowrap}
.gx-row .gx-score{font-weight:800;color:var(--ink);margin:0 4px;font-variant-numeric:tabular-nums}
html.spoiler-off .gx-row .gx-vs{display:none}
@media(max-width:620px){.gx-row{grid-template-columns:1fr auto;gap:4px 10px}.gx-row .gx-rd{grid-column:1/-1}.gx-row .gx-meta{grid-column:1;font-size:11.5px}}`;

// 広告枠（slot は AdSense 管理画面で作成した広告ユニットIDに置換する）
const AD = `<div class="ad"><span class="adlabel">広告</span><ins class="adsbygoogle" style="display:block" data-ad-client="${AD_CLIENT}" data-ad-slot="${AD_SLOT}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(function(){var i=document.currentScript.previousElementSibling;if(i&&i.getAttribute('data-ad-slot')==='__AD_SLOT__'){var b=i.closest('.ad');if(b)b.style.display='none';}else{(adsbygoogle=window.adsbygoogle||[]).push({});}})();</script></div>`;

mkdirSync('site/match', { recursive:true });
mkdirSync('site/country', { recursive:true });
mkdirSync('site/club', { recursive:true });
writeFileSync('site/article.css', CSS);

// ========================= 試合ページ =========================
const slugs=[]; const noindexSlugs=new Set();
function buildMatch(m){
  if(!m.id || slugs.includes(m.id)) return; slugs.push(m.id);
  const lg = LG[m.league]||''; const teamsTxt = m.teams.join(' vs ');
  const sched = schedFor(m);
  // 内容の薄いページ（W杯以外で日本人選手・見どころ・出場選手いずれも無い＝定型のみ）はnoindex（scaled content対策）
  const thin = m.league!=='wc' && !m.players.length && !m.topic && !m.lineup;
  if(thin) noindexSlugs.add(m.id);
  // dek（統一フォーマットのリード文）：[任意の見どころ。][対戦（大会）の公式ハイライトです。]
  let hook = '';
  if (m.players.length){
    const act = (m.jpNote||'').match(/[（(]([^）)]+)[）)]/);
    const a = act ? act[1].replace(/先発|フル出場|途中出場|出場|復帰/g,'').trim() : '';
    hook = `${m.players.join('・')}が${a||'出場'}`;
  } // 結果に触れる m.topic は dek（リード文）に出さない＝ネタバレ防止。見どころは下のfactカードに控えめ版で格納
  const dek = `${hook?hook+'。':''}${teamsTxt||m.mt}${lg?`（${lg}）`:''}の公式ハイライトです。`;
  // description（meta/og/twitter/JSON-LDに波及）には結果に触れる m.topic を入れない＝検索スニペットでのネタバレ防止
  const desc = `${teamsTxt||m.mt}${lg?'（'+lg+'）':''}の公式ハイライト。${m.players.length?m.players.join('・')+'出場。':''}公式映像のみ・ネタバレ防止。`.slice(0,120);
  // fact card
  const facts=[];
  if(lg) facts.push(['大会', lg]);
  facts.push(['対戦', teamsTxt||m.mt]);
  if(m.meta) facts.push(['節・日程', m.meta]);
  if(sched?.venue) facts.push(['会場', `${sched.venue}（${sched.city||''}${sched.country?'・'+sched.country:''}）`]);
  if(sched?.koJST) facts.push(['キックオフ', sched.koJST.replace('T',' ').replace(/:00\+09:00$/,'（日本時間）')]);
  if(m.players.length) facts.push(['日本人選手', m.jpNote||m.players.join('・')]);
  if(m.topic) facts.push(['見どころ', m.topic]);
  const factHtml = `<div class="factcard"><table>${facts.map(f=>`<tr${f[0]==='見どころ'?' class="spoiler-cover"':''}><th>${esc(f[0])}</th><td>${esc(String(f[1]))}</td></tr>`).join('')}</table></div>`;
  // チーム/国のハブページへの内部リンク
  const teamLinks = m.teams.map(t=> PAGE_OF[t] ? `<a href="../${PAGE_OF[t]}">${m.league==='wc'?flagImg(t):''}${esc(t)}</a>` : '').filter(Boolean);
  const teamHtml = teamLinks.length ? `<h2>チーム・${m.league==='wc'?'国':'クラブ'}を深掘り</h2><div class="chips">${teamLinks.join('')}</div>` : '';
  // related
  const rel = relatedMatches(m);
  const relHtml = rel.length ? collapsible('関連する試合', `<div class="mcards">${rel.map(r=>matchCard(r.m, r.why)).join('')}</div>`) : '';
  const ogimg = m.id?`https://i.ytimg.com/vi/${m.id}/hqdefault.jpg`:`${DOMAIN}/og.png`;
  const url = `${DOMAIN}/match/${m.id}.html`;
  const catLabel = lg||'試合';
  // 日付（スケジュール優先・無ければビルド日）
  const upDate = sched?.koUTC || (sched?.dateLocal ? sched.dateLocal+'T12:00:00+09:00' : `${TODAY}T12:00:00+09:00`);
  // @graph: VideoObject ＋（W杯のみ）SportsEvent/BroadcastEvent ＋ BreadcrumbList
  const graph = [
    {"@type":"VideoObject","name":m.ttl+"｜公式ハイライト","description":desc,"thumbnailUrl":ogimg,"uploadDate":upDate,"embedUrl":m.id?`https://www.youtube.com/embed/${m.id}`:url,"contentUrl":url,"publisher":ORG},
    crumbLd([{name:'トップ',url:DOMAIN+'/'},{name:catLabel,url:`${DOMAIN}/?league=${m.league}`},{name:m.mt,url}])
  ];
  if (sched){
    const evName = `${sched.home?.ja||m.teams[0]||''} vs ${sched.away?.ja||m.teams[1]||''}`.trim();
    const ev = {"@type":"SportsEvent","name":evName,"sport":"Soccer","startDate":sched.koUTC||sched.dateLocal,"eventStatus":"https://schema.org/EventScheduled","superEvent":{"@type":"SportsEvent","name":"FIFA World Cup 2026"}};
    if(sched.venue) ev.location={"@type":"Place","name":sched.venue,"address":{"@type":"PostalAddress","addressLocality":sched.city||'',"addressCountry":sched.country||''}};
    if(sched.home?.ja) ev.homeTeam={"@type":"SportsTeam","name":sched.home.ja};
    if(sched.away?.ja) ev.awayTeam={"@type":"SportsTeam","name":sched.away.ja};
    graph.push(ev, {"@type":"BroadcastEvent","name":evName+"｜ハイライト配信","isLiveBroadcast":false,"broadcastOfEvent":{"@type":"SportsEvent","name":evName},"publishedOn":{"@type":"BroadcastService","name":sched.broadcaster||"DAZN Japan"}});
  }
  // ネタバレ防止中（html:not(.spoiler-off)）は結果に触れる要素を隠す。本文の .score / 得点 / トピック に spoiler-cover を付与
  const bodyHtml = m.body.replace(/^<div class="body"[^>]*>/,'').replace(/<\/div>\s*$/,'')
    .replace(/<div class="score">/g,'<div class="score spoiler-cover">')
    .replace(/<li>(<b>得点：<\/b>)/g,'<li class="spoiler-cover">$1')
    .replace(/<li>(<b>トピック：<\/b>)/g,'<li class="spoiler-cover">$1');
  const hasSpoiler = /spoiler-cover/.test(bodyHtml) || !!m.topic;
  const spoilerBar = hasSpoiler ? `<button class="reveal-spoiler" type="button" onclick="document.documentElement.classList.add('spoiler-off')">🟢 ネタバレ防止中：タップで結果（スコア・得点者・見どころ）を表示</button>` : '';
  const head = HEAD({
    title:`${m.ttl}｜公式ハイライト${lg?'・'+lg:''} - Football Highlights Compass`,
    ogtitle:`${m.ttl}｜公式ハイライト`, desc, url, ogimg, ogtype:'video.other',
    robots: thin?'noindex,follow':undefined,
    published:upDate, modified:`${TODAY}T12:00:00+09:00`, jsonld:graph
  });
  const rightBar = `<button id="spoilerToggle" class="spoiler-toggle" type="button" aria-pressed="true">🟢 ネタバレ防止：ON</button>
    <div class="side-h">この試合</div>
    <nav class="nav-guides">
      <a href="../?league=${m.league}">▶ ${esc(lg||'試合')}の一覧</a>
      <a href="../group/knockout.html">🏆 W杯 決勝トーナメント</a>
      <a href="../">▶ トップで他の試合を探す</a>
    </nav>`;
  const footerInner = `<footer class="post-foot">
    ${m.lineup?'<p>出場選手データ：Jリーグ公式。</p>':''}
    <p>掲載は公式・権利元が公開している映像のみ。無断転載・切り抜きは扱いません。動画は各権利元の公式プレイヤーで再生されます。</p>
    <p><a href="../">▶ トップで他の試合を探す（W杯・Jリーグ・日本人所属クラブ）</a></p>
    <p><a href="../about.html">このサイトについて</a> ／ <a href="../privacy.html">プライバシーポリシー</a> ／ <a href="../contact.html">お問い合わせ</a></p>
    <p class="cc">© 2026 Football Highlights Compass — 公式映像の発見サイト</p>
  </footer>`;
  const out = head + TOPBAR_NAV + `<div class="appgrid">
  <aside class="col-left" id="navSidebar">${subSideNav()}</aside>
  <main class="col-main"><article class="post">
  ${crumb([{label:'トップ',href:'../'},{label:catLabel,href:`../?league=${m.league}`},{label:m.mt}])}
  <p class="kicker">${m.league==='wc'&&m.teams.length===2?flagImg(m.teams[0])+flagImg(m.teams[1]):'⚽'} ${esc(lg||'公式ハイライト')}</p>
  <h1 class="headline">${titleWithFlags(m)}</h1>
  <p class="dek">${esc(dek)}</p>
  <div class="byline"><span class="b lg">${esc(lg||'')}</span>${m.meta?`<span class="b">📅 ${esc(m.meta)}</span>`:''}${m.players.length?`<span class="b">🇯🇵 ${esc(m.players.join('・'))}</span>`:''}</div>
  ${spoilerBar}
  <div class="post-body">${bodyHtml}</div>
  ${daznCta('この試合のフル・見逃し配信もDAZNで。ハイライトの先まで楽しめます。')}
  ${AD}
  ${factHtml}
  ${teamHtml}
  ${relHtml}
  ${footerInner}
  </article></main>
  <aside class="col-right">${rightBar}</aside>
</div>` + NAVJS + COLLAPSE_JS + BOOM + `</body></html>`;
  writeFileSync(`site/match/${m.id}.html`, out);
}
data.forEach(buildMatch);

// ========================= 国・クラブ個別ページ =========================
const ENTITY_PAGES = PAGE_OF; // name -> "country/slug.html"|"club/slug.html"

// フォーメーションをピッチ図(SVG)に描画（GK＋各ライン）。色はCSS変数で。
function formationSVG(form){
  const lines=(form||'').split('-').map(n=>parseInt(n,10)).filter(n=>n>0);
  if(!lines.length) return '';
  const W=200,H=268,top=46,bot=212,n=lines.length, dots=[[W/2,H-16]];
  lines.forEach((cnt,li)=>{ const y= n>1 ? bot-li*((bot-top)/(n-1)) : (top+bot)/2; for(let i=0;i<cnt;i++) dots.push([(i+1)/(cnt+1)*W,y]); });
  const pitch=`<rect class="ln" x="5" y="5" width="${W-10}" height="${H-10}" rx="10"/><line class="ln" x1="5" y1="${H/2}" x2="${W-5}" y2="${H/2}"/><circle class="ln" cx="${W/2}" cy="${H/2}" r="20"/><rect class="ln" x="${W/2-30}" y="5" width="60" height="30"/><rect class="ln" x="${W/2-30}" y="${H-35}" width="60" height="30"/>`;
  const cs=dots.map(([x,y])=>`<circle class="dot" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="8" fill="#2746c9" stroke="#fff" stroke-width="2"/>`).join('');
  // fill/stroke はインライン属性でも持たせる：article.css 未読込（キャッシュ/file:///デプロイ漏れ）でも黒塗りにならない保険。CSSが読まれていれば .ln/.dot がテーマ色で上書きする。
  return `<svg class="formsvg" width="138" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="代表的なフォーメーション ${form}" fill="none" stroke="#d3dcf0" stroke-width="1.5">${pitch}${cs}</svg>`;
}
// 「深掘り」セクション（DEEPがある場合のみ）
function deepSection(name, isClub){
  const d = DEEP[name]; if(!d) return '';
  let h = '<h2 class="lined">深掘り</h2><div class="deep">';
  if(d.formation) h += `<div class="form-card">${formationSVG(d.formation)}<div class="form-meta"><div class="form-no">${esc(d.formation)}</div><div class="form-cap">代表的なフォーメーション</div>${d.era?`<div class="form-era">${esc(d.era)}</div>`:''}</div></div>`;
  if(d.style) h += `<p class="deep-style">${esc(d.style)}</p>`;
  if(d.legends&&d.legends.length) h += `<h3 class="deep-h">${isClub?'クラブのレジェンド':'歴代のレジェンド'}</h3><div class="chips">${d.legends.map(x=>`<span class="legend-chip">${esc(x)}</span>`).join('')}</div>`;
  if(d.jp&&d.jp.length) h += `<h3 class="deep-h">ゆかりの日本人選手</h3><ul class="jp-time">${d.jp.map(j=>`<li><b>${esc(j.name)}</b>${j.note?`<span>${esc(j.note)}</span>`:''}</li>`).join('')}</ul>`;
  return h+'</div>';
}

function buildCountry(name, info){
  const ms = entityMatches(name); if(!ms.length && !info) return;
  const slug = info.slug; const path=`country/${slug}.html`;
  const flag = flagImg(name);
  const url=`${DOMAIN}/${path}`;
  const ogimg = ms[0]?`https://i.ytimg.com/vi/${ms[0].id}/hqdefault.jpg`:`${DOMAIN}/og.png`;
  const dek = info.blurb[0]||'';
  const desc = `${name}代表のW杯26 公式ハイライトと歴史。${info.confed}／最高成績：${info.peak}。公式映像のみ・ネタバレ防止で${ms.length}試合を掲載。`.slice(0,120);
  const cgraph = [
    {"@type":"SportsTeam","name":name+"代表","sport":"Soccer","memberOf":{"@type":"SportsOrganization","name":info.confed}},
    crumbLd([{name:'トップ',url:DOMAIN+'/'},{name:'国（ワールドカップ）',url:`${DOMAIN}/?league=wc`},{name:name+'代表',url}])
  ];
  if(ms.length) cgraph.push(itemListLd(ms));
  const head = HEAD({ title:`${name}代表｜W杯公式ハイライトと歴史 - Football Highlights Compass`, ogtitle:`${name}代表｜W杯公式ハイライトと歴史`, desc, url, ogimg, modified:`${TODAY}T12:00:00+09:00`, jsonld:cgraph });
  const blurbHtml = info.blurb.map(p=>`<p>${esc(p)}</p>`).join('');
  const factHtml = `<div class="factcard"><table>
    <tr><th>所属連盟</th><td>${esc(info.confed)}</td></tr>
    <tr><th>W杯最高成績</th><td>${esc(info.peak)}</td></tr>
    ${info.talent?`<tr><th>主なタレント</th><td>${esc(info.talent)}</td></tr>`:''}
  </table></div>`;
  const list = ms.length?collapsible(`${esc(name)}の公式ハイライト（${ms.length}試合）`, `<div class="mcards">${ms.slice(0,30).map(m=>matchCard(m, m.meta)).join('')}</div>`):'';
  // 関連：同連盟の他国
  const sameConfed = Object.entries(COUNTRIES).filter(([n,i])=>n!==name && i.confed===info.confed && entityMatches(n).length>0).slice(0,12);
  const related = sameConfed.length?`<h2>同じ連盟の国</h2><div class="chips">${sameConfed.map(([n,i])=>`<a href="../country/${i.slug}.html">${flagImg(n)}${esc(n)}</a>`).join('')}</div>`:'';
  const out = head + TOPBAR + `<article class="post entity">
  ${crumb([{label:'トップ',href:'../'},{label:'国（ワールドカップ）'},{label:name}])}
  <p class="kicker">${flag} ${esc(info.confed)}</p>
  <div class="ehero"><div class="ei"><span class="crest">${flag||'🌍'}</span><div><h1>${esc(name)}代表</h1><div class="esub">FIFAワールドカップ26 ／ 最高成績：${esc(info.peak)}</div></div></div></div>
  <p class="dek">${esc(dek)}</p>
  <div class="ent-grid">
    <div class="ent-main">
      <div class="post-body">${info.blurb.slice(1).map(p=>`<p>${esc(p)}</p>`).join('')}${SECTIONS[name]?`<p>${esc(SECTIONS[name])}</p>`:''}</div>
      ${deepSection(name,false)}
    </div>
    <aside class="ent-side">${factHtml}${guideLinksFor(name)}${daznCta()}${related}</aside>
  </div>
  ${AD}
  ${list}
  ` + FOOTER();
  writeFileSync(`site/${path}`, out);
}

function buildClub(name, info){
  const ms = entityMatches(name); const slug=info.slug; const path=`club/${slug}.html`;
  const flag = flagImg2(info.iso);
  const crestUrl = CREST[info.slug];
  const crestHtml = crestUrl ? `<img class="crestimg" src="${crestUrl}" alt="${escA(name)}のエンブレム" loading="lazy">` : (flag||'🛡️');
  const url=`${DOMAIN}/${path}`;
  const ogimg = crestUrl || (ms[0]?`https://i.ytimg.com/vi/${ms[0].id}/hqdefault.jpg`:`${DOMAIN}/og.png`);
  const dek = info.blurb[0]||'';
  const desc = `${name}（${info.league}）の公式ハイライトとクラブの歴史。${info.founded}年創設・本拠地${info.stadium}。公式映像のみ・ネタバレ防止で${ms.length}試合を掲載。`.slice(0,120);
  const clgraph = [
    {"@type":"SportsTeam","name":name,"sport":"Soccer","foundingDate":String(info.founded),"location":info.country},
    crumbLd([{name:'トップ',url:DOMAIN+'/'},{name:'クラブ',url:DOMAIN+'/'},{name:name,url}])
  ];
  if(ms.length) clgraph.push(itemListLd(ms));
  const head = HEAD({ title:`${name}｜公式ハイライトとクラブの歴史 - Football Highlights Compass`, ogtitle:`${name}｜公式ハイライトとクラブの歴史`, desc, url, ogimg, modified:`${TODAY}T12:00:00+09:00`, jsonld:clgraph });
  const factHtml = `<div class="factcard"><table>
    <tr><th>国・リーグ</th><td>${flag} ${esc(info.country)}／${esc(info.league)}</td></tr>
    <tr><th>創設</th><td>${esc(String(info.founded))}年</td></tr>
    <tr><th>本拠地</th><td>${esc(info.stadium)}</td></tr>
    ${info.honors?`<tr><th>主なタイトル</th><td>${esc(info.honors)}</td></tr>`:''}
  </table></div>`;
  const list = ms.length?collapsible(`${esc(name)}の公式ハイライト（${ms.length}試合）`, `<div class="mcards">${ms.slice(0,30).map(m=>matchCard(m, m.meta)).join('')}</div>`):'';
  const sameLeague = Object.entries(CLUBS).filter(([n,i])=>n!==name && i.league===info.league).slice(0,12);
  const leagueHub = LEAGUE_LIST.find(h=>h.clubLabel===info.league);
  const leagueLink = leagueHub?`<p style="margin:2px 0 10px"><a href="../league/${leagueHub.slug}.html"><b>🇪🇺 ${esc(leagueHub.name)} の試合一覧へ →</b></a></p>`:'';
  const related = (leagueLink?leagueLink:'') + (sameLeague.length?`<h2>同じリーグのクラブ</h2><div class="chips">${sameLeague.map(([n,i])=>`<a href="../club/${i.slug}.html">${esc(n)}</a>`).join('')}</div>`:'');
  const out = head + TOPBAR + `<article class="post entity">
  ${crumb([{label:'トップ',href:'../'},{label:'クラブ'},{label:name}])}
  <p class="kicker">${flag} ${esc(info.league)}</p>
  <div class="ehero"><div class="ei"><span class="crest">${crestHtml}</span><div><h1>${esc(name)}</h1><div class="esub">${esc(info.country)} ／ ${esc(info.league)} ／ ${esc(String(info.founded))}年創設</div></div></div></div>
  <p class="dek">${esc(dek)}</p>
  <div class="ent-grid">
    <div class="ent-main">
      <div class="post-body">${info.blurb.slice(1).map(p=>`<p>${esc(p)}</p>`).join('')}${SECTIONS[name]?`<p>${esc(SECTIONS[name])}</p>`:''}</div>
      ${deepSection(name,true)}
    </div>
    <aside class="ent-side">${factHtml}${guideLinksFor(name)}${daznCta()}${related}</aside>
  </div>
  ${AD}
  ${list}
  ` + FOOTER();
  writeFileSync(`site/${path}`, out);
}
function flagImg2(iso){ return iso?`<img class="flag" src="https://flagcdn.com/w40/${iso}.png" srcset="https://flagcdn.com/w80/${iso}.png 2x" alt="" loading="lazy">`:''; }

// ========================= 集客記事（ガイド）の定義（エンティティ生成より前に。関連ガイドの文脈リンク用） =========================
function cardGrid(ms){ return ms.length?`<div class="mcards">${ms.slice(0,30).map(m=>matchCard(m, m.meta)).join('')}</div>`:''; }
function playerGuide(slug, player, clubKey, clubLabel, leagueLabel, role){
  return { slug, entities:[clubKey],
    title:`${player} ハイライトまとめ｜${clubLabel}の最新ゴール・アシスト（2025-26）`,
    h1:`${player} 公式ハイライトまとめ（${clubLabel}／2025-26）`,
    dek:`${player}（${clubLabel}）の${leagueLabel}公式ハイライトを試合ごとにまとめました。`,
    desc:`${player}（${clubLabel}）の${leagueLabel}公式ハイライトまとめ。ゴール・アシストの試合を一覧で。公式映像のみ・ネタバレ防止。`,
    body(){
      const ms=(byPlayer[player]||[]).filter(m=>m.id); const club=PAGE_OF[clubKey];
      return `<div class="post-body"><p>${clubLabel}で${role}${player}の出場試合について、公式ハイライト（主に DAZN Japan）を試合ごとにまとめています。各試合はネタバレ防止に対応し、スコアは任意で表示できます。</p></div>
      ${collapsible(`${player} 出場試合のハイライト（${ms.length}試合）`, cardGrid(ms))}
      ${daznCta(`${clubLabel}＝${leagueLabel}のフル・見逃し配信はDAZNで。`)}
      ${club?`<p style="margin-top:14px"><a href="../${club}">▶ ${clubLabel}のクラブページ（歴史・所属日本人選手）</a></p>`:''}`;
    } };
}
const GUIDES = [
  { slug:'world-cup-2026-how-to-watch', entities:['日本'],
    title:'2026 FIFAワールドカップを日本から観る方法｜公式ハイライト全試合まとめ',
    h1:'2026 FIFAワールドカップを日本から観る方法と公式ハイライトまとめ',
    dek:'2026年北中米ワールドカップ（カナダ・メキシコ・アメリカ共催）を日本から視聴する方法と、公式ハイライトの探し方を整理しました。',
    desc:'2026 W杯を日本から観る方法（DAZN）と公式ハイライトの探し方。日本代表・注目試合の公式ハイライトへ最短で。公式映像のみ・ネタバレ防止。',
    body(){
      const wc = data.filter(m=>m.league==='wc'&&m.id); const jp = (byTeam['日本']||[]).filter(m=>m.id);
      return `<div class="post-body">
        <p>2026 FIFAワールドカップは6月から7月にかけて、カナダ・メキシコ・アメリカの3か国共催で開催されます。日本国内では <b>DAZN</b> が全試合をライブ配信し、試合後には公式ハイライト（MATCH RECAP）も公開されます。</p>
        <p>FIFA公式YouTubeでもハイライトが公開されますが、外部サイトへの埋め込みは許可されていないため、当サイトでは公式ページへのリンクで案内しています。一方 DAZN Japan のハイライトは日本から視聴でき、当サイトではその場で再生できます。1試合につき複数の公式ソースを並べているので、見やすい方を選べます。</p>
        <p>結果を知りたくない場合は、トップの「ネタバレ防止」をONにすると一覧・試合ページのスコアが隠れます。タイトルに結果が出ない MATCH RECAP も活用しています。</p>
      </div>
      ${jp.length?`<h2 class="lined">日本代表の試合</h2>${cardGrid(jp)}`:''}
      ${daznCta('W杯26の全試合フル・見逃し配信はDAZNで。')}
      ${(()=>{const ls=[...new Set(SCHEDULE.filter(s=>s.stage==='group'&&s.group).map(s=>s.group))].sort(); return ls.length?`<h2 class="lined">グループ別ページ・決勝トーナメント（順位・日程・ハイライト）</h2><div class="chips">${ls.map(L=>`<a href="../group/${L.toLowerCase()}.html">グループ${L}</a>`).join('')}<a href="../group/knockout.html">🏆 決勝トーナメント</a></div>`:'';})()}
      <h2 class="lined">ワールドカップ26の注目試合</h2>${cardGrid(wc)}
      <p style="margin-top:14px"><a href="../?league=wc">▶ ワールドカップ26の全試合を一覧で見る</a></p>`;
    } },
  playerGuide('kubo-takefusa-highlights','久保建英','ソシエダ','レアル・ソシエダ','ラ・リーガ','攻撃の中心を担う'),
  playerGuide('suzuki-zion-highlights','鈴木彩艶','パルマ','パルマ','セリエA','守護神を務める'),
  playerGuide('minamino-takumi-highlights','南野拓実','モナコ','ASモナコ','リーグアン','攻撃陣の一角を担う'),
  playerGuide('doan-ritsu-highlights','堂安律','フランクフルト','フランクフルト','ブンデスリーガ','攻撃を牽引する'),
];
const guidesByEntity = {};
for(const g of GUIDES) (g.entities||[]).forEach(e=>{ (guidesByEntity[e]=guidesByEntity[e]||[]).push({slug:g.slug, h1:g.h1}); });
function guideLinksFor(name){ const gs=guidesByEntity[name]||[]; return gs.length?`<div class="side-guides"><div class="side-h">関連ガイド</div>${gs.map(x=>`<a class="guide-link" href="../guide/${x.slug}.html">📘 ${esc(x.h1)}</a>`).join('')}</div>`:''; }

let nc=0, ncl=0;
for(const [name,info] of Object.entries(COUNTRIES)){ if(entityMatches(name).length){ buildCountry(name,info); nc++; } }
for(const [name,info] of Object.entries(CLUBS)){ buildClub(name,info); ncl++; }

// ========================= 欧州リーグ ハブページ =========================
mkdirSync('site/league', { recursive:true });
const leagueUrls = [];
function buildLeague(h){
  const { clubsIn, ms } = leagueMatches(h.clubLabel);
  if(!ms.length) return;
  const path=`league/${h.slug}.html`, url=`${DOMAIN}/${path}`;
  const clubChips = clubsIn.filter(c=>CLUBS[c]).map(c=>{ const cr=CREST[CLUBS[c].slug]; return `<a class="clubchip" href="../club/${CLUBS[c].slug}.html">${cr?`<img src="${cr}" alt="" loading="lazy">`:'🛡️'}${esc(c)}</a>`; }).join('');
  const others = LEAGUE_LIST.filter(x=>x.slug!==h.slug);
  const cross = others.length?`<h2 class="lined">他の欧州リーグ</h2><div class="chips">${others.map(x=>`<a href="../league/${x.slug}.html">${esc(x.name)}</a>`).join('')}</div>`:'';
  const ogimg = ms[0]?`https://i.ytimg.com/vi/${ms[0].id}/hqdefault.jpg`:`${DOMAIN}/og.png`;
  const desc = `${h.name}（${h.country}）の公式ハイライト。公式・権利元が公開する映像のみ・ネタバレ防止で${ms.length}試合を掲載。`.slice(0,120);
  const graph=[{"@type":"CollectionPage","name":h.name,"url":url,"inLanguage":"ja","isPartOf":{"@type":"WebSite","name":"Football Highlights Compass","url":DOMAIN+'/'}}, crumbLd([{name:'トップ',url:DOMAIN+'/'},{name:'欧州リーグ',url:DOMAIN+'/'},{name:h.name,url}])];
  graph.push(itemListLd(ms));
  const head=HEAD({ title:`${h.name}｜公式ハイライト・試合一覧 - Football Highlights Compass`, ogtitle:`${h.name}｜公式ハイライト`, desc, url, ogimg, modified:`${TODAY}T12:00:00+09:00`, jsonld:graph });
  const out = head + TOPBAR + `<article class="post entity">
  ${crumb([{label:'トップ',href:'../'},{label:'欧州リーグ'},{label:h.name}])}
  <p class="kicker">⚽ 欧州サッカー</p>
  <h1 class="headline">${esc(h.name)}｜公式ハイライト</h1>
  <p class="dek">${esc(h.blurb)}${esc(h.country)}のトップリーグの試合を、公式・権利元が公開するハイライトで掲載しています（公式映像のみ・ネタバレ防止）。</p>
  ${clubChips?`<h2 class="lined">掲載クラブ</h2><div class="clubchips">${clubChips}</div>`:''}
  ${daznCta(h.name+'のフル・見逃し配信もDAZNで。')}
  ${AD}
  ${collapsible(`${esc(h.name)}の公式ハイライト（${ms.length}試合）`, cardGrid(ms))}
  ${cross}
  ` + FOOTER();
  writeFileSync(`site/${path}`, out);
  leagueUrls.push(url);
}
for(const h of LEAGUE_LIST) buildLeague(h);

// ========================= 集客記事（ガイド）の生成 =========================
mkdirSync('site/guide', { recursive:true });
const guideUrls = [];
for(const g of GUIDES){
  const url = `${DOMAIN}/guide/${g.slug}.html`;
  const cg = [ {"@type":"Article","headline":g.h1,"description":g.desc,"inLanguage":"ja","author":ORG,"publisher":ORG,"datePublished":`${TODAY}`,"dateModified":`${TODAY}`,"mainEntityOfPage":url},
    crumbLd([{name:'トップ',url:DOMAIN+'/'},{name:'ガイド',url:DOMAIN+'/'},{name:g.h1,url}]) ];
  const head = HEAD({ title:`${g.title} - Football Highlights Compass`, ogtitle:g.title, desc:g.desc, url, ogimg:`${DOMAIN}/og.png`, ogtype:'article', modified:`${TODAY}T12:00:00+09:00`, jsonld:cg });
  const out = head + TOPBAR + `<article class="post">
  ${crumb([{label:'トップ',href:'../'},{label:'ガイド'},{label:g.h1}])}
  <p class="kicker">📘 ガイド</p>
  <h1 class="headline">${esc(g.h1)}</h1>
  <p class="dek">${esc(g.dek)}</p>
  ${g.body()}
  ${AD}
  ` + FOOTER();
  writeFileSync(`site/guide/${g.slug}.html`, out);
  guideUrls.push(url);
}

// ========================= W杯 グループ個別ページ（展望・暫定順位・日程・ハイライト・国リンク） =========================
mkdirSync('site/group', { recursive:true });
const groupUrls = [];
let WCHUB_HTML = '';   // トップ左ナビ「W杯26ハブ」（決勝T＋全組リンク）。index.html の WCHUB マーカーへ注入
{
  const gAll = SCHEDULE.filter(s=>s.stage==='group' && s.group);
  const letters = [...new Set(gAll.map(s=>s.group))].sort();
  WCHUB_HTML = `<a class="wc-ko" href="group/knockout.html">🏆 決勝トーナメント（進出国・日程）</a>`
    + `<div class="wc-groups">` + letters.map(L=>`<a href="group/${L.toLowerCase()}.html" title="グループ${L}のハイライト・順位">${L}</a>`).join('') + `</div>`;
  const wcByTeams = new Map();
  for(const m of data){ if(m.league==='wc' && m.id && m.teams.length===2) wcByTeams.set([...m.teams].sort().join('|'), m); }
  const rOrd = {'第1節':1,'第2節':2,'第3節':3};
  // グループ順位の集計（公式結果優先・掲載ハイライトで補完）。グループページと決勝Tページで共用
  function tableFor(L){
    const fx = gAll.filter(s=>s.group===L).sort((a,b)=>(rOrd[a.round]||9)-(rOrd[b.round]||9) || (a.koUTC||'').localeCompare(b.koUTC||''));
    const teams = [...new Set(fx.flatMap(f=>[f.home&&f.home.ja, f.away&&f.away.ja].filter(Boolean)))];
    const tbl={}; teams.forEach(t=>tbl[t]={p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0});
    for(const f of fx){ const h=f.home&&f.home.ja, a=f.away&&f.away.ja; if(!h||!a||!tbl[h]||!tbl[a]) continue;
      let hg=null, ag=null; const off = WCRESULTS[f.matchId];
      if(off){ const sc=String(off).match(/^(\d+)-(\d+)$/); if(sc){ hg=+sc[1]; ag=+sc[2]; } }
      if(hg===null){ const m=wcByTeams.get([h,a].sort().join('|')); if(m&&m.score){ const sc=m.score.match(/^(\d+)-(\d+)$/); if(sc){ hg=m.teams[0]===h?+sc[1]:+sc[2]; ag=m.teams[0]===h?+sc[2]:+sc[1]; } } }
      if(hg===null) continue;
      tbl[h].p++; tbl[a].p++; tbl[h].gf+=hg; tbl[h].ga+=ag; tbl[a].gf+=ag; tbl[a].ga+=hg;
      if(hg>ag){tbl[h].w++;tbl[h].pts+=3;tbl[a].l++;} else if(hg<ag){tbl[a].w++;tbl[a].pts+=3;tbl[h].l++;} else {tbl[h].d++;tbl[a].d++;tbl[h].pts++;tbl[a].pts++;}
    }
    const played = Object.values(tbl).reduce((s,x)=>s+x.p,0)/2;
    const ranked = teams.slice().sort((x,y)=> tbl[y].pts-tbl[x].pts || (tbl[y].gf-tbl[y].ga)-(tbl[x].gf-tbl[x].ga) || tbl[y].gf-tbl[x].gf || x.localeCompare(y));
    return { fx, teams, tbl, played, ranked };
  }
  for(const L of letters){
    const { fx, teams, tbl, played, ranked } = tableFor(L);
    const allDone = played>=fx.length;
    const noteTxt = allDone ? `全${fx.length}試合の結果に基づく最終順位です。` : `${played}/${fx.length}試合消化時点の順位です（残りは試合後に反映）。`;
    const standings = played>0 ? `<h2 class="lined">グループ${L} 順位</h2><div class="factcard"><table class="standings"><tr><th>#</th><th>国</th><th>試</th><th>勝</th><th>分</th><th>敗</th><th>得</th><th>失</th><th>差</th><th>点</th></tr>${ranked.map((t,i)=>{const r=tbl[t];const gd=r.gf-r.ga;const lk=PAGE_OF[t]?`<a href="../${PAGE_OF[t]}">${flagImg(t)}${esc(t)}</a>`:`${flagImg(t)}${esc(t)}`;return `<tr><td>${i+1}</td><td class="st-team">${lk}</td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}</td><td>${r.ga}</td><td>${gd>=0?'+':''}${gd}</td><td><b>${r.pts}</b></td></tr>`;}).join('')}</table></div><p class="note-sm">${noteTxt}</p>` : '';
    const fixHtml = fx.map(f=>{ const h=f.home&&f.home.ja, a=f.away&&f.away.ja; const m=h&&a&&wcByTeams.get([h,a].sort().join('|'));
      const d=(f.koJST||'').slice(5,16).replace('T',' ').replace('-','/');
      const right = m ? `<a class="gx-link" href="../match/${m.id}.html">▶ ハイライト</a>` : `<span class="gx-soon">準備中</span>`;
      // スコア（公式結果・ホーム-アウェイ順）。既定は隠し、「スコアを表示」ボタンで開示（.spoiler-cover）
      const off = WCRESULTS[f.matchId];
      const sc = (off && /^\d+-\d+$/.test(String(off))) ? String(off) : '';
      const vs = sc ? `<em class="gx-vs">vs</em><span class="gx-score spoiler-cover">${esc(sc)}</span>` : `<em>vs</em>`;
      return `<div class="gx-row"><span class="gx-rd">${esc(f.round||'')}</span><span class="gx-tm">${flagImg(h)}${esc(h||'')} ${vs} ${flagImg(a)}${esc(a||'')}</span><span class="gx-meta">${d}${f.venue?'・'+esc(f.venue):''}</span>${right}</div>`;
    }).join('');
    const teamLines = teams.map(t=>{const i=COUNTRIES[t];return i?`${esc(t)}（${esc(i.peak||i.confed||'')}）`:esc(t);}).join('、');
    const outlook = `グループ${L}は ${teams.map(esc).join('・')} の${teams.length}か国による争い。${teamLines?teamLines+'。':''}各国の展望・歴史・ゆかりの日本人選手は国ページで深掘りできます。`;
    const countryChips = teams.map(t=>PAGE_OF[t]?`<a href="../${PAGE_OF[t]}">${flagImg(t)}${esc(t)}</a>`:`<span class="chip">${flagImg(t)}${esc(t)}</span>`).join('');
    const url = `${DOMAIN}/group/${L.toLowerCase()}.html`;
    const title = `FIFAワールドカップ2026 グループ${L}｜順位・全試合ハイライト・日程`;
    const desc = `W杯2026 グループ${L}（${teams.join('・')}）の暫定順位・全試合の公式ハイライト・日程会場・各国ページ。公式映像のみ・ネタバレ防止。`.slice(0,120);
    const cg = [ {"@type":"WebPage","name":title,"url":url,"inLanguage":"ja","isPartOf":{"@type":"WebSite","name":"Football Highlights Compass","url":DOMAIN+'/'}}, crumbLd([{name:'トップ',url:DOMAIN+'/'},{name:'W杯26',url:`${DOMAIN}/?league=wc`},{name:`グループ${L}`,url}]) ];
    const head = HEAD({ title:`${title} - Football Highlights Compass`, ogtitle:title, desc, url, ogimg:`${DOMAIN}/og.png`, modified:`${TODAY}T12:00:00+09:00`, jsonld:cg });
    const out = head + TOPBAR + `<article class="post">
  ${crumb([{label:'トップ',href:'../'},{label:'W杯26',href:'../?league=wc'},{label:`グループ${L}`}])}
  <p class="kicker">⚽ FIFAワールドカップ2026</p>
  <h1 class="headline">グループ${L}｜順位・全試合ハイライト</h1>
  <p class="dek">${esc(outlook)}</p>
  <h2 class="lined">対戦国</h2><div class="chips">${countryChips}</div>
  ${standings ? `<button class="reveal-spoiler" type="button" onclick="document.documentElement.classList.add('spoiler-off')">🟢 ネタバレ防止中：タップで順位表・スコアを表示</button><div class="spoiler-cover">${standings}</div>` : ''}
  <h2 class="lined">日程・試合ハイライト</h2><div class="gx-list">${fixHtml}</div>
  ${daznCta('W杯26の全試合フル・見逃し配信はDAZNで。')}
  ${AD}
  <p style="margin-top:8px"><a href="../?league=wc&group=${L}">▶ グループ${L}の試合をトップの一覧で見る</a></p>
  ` + FOOTER();
    writeFileSync(`site/group/${L.toLowerCase()}.html`, out);
    groupUrls.push(url);
  }
  // ===== 決勝トーナメント（日程＋各組の進出国。対戦カード/ハイライトはグループ最終確定後に順次反映） =====
  {
    const teamCell = t=> t ? (PAGE_OF[t]?`<a href="../${PAGE_OF[t]}">${flagImg(t)}${esc(t)}</a>`:`${flagImg(t)}${esc(t)}`) : '-';
    const qrows = letters.map(L=>{ const t=tableFor(L); const done=t.played>=t.fx.length;
      const cells = done ? `<td class="st-team">${teamCell(t.ranked[0])}</td><td class="st-team">${teamCell(t.ranked[1])}</td><td class="st-team">${teamCell(t.ranked[2])}</td>` : `<td colspan="3" class="tbd">グループ終了後に確定</td>`;
      return `<tr><td><b>${L}</b></td>${cells}</tr>`;
    }).join('');
    const doneN = letters.filter(L=>{const t=tableFor(L);return t.played>=t.fx.length;}).length;
    const qualTable = `<div class="factcard"><table class="standings ko-qual"><tr><th>組</th><th>1位</th><th>2位</th><th>3位</th></tr>${qrows}</table></div><p class="note-sm">各組1位・2位が決勝トーナメント進出。さらに各組3位のうち上位8チームも進出します。結果が確定したグループから順に反映（${doneN}/${letters.length}組 確定）。</p>`;
    const schedule = `<div class="factcard"><table><tr><th>ラウンド32</th><td>6/28〜7/4（16試合・北中米各地）</td></tr><tr><th>ベスト16</th><td>7/4〜7/7（8試合）</td></tr><tr><th>準々決勝</th><td>7/9〜7/11（4試合）</td></tr><tr><th>準決勝</th><td>7/14・7/15（2試合）</td></tr><tr><th>3位決定戦</th><td>7/18</td></tr><tr><th>決勝</th><td>7/19・メットライフ・スタジアム（ニュージャージー）</td></tr></table></div>`;
    // 決勝トーナメント 各ラウンド 対戦カード（data/wc-knockout.json）。結果はネタバレ防止で既定隠し（spoiler-cover）
    const KO_ROUNDS = [
      {key:'r32', label:'ラウンド32', tag:'R32'},
      {key:'r16', label:'ベスト16', tag:'R16'},
      {key:'qf',  label:'準々決勝',  tag:'QF'},
      {key:'sf',  label:'準決勝',    tag:'SF'},
      {key:'third', label:'3位決定戦', tag:'3位'},
      {key:'final', label:'決勝',     tag:'決勝'},
    ];
    const koRow = (m, tag) => { const h=m.home,a=m.away;
      const sc=(m.result&&/^\d+-\d+$/.test(String(m.result)))?String(m.result):'';
      const pk=(m.pk&&/^\d+-\d+$/.test(String(m.pk)))?` <small class="gx-pk">(PK ${esc(m.pk)})</small>`:'';
      const vs = sc ? `<em class="gx-vs">vs</em><span class="gx-score spoiler-cover">${esc(sc)}${pk}</span>` : `<em>vs</em>`;
      const right = m.videoId ? `<a class="gx-link" href="../match/${m.videoId}.html">▶ ハイライト</a>` : `<span class="gx-soon">準備中</span>`;
      const hl = PAGE_OF[h]?`<a href="../${PAGE_OF[h]}">${flagImg(h)}${esc(h)}</a>`:`${flagImg(h)}${esc(h)}`;
      const al = PAGE_OF[a]?`<a href="../${PAGE_OF[a]}">${flagImg(a)}${esc(a)}</a>`:`${flagImg(a)}${esc(a)}`;
      return `<div class="gx-row"><span class="gx-rd">${tag}</span><span class="gx-tm">${hl} ${vs} ${al}</span><span class="gx-meta"></span>${right}</div>`;
    };
    const r32Section = KO_ROUNDS.map(r=>{ const arr=WCKO[r.key]||[]; if(!arr.length) return '';
      const note = r.key==='r32' ? '<p class="note-sm">対戦カードはSI.com・Sky Sportsで相互確認。スコアは試合消化後に反映し、既定は非表示（下のボタンで表示）。</p>' : '';
      return `<h2 class="lined">${r.label} 対戦カード</h2>${note}<div class="gx-list">${arr.map(m=>koRow(m,r.tag)).join('')}</div>`;
    }).join('');
    const url=`${DOMAIN}/group/knockout.html`;
    const title='FIFAワールドカップ2026 決勝トーナメント｜日程・進出国・ハイライト';
    const desc='W杯2026 決勝トーナメント（ラウンド32〜決勝）の日程・会場と各組の進出国。各試合の公式ハイライトへ。公式映像のみ・ネタバレ防止。'.slice(0,120);
    const cg=[{"@type":"WebPage","name":title,"url":url,"inLanguage":"ja","isPartOf":{"@type":"WebSite","name":"Football Highlights Compass","url":DOMAIN+'/'}}, crumbLd([{name:'トップ',url:DOMAIN+'/'},{name:'W杯26',url:`${DOMAIN}/?league=wc`},{name:'決勝トーナメント',url}])];
    const head=HEAD({ title:`${title} - Football Highlights Compass`, ogtitle:title, desc, url, ogimg:`${DOMAIN}/og.png`, modified:`${TODAY}T12:00:00+09:00`, jsonld:cg });
    const out = head + TOPBAR + `<article class="post">
  ${crumb([{label:'トップ',href:'../'},{label:'W杯26',href:'../?league=wc'},{label:'決勝トーナメント'}])}
  <p class="kicker">⚽ FIFAワールドカップ2026</p>
  <h1 class="headline">決勝トーナメント｜日程・進出国・ハイライト</h1>
  <p class="dek">48チーム・12組の上位32チームによる決勝トーナメント（ラウンド32〜決勝）。日程・会場と、確定した進出国をまとめています。対戦カードと各試合の公式ハイライトは、グループ最終結果の確定後・試合消化に合わせて順次反映します。</p>
  <h2 class="lined">日程</h2>${schedule}
  ${r32Section}
  <button class="reveal-spoiler" type="button" onclick="document.documentElement.classList.add('spoiler-off')">🟢 ネタバレ防止中：タップで進出国・スコアを表示</button>
  <div class="spoiler-cover"><h2 class="lined">グループ別 進出国</h2>${qualTable}</div>
  ${daznCta('W杯26 決勝トーナメントのフル・見逃し配信はDAZNで。')}
  ${AD}
  <p style="margin-top:8px"><a href="../guide/world-cup-2026-how-to-watch.html">▶ W杯26を日本から観る方法・全試合ハイライト</a> ／ <a href="../?league=wc">▶ W杯26の全試合を一覧で見る</a></p>
  ` + FOOTER();
    writeFileSync('site/group/knockout.html', out);
    groupUrls.push(url);
  }
}

// ========================= おすすめ動画（注目の試合カルーセル）自動生成 =========================
// 「今」を反映：日本代表戦 → W杯の注目カード → 直近の主役級クラブ戦 の優先で最大8枚。
// 掲載データ（data）から毎ビルド再生成するので、新しい試合が入れば自動で入れ替わる。
function pickupDate(m){ const s=schedFor(m); return (s&&(s.koUTC||s.dateLocal)||'').slice(0,10) || ''; }
const PICKUP_HTML = (()=>{
  const NOTABLE = new Set(['スペイン','ブラジル','アルゼンチン','フランス','イングランド','ポルトガル','ドイツ','オランダ','イタリア','ベルギー','クロアチア','アメリカ','メキシコ','ウルグアイ','コロンビア','モロッコ']);
  const withId = data.filter(m=>m.id);
  const byDateDesc = (a,b)=> pickupDate(b).localeCompare(pickupDate(a));
  const japan   = withId.filter(m=>m.teams.includes('日本')).sort(byDateDesc);
  const wcHot   = withId.filter(m=>m.league==='wc' && !m.teams.includes('日本') && m.teams.some(t=>NOTABLE.has(t))).sort(byDateDesc);
  const starClub= withId.filter(m=>m.league!=='wc' && (m.prefix||m.players.length)).sort(byDateDesc);
  const seen=new Set(), pick=[];
  const add=m=>{ if(m && !seen.has(m.id)){ seen.add(m.id); pick.push(m); } };
  japan.slice(0,3).forEach(add);     // 日本代表戦（直近）
  wcHot.slice(0,4).forEach(add);     // W杯の注目カード（強豪国・直近）
  starClub.slice(0,3).forEach(add);  // 端境期フォールバック（W杯/日本戦が少ない時期の変化用）
  const PICK = pick.slice(0,8);
  const badge = m =>
    m.teams.includes('日本') ? '🇯🇵 日本代表'
    : m.league==='wc' ? '🔥 W杯注目'
    : m.prefix ? '⚽ '+m.prefix
    : m.players.length ? '⚽ '+m.players[0]
    : m.league==='jl' ? '🏆 Jリーグ'
    : '⚡ PICK';
  const matchLine = m => (m.league==='wc' && m.teams.length===2)
    ? `${flagImg(m.teams[0])} ${esc(m.teams[0])} vs ${flagImg(m.teams[1])} ${esc(m.teams[1])}`
    : (m.prefix?`<span class="ppre">${esc(m.prefix)}</span>`:'') + esc(m.mt || m.teams.join(' vs '));
  const altOf = m => m.teams.length===2 ? m.teams.join(' vs ') : (m.mt||m.ttl);
  return PICK.map(m=>`<a class="pcard cf-card" href="match/${m.id}.html"><div class="thumb"><span class="pbadge">${badge(m)}</span><img src="https://i.ytimg.com/vi/${m.id}/hqdefault.jpg" alt="${escA(altOf(m))}" loading="lazy"><span class="play">▶</span></div><div class="pt"><span class="pcomp">${esc(m.meta || LG[m.league] || '')}</span><span class="pmatch">${matchLine(m)}</span></div></a>`).join('\n      ');
})();

// ENTITY_PAGES と CLUB_CRESTS（メニュー用 クラブ名→紋章URL）を index.html に注入
{
  const map = JSON.stringify(ENTITY_PAGES);
  const crestMap = {};
  for(const [name,info] of Object.entries(CLUBS)) if(CREST[info.slug]) crestMap[name]=CREST[info.slug];
  const scoreMap = {};
  for(const m of data){ if(m.id && m.score) scoreMap[m.id]=m.score; }
  // 新着順ソート用の日付（videoId→"YYYY-MM-DD"）。W杯はスケジュール日付、それ以外は日付不明（空）
  const dateMap = {};
  for(const m of data){ if(!m.id) continue; const s=schedFor(m); const d=(s&&(s.koUTC||s.dateLocal)||'').slice(0,10); if(d) dateMap[m.id]=d; }
  let next = html.replace(/\/\*ENTITY_PAGES_START\*\/[\s\S]*?\/\*ENTITY_PAGES_END\*\//, `/*ENTITY_PAGES_START*/\nvar ENTITY_PAGES = ${map};\n/*ENTITY_PAGES_END*/`);
  next = next.replace(/\/\*CLUB_CRESTS_START\*\/[\s\S]*?\/\*CLUB_CRESTS_END\*\//, `/*CLUB_CRESTS_START*/\nvar CLUB_CRESTS = ${JSON.stringify(crestMap)};\n/*CLUB_CRESTS_END*/`);
  next = next.replace(/\/\*MATCH_SCORES_START\*\/[\s\S]*?\/\*MATCH_SCORES_END\*\//, `/*MATCH_SCORES_START*/\nvar MATCH_SCORES = ${JSON.stringify(scoreMap)};\n/*MATCH_SCORES_END*/`);
  next = next.replace(/\/\*MATCH_DATES_START\*\/[\s\S]*?\/\*MATCH_DATES_END\*\//, `/*MATCH_DATES_START*/\nvar MATCH_DATES = ${JSON.stringify(dateMap)};\n/*MATCH_DATES_END*/`);
  next = next.replace(/<!--PICKUP_START-->[\s\S]*?<!--PICKUP_END-->/, `<!--PICKUP_START-->\n      ${PICKUP_HTML}\n      <!--PICKUP_END-->`);
  // 広告ユニット（トップ）も AD 定義から注入し、スロットIDを一元管理（data/ads.json）
  next = next.replace(/<!--AD_UNIT_START-->[\s\S]*?<!--AD_UNIT_END-->/, `<!--AD_UNIT_START-->\n  ${AD}\n  <!--AD_UNIT_END-->`);
  // W杯ハブ（左ナビ）：決勝T＋全組リンク。group/knockout への内部リンク導線（クローラビリティ）
  next = next.replace(/<!--WCHUB_START-->[\s\S]*?<!--WCHUB_END-->/, `<!--WCHUB_START-->\n        ${WCHUB_HTML}\n        <!--WCHUB_END-->`);
  // 欧州リーグ ハブの左ナビ（トップ）。group同様マーカー注入
  next = next.replace(/<!--EUROHUB_START-->[\s\S]*?<!--EUROHUB_END-->/, `<!--EUROHUB_START-->${leagueNavHtml('')}<!--EUROHUB_END-->`);
  // GA4（トップ）：data/analytics.json の測定IDから注入。空なら出力なし
  next = next.replace(/<!--GA_START-->[\s\S]*?<!--GA_END-->/, `<!--GA_START-->${GA}<!--GA_END-->`);
  writeFileSync('site/index.html', next);
  // 静的ページ（about/contact/privacy）にも GA を注入（GAマーカーがある場合のみ・一元管理）
  for(const sp of ['about.html','contact.html','privacy.html']){
    const fp = `site/${sp}`;
    if(!existsSync(fp)) continue;
    let h = readFileSync(fp,'utf8');
    if(/<!--GA_START-->/.test(h)){ writeFileSync(fp, h.replace(/<!--GA_START-->[\s\S]*?<!--GA_END-->/, `<!--GA_START-->${GA}<!--GA_END-->`)); }
  }
}

// ========================= sitemap =========================
let sm = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n  <url><loc>${DOMAIN}/</loc><lastmod>${TODAY}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
for(const p of ['about.html','privacy.html','contact.html']) sm += `  <url><loc>${DOMAIN}/${p}</loc><lastmod>${TODAY}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>\n`;
for(const u of guideUrls) sm += `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
for(const u of groupUrls) sm += `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>\n`;
for(const u of leagueUrls) sm += `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
for(const p of new Set(Object.values(ENTITY_PAGES))) sm += `  <url><loc>${DOMAIN}/${p}</loc><lastmod>${TODAY}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
const matchById = new Map(data.map(m=>[m.id,m]));
const lastmodOf = id => { const mm=matchById.get(id); const s=mm&&schedFor(mm); return ((s?.koUTC||s?.dateLocal||'').slice(0,10)) || TODAY; };
for(const s of slugs){ if(noindexSlugs.has(s)) continue; const mm=matchById.get(s); const cap=mm?escA((mm.ttl||'')+'｜公式ハイライト'):''; sm += `  <url><loc>${DOMAIN}/match/${s}.html</loc><lastmod>${lastmodOf(s)}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority><image:image><image:loc>https://i.ytimg.com/vi/${s}/hqdefault.jpg</image:loc><image:title>${cap}</image:title></image:image></url>\n`; }
sm += `</urlset>\n`; writeFileSync('site/sitemap.xml', sm);

console.log(`試合ページ: ${slugs.length} / 国: ${nc} / クラブ: ${ncl} / sitemap URL: ${slugs.length + new Set(Object.values(ENTITY_PAGES)).size + 1}`);
