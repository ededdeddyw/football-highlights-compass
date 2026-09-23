// クラブ概要（歴史・現況）と安定した構造化事実を Wikipedia(ja) + Wikidata から取得し、
// data/club-info.json に保存する。APIキー不要・consent無しでCI/クラウドから取得できる。
//
// 使い方:
//   node scripts/fetch-club-info.mjs                 # 全クラブ
//   node scripts/fetch-club-info.mjs --limit=5       # 先頭5クラブ（確認用）
//   node scripts/fetch-club-info.mjs --slug=arsenal  # 特定クラブだけ
//
// 方針:
//  - 記事の取り違え（例: 「ローマ」→サッカー全般、「ニース」→都市）を防ぐため、
//    候補記事の Wikidata P31（分類）が「サッカークラブ（Q476028 等）」であることを検証してから採用する。
//  - 監督など揮発性が高く古くなりがちな値は扱わない。創設・本拠地・収容・公式サイト・愛称など安定情報のみ。
//  - 取得できたクラブだけ更新し、失敗クラブは既存の内容を保持（全消え防止）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { CLUBS } from './entities.mjs';

const args = process.argv.slice(2);
const argVal = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const LIMIT = parseInt(argVal('limit', '0'), 10) || 0;
const ONLY_SLUG = argVal('slug', '');
const OUT = 'data/club-info.json';
const WP = 'https://ja.wikipedia.org/w/api.php';
const WD = 'https://www.wikidata.org/w/api.php';
const H = { 'user-agent': 'FootballHighlightsCompass/1.0 (club info enrichment; https://highlight-compass.com)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// サッカークラブ/チームを表す Wikidata クラス（P31 の許容値）。※リーグ(Q15991303)や競技会は含めない。
//   Q476028=サッカークラブ, Q103229495=men's association football team, Q15944511=サッカーチーム,
//   Q14752149=アマチュアサッカークラブ, Q476028 系の近縁。
const CLUB_CLASSES = new Set(['Q476028', 'Q103229495', 'Q15944511', 'Q14752149', 'Q1194951']);
// リーグ/大会クラス（万一クラブ記事に紛れても弾く）。
const LEAGUE_CLASSES = new Set(['Q15991303', 'Q15991290', 'Q623109', 'Q27020041', 'Q6832945']);

// 取り違えが起きやすいクラブの明示タイトル（任意・優先候補）。
const TITLE_OVERRIDE = {
  'bayern-munich': 'FCバイエルン・ミュンヘン', 'borussia-dortmund': 'ボルシア・ドルトムント',
  'as-roma': 'ASローマ', 'napoli': 'SSCナポリ', 'nice': 'OGCニース', 'inter': 'インテルナツィオナーレ・ミラノ',
  'ac-milan': 'ACミラン', 'genoa': 'ジェノアCFC', 'torino': 'トリノFC', 'como': 'コモ1907',
  'valencia': 'バレンシアCF', 'osasuna': 'CAオサスナ', 'elche': 'エルチェCF', 'levante': 'レバンテUD',
  'paris': 'パリFC', 'metz': 'FCメス', 'nantes': 'FCナント', 'lorient': 'FCロリアン',
  'racing-lens': 'RCランス', 'stade-brestois': 'スタッド・ブレスト29',
  'wolfsburg': 'VfLヴォルフスブルク', 'chelsea': 'チェルシーFC', 'arsenal': 'アーセナルFC',
  'liverpool': 'リヴァプールFC', 'everton': 'エヴァートンFC', 'fulham': 'フラムFC',
  'sevilla': 'セビリアFC', 'girona': 'ジローナFC', 'celta-vigo': 'セルタ・デ・ビーゴ',
  'lazio': 'SSラツィオ', 'atalanta': 'アタランタBC', 'fiorentina': 'ACFフィオレンティーナ',
  'bologna': 'ボローニャFC1909', 'udinese': 'ウディネーゼ・カルチョ', 'lecce': 'USレッチェ',
  'cagliari': 'カリアリ・カルチョ', 'sassuolo': 'USサッスオーロ・カルチョ', 'pisa': 'ピサSC',
  'strasbourg-alsace': 'RCストラスブール', 'toulouse': 'トゥールーズFC', 'auxerre': 'AJオセール',
  'angers': 'アンジェSCO', 'le-havre': 'ル・アーヴルAC',
};

// Wikimedia への配慮：全リクエストを直列化し最小間隔を空け、429/503 は Retry-After / 指数バックオフで待つ。
let _last = 0;
async function throttle(min = 500) { const now = Date.now(); const wait = _last + min - now; if (wait > 0) await sleep(wait); _last = Date.now(); }
async function jget(url) {
  for (let attempt = 1; ; attempt++) {
    await throttle();
    const r = await fetch(url, { headers: H });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status === 503) && attempt <= 5) {
      const ra = parseInt(r.headers.get('retry-after') || '0', 10);
      const back = ra > 0 ? ra * 1000 : Math.min(1500 * attempt, 8000);
      await sleep(back);
      continue;
    }
    throw new Error(`HTTP ${r.status}`);
  }
}

