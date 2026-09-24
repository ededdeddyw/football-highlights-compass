// リーグ概要（歴史・方式）を Wikipedia日本語版から取得して data/league-info.json に保存する。
// P31（分類）が「サッカーリーグ/大会」であることを検証して取り違えを防ぐ。APIキー不要・CI/クラウド取得可。
//
//   node scripts/fetch-league-info.mjs            # 全リーグ
//   node scripts/fetch-league-info.mjs --code=pl  # 特定リーグだけ
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const ONLY = (args.find(a => a.startsWith('--code=')) || '').split('=')[1] || '';
const OUT = 'data/league-info.json';
const WP = 'https://ja.wikipedia.org/w/api.php';
const WD = 'https://www.wikidata.org/w/api.php';
const H = { 'user-agent': 'FootballHighlightsCompass/1.0 (league info; https://highlight-compass.com)' };

// リーグコード → {jp:表示名, wiki:Wikipedia記事タイトル}
const LEAGUES = {
  pl:        { jp: 'プレミアリーグ',       wiki: 'プレミアリーグ' },
  laliga:    { jp: 'ラ・リーガ',           wiki: 'プリメーラ・ディビシオン' },
  sa:        { jp: 'セリエA',              wiki: 'セリエA (サッカー)' },
  bl:        { jp: 'ブンデスリーガ',       wiki: 'フースバル・ブンデスリーガ' },
  ligue1:    { jp: 'リーグアン',           wiki: 'リーグ・アン' },
  cl:        { jp: 'チャンピオンズリーグ', wiki: 'UEFAチャンピオンズリーグ' },
  eredivisie:{ jp: 'エールディヴィジ',     wiki: 'エールディヴィジ' },
  j1:        { jp: 'J1リーグ',             wiki: 'J1リーグ' },
  j2:        { jp: 'J2リーグ',             wiki: 'J2リーグ' },
  j3:        { jp: 'J3リーグ',             wiki: 'J3リーグ' },
  belgium:   { jp: 'ベルギー・プロリーグ', wiki: 'ベルギー・ファースト・ディビジョンA' },
};
// サッカーリーグ/大会を表す Wikidata クラス（P31 許容値）
const LEAGUE_CLASS = new Set(['Q15991303', 'Q15089', 'Q18543742', 'Q623109', 'Q1478437', 'Q15991290', 'Q34542757', 'Q135641761']);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let _last = 0;
async function throttle(min = 500) { const w = _last + min - Date.now(); if (w > 0) await sleep(w); _last = Date.now(); }
async function jget(url) {
  for (let a = 1; ; a++) {
    await throttle();
    const r = await fetch(url, { headers: H });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status === 503) && a <= 5) { const ra = parseInt(r.headers.get('retry-after') || '0', 10); await sleep(ra > 0 ? ra * 1000 : Math.min(1500 * a, 8000)); continue; }
    throw new Error(`HTTP ${r.status}`);
  }
}
function trimExtract(t) {
  let s = (t || '').replace(/\s*\n\s*/g, ' ').replace(/\[\d+\]/g, '').trim();
  const sents = s.split(/(?<=。)/); let out = '';
  for (const se of sents) { if ((out + se).length > 420) break; out += se; if (out.length > 260) break; }
  return (out || s.slice(0, 420)).trim();
}

async function fetchOne(code, meta) {
  const j = await jget(`${WP}?action=query&format=json&redirects=1&prop=extracts|pageprops&exintro=1&explaintext=1&titles=${encodeURIComponent(meta.wiki)}`);
  const p = Object.values(j.query.pages || {})[0];
  if (!p || 'missing' in p) return null;
  const qid = (p.pageprops || {}).wikibase_item;
  if (!qid) return null;
  const w = await jget(`${WD}?action=wbgetentities&format=json&ids=${qid}&props=claims`);
  const p31 = ((w.entities[qid].claims.P31 || []).map(s => (s.mainsnak.datavalue && s.mainsnak.datavalue.value || {}).id));
  if (!p31.some(id => LEAGUE_CLASS.has(id))) return null;
  return { code, jp: meta.jp, title: p.title, wikiUrl: `https://ja.wikipedia.org/wiki/${encodeURIComponent(p.title)}`, extract: trimExtract(p.extract), updated: new Date().toISOString() };
}

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const out = { ...prev };
let entries = Object.entries(LEAGUES);
if (ONLY) entries = entries.filter(([c]) => c === ONLY);

let ok = 0, skip = 0, fail = 0;
for (const [code, meta] of entries) {
  try {
    const rec = await fetchOne(code, meta);
    if (rec && rec.extract) { out[code] = rec; ok++; process.stdout.write(`  ✓ ${code} (${rec.title})            \r`); }
    else { skip++; if (!prev[code]) console.error(`\n  ? ${code} (${meta.wiki}): リーグ記事を特定できず`); }
  } catch (e) { fail++; console.error(`\n  ⚠ ${code}: ${e.message}（前回分を保持）`); }
  await sleep(200);
}
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`\n${OUT}: 更新 ${ok} / 特定できず ${skip} / 失敗 ${fail} / 収録 ${Object.keys(out).length}リーグ`);
