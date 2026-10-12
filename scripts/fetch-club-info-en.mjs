// クラブの概要（英語・en.wikipedia）を取得して data/club-info-en.json に保存する。
// すでに検証済みの data/club-info.json（日本語の解決済みタイトル）を入力に、
// 日本語記事 → Wikidata の sitelinks(enwiki) で正しい英語記事を特定して概要を取得する（英名の推測ミスを防ぐ）。
// APIキー不要・CI/クラウド取得可。出典明記・捏造なしの安全方式。
//
//   node scripts/fetch-club-info-en.mjs             # 全クラブ
//   node scripts/fetch-club-info-en.mjs --slug=arsenal
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const ONLY = (args.find(a => a.startsWith('--slug=')) || '').split('=')[1] || '';
const IN = 'data/club-info.json';
const OUT = 'data/club-info-en.json';
const JA_WP = 'https://ja.wikipedia.org/w/api.php';
const EN_WP = 'https://en.wikipedia.org/w/api.php';
const WD = 'https://www.wikidata.org/w/api.php';
const H = { 'user-agent': 'FootballHighlightsCompass/1.0 (club info en; https://highlight-compass.com)' };
// サッカークラブを表す Wikidata クラス（P31 許容値・取り違え防止）
const CLUB_CLASS = new Set(['Q476028', 'Q15944511', 'Q15991303', 'Q13394080', 'Q847017', 'Q6979593', 'Q103229495', 'Q20639856', 'Q10651067']);

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
  const sents = s.split(/(?<=\.)\s/); let out = '';
  for (const se of sents) { if ((out + se).length > 420) break; out += (out ? ' ' : '') + se; if (out.length > 300) break; }
  return (out || s.slice(0, 420)).trim();
}
async function wpExtract(api, title) {
  const j = await jget(`${api}?action=query&format=json&redirects=1&prop=extracts|pageprops&exintro=1&explaintext=1&titles=${encodeURIComponent(title)}`);
  const p = Object.values(j.query.pages || {})[0];
  if (!p || 'missing' in p) return null;
  return { title: p.title, extract: p.extract || '', qid: (p.pageprops || {}).wikibase_item || '' };
}

async function fetchOne(slug, jaTitle) {
  const ja = await wpExtract(JA_WP, jaTitle);
  if (!ja || !ja.qid) return null;
  const w = await jget(`${WD}?action=wbgetentities&format=json&ids=${ja.qid}&props=claims|sitelinks`);
  const ent = w.entities[ja.qid] || {};
  const p31 = ((ent.claims && ent.claims.P31 || []).map(s => (s.mainsnak.datavalue && s.mainsnak.datavalue.value || {}).id));
  if (!p31.some(id => CLUB_CLASS.has(id))) return null;   // クラブ記事でなければ採用しない
  const enTitle = ((ent.sitelinks || {}).enwiki || {}).title;
  if (!enTitle) return null;
  const en = await wpExtract(EN_WP, enTitle);
  const extract = trimExtract(en && en.extract);
  if (!extract) return null;
  return { slug, title: en.title, wikiUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(en.title)}`, extract, updated: new Date().toISOString() };
}

if (!existsSync(IN)) { console.error(`${IN} が見つかりません。先に fetch-club-info.mjs を実行してください。`); process.exit(1); }
const src = JSON.parse(readFileSync(IN, 'utf8'));
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const out = { ...prev };
let slugs = Object.keys(src);
if (ONLY) slugs = slugs.filter(s => s === ONLY);

let ok = 0, skip = 0, fail = 0;
for (const slug of slugs) {
  const jaTitle = (src[slug] || {}).title;
  if (!jaTitle) { skip++; continue; }
  try {
    const rec = await fetchOne(slug, jaTitle);
    if (rec && rec.extract) { out[slug] = rec; ok++; process.stdout.write(`  ✓ ${slug} (${rec.title})            \r`); }
    else { skip++; if (!prev[slug]) console.error(`\n  ? ${slug}: 英語記事を特定できず`); }
  } catch (e) { fail++; console.error(`\n  ⚠ ${slug}: ${e.message}（前回分を保持）`); }
  await sleep(200);
}
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`\n${OUT}: 更新 ${ok} / 特定できず ${skip} / 失敗 ${fail} / 収録 ${Object.keys(out).length}クラブ`);