// Wikipedia: タイトル群のイントロ抜粋＋QIDをまとめて取得
async function wpPages(titles) {
  const u = `${WP}?action=query&format=json&redirects=1&prop=extracts|pageprops&exintro=1&explaintext=1&titles=${encodeURIComponent(titles.join('|'))}`;
  const j = await jget(u);
  const out = {};
  const norm = {};
  for (const n of (j.query.normalized || [])) norm[n.from] = n.to;
  for (const r of (j.query.redirects || [])) norm[r.from] = r.to;
  for (const p of Object.values(j.query.pages || {})) {
    if ('missing' in p) continue;
    out[p.title] = { title: p.title, extract: p.extract || '', qid: (p.pageprops || {}).wikibase_item || '' };
  }
  return { pages: out, norm };
}

// Wikipedia 検索で候補タイトル
async function wpSearch(q, n = 3) {
  const j = await jget(`${WP}?action=query&format=json&list=search&srlimit=${n}&srsearch=${encodeURIComponent(q)}`);
  return (j.query.search || []).map(s => s.title);
}

// Wikidata: 複数QIDの claims をまとめて取得
async function wdEntities(ids) {
  if (!ids.length) return {};
  const j = await jget(`${WD}?action=wbgetentities&format=json&ids=${ids.join('|')}&props=claims`);
  return j.entities || {};
}
async function wdLabels(ids) {
  if (!ids.length) return {};
  const j = await jget(`${WD}?action=wbgetentities&format=json&ids=${ids.join('|')}&props=labels&languages=ja|en`);
  const out = {};
  for (const [id, e] of Object.entries(j.entities || {})) { const l = e.labels || {}; out[id] = (l.ja || l.en || {}).value || ''; }
  return out;
}
const claimId = (claims, p) => { const a = claims && claims[p]; const v = a && a[0] && a[0].mainsnak.datavalue && a[0].mainsnak.datavalue.value; return v && v.id; };
const claimVal = (claims, p) => { const a = claims && claims[p]; return a && a[0] && a[0].mainsnak.datavalue && a[0].mainsnak.datavalue.value; };
const p31ids = (claims) => (claims && claims.P31 || []).map(s => (s.mainsnak.datavalue && s.mainsnak.datavalue.value || {}).id).filter(Boolean);
// クラブ判定: クラブ/チームのクラスを持ち、かつリーグ/大会クラスを持たない（＝リーグ記事の取り違えを防ぐ）。
const isClub = (claims) => { const ids = p31ids(claims); return ids.some(id => CLUB_CLASSES.has(id)) && !ids.some(id => LEAGUE_CLASSES.has(id)); };

