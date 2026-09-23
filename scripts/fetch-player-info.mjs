// 選手概要（経歴）を Wikipedia日本語版から取得して data/player-info.json に保存する。
// data/players.json の各選手が対象。P31=Q5(人物) を検証して人物記事だけ採用（取り違え防止）。
//
// 使い方:
//   node scripts/fetch-player-info.mjs                 # 全選手
//   node scripts/fetch-player-info.mjs --slug=kubo-takefusa
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const ONLY_SLUG = (args.find(a => a.startsWith('--slug=')) || '').split('=')[1] || '';
const OUT = 'data/player-info.json';
const WP = 'https://ja.wikipedia.org/w/api.php';
const WD = 'https://www.wikidata.org/w/api.php';
const H = { 'user-agent': 'FootballHighlightsCompass/1.0 (player info; https://highlight-compass.com)' };
const PLAYERS = (() => { try { return JSON.parse(readFileSync('data/players.json', 'utf8')).players || []; } catch { return []; } })();

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
  for (const se of sents) { if ((out + se).length > 400) break; out += se; if (out.length > 240) break; }
  return (out || s.slice(0, 400)).trim();
}

async function tryTitle(title, name) {
  const j = await jget(`${WP}?action=query&format=json&redirects=1&prop=extracts|pageprops&exintro=1&explaintext=1&titles=${encodeURIComponent(title)}`);
  const p = Object.values(j.query.pages || {})[0];
  if (!p || 'missing' in p) return null;
  const qid = (p.pageprops || {}).wikibase_item;
  if (!qid) return null;
  const w = await jget(`${WD}?action=wbgetentities&format=json&ids=${qid}&props=claims`);
  const p31 = ((w.entities[qid].claims.P31 || []).map(s => (s.mainsnak.datavalue && s.mainsnak.datavalue.value || {}).id));
  if (!p31.includes('Q5')) return null;                 // 人物のみ
  if (!/サッカー選手|フットボール/.test(p.extract || '')) return null; // サッカー選手のみ
  return { name, title: p.title, wikiUrl: `https://ja.wikipedia.org/wiki/${encodeURIComponent(p.title)}`, extract: trimExtract(p.extract), updated: new Date().toISOString() };
}
async function fetchOne(name) {
  // 同名の曖昧さ回避（田中碧→「田中碧 (サッカー選手)」等）にも対応
  for (const t of [name, `${name} (サッカー選手)`, `${name}(サッカー選手)`]) {
    const rec = await tryTitle(t, name);
    if (rec) return rec;
  }
  return null;
}

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const out = { ...prev };
let players = PLAYERS;
if (ONLY_SLUG) players = players.filter(p => p.slug === ONLY_SLUG);

let ok = 0, skip = 0, fail = 0;
for (const p of players) {
  try {
    const rec = await fetchOne(p.name);
    if (rec && rec.extract) { out[p.slug] = rec; ok++; process.stdout.write(`  ✓ ${p.slug} (${rec.title})            \r`); }
    else { skip++; if (!prev[p.slug]) console.error(`\n  ? ${p.slug} (${p.name}): 人物記事を特定できず`); }
  } catch (e) { fail++; console.error(`\n  ⚠ ${p.slug}: ${e.message}（前回分を保持）`); }
  await sleep(200);
}
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`\n${OUT}: 更新 ${ok} / 特定できず ${skip} / 失敗 ${fail} / 収録 ${Object.keys(out).length}選手`);