function trimExtract(t) {
  let s = (t || '').replace(/\s*\n\s*/g, ' ').replace(/\[\d+\]/g, '').trim();
  // 3〜4文（約400字）に収める
  const sents = s.split(/(?<=。)/);
  let out = '';
  for (const se of sents) { if ((out + se).length > 420) break; out += se; if (out.length > 260) break; }
  return (out || s.slice(0, 420)).trim();
}

async function fetchOne(name, slug) {
  // 候補タイトル（優先順）
  const cands = [];
  if (TITLE_OVERRIDE[slug]) cands.push(TITLE_OVERRIDE[slug]);
  cands.push(name, `${name}FC`);
  for (const t of await wpSearch(`${name} サッカークラブ`, 3)) if (!cands.includes(t)) cands.push(t);

  // まとめて抜粋+QIDを取り、QIDのP31でサッカークラブ検証
  const { pages, norm } = await wpPages([...new Set(cands)]);
  const resolveTitle = t => norm[t] || t;
  const qidByTitle = {};
  for (const c of cands) { const rt = resolveTitle(c); const pg = pages[rt]; if (pg && pg.qid) qidByTitle[c] = pg.qid; }
  const qids = [...new Set(Object.values(qidByTitle))];
  const ents = await wdEntities(qids);

  let chosen = null;
  for (const c of cands) {
    const q = qidByTitle[c]; if (!q) continue;
    const claims = (ents[q] || {}).claims;
    if (claims && isClub(claims)) { const rt = resolveTitle(c); chosen = { title: rt, qid: q, extract: pages[rt].extract, claims }; break; }
  }
  if (!chosen) return null;

  // 安定した構造化事実（監督などの揮発値は扱わない）
  const claims = chosen.claims;
  const inceptionRaw = claimVal(claims, 'P571'); // 創設
  const founded = inceptionRaw && inceptionRaw.time ? parseInt(inceptionRaw.time.slice(1, 5), 10) : null;
  const website = claimVal(claims, 'P856') || '';
  const nickQ = null; // 愛称は言語依存で崩れやすいので今回は見送り
  const venueQ = claimId(claims, 'P115');
  let stadium = '', capacity = null;
  if (venueQ) {
    const ve = await wdEntities([venueQ]);
    const vc = (ve[venueQ] || {}).claims;
    const cap = claimVal(vc, 'P1083'); if (cap && cap.amount) capacity = Math.abs(parseInt(cap.amount, 10)) || null;
    const lbl = await wdLabels([venueQ]); stadium = lbl[venueQ] || '';
  }

  return {
    name, title: chosen.title,
    wikiUrl: `https://ja.wikipedia.org/wiki/${encodeURIComponent(chosen.title)}`,
    extract: trimExtract(chosen.extract),
    founded: founded || null, stadium: stadium || '', capacity: capacity || null,
    website: /^https?:\/\//.test(website) ? website : '',
    updated: new Date().toISOString(),
  };
}

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const out = { ...prev };
let entries = Object.entries(CLUBS);
if (ONLY_SLUG) entries = entries.filter(([, i]) => i.slug === ONLY_SLUG);
if (LIMIT) entries = entries.slice(0, LIMIT);

let ok = 0, skip = 0, fail = 0;
for (const [name, info] of entries) {
  try {
    const rec = await fetchOne(name, info.slug);
    if (rec && rec.extract) { out[info.slug] = rec; ok++; process.stdout.write(`  ✓ ${info.slug} (${rec.title})                    \r`); }
    else { skip++; if (!prev[info.slug]) console.error(`\n  ? ${info.slug} (${name}): サッカークラブ記事を特定できず`); }
  } catch (e) { fail++; console.error(`\n  ⚠ ${info.slug}: ${e.message}（前回分を保持）`); }
  await sleep(300);
}
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`\n${OUT}: 更新 ${ok} / 特定できず ${skip} / 失敗 ${fail} / 収録 ${Object.keys(out).length}クラブ`);
