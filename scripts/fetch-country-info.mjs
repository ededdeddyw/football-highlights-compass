// 代表（ナショナルチーム）の歴史・概要を Wikipedia から取得して data/country-info[-en].json に保存する。
// P31（分類）が「ナショナルサッカーチーム（Q135408445）」であることを検証して取り違えを防ぐ。
// 英語版は Wikidata の sitelinks から enwiki 記事を特定するため、英名の推測ミスが起きない。
// APIキー不要・CI/クラウド取得可。fetch-league-info.mjs と同じ安全方式（出典明記・捏造なし）。
//
//   node scripts/fetch-country-info.mjs                 # 日本語・全代表
//   node scripts/fetch-country-info.mjs --lang=en       # 英語・全代表 → data/country-info-en.json
//   node scripts/fetch-country-info.mjs --name=日本     # 特定の代表だけ
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { COUNTRIES } from './entities.mjs';

const args = process.argv.slice(2);
const ONLY = (args.find(a => a.startsWith('--name=')) || '').split('=')[1] || '';
const LANG = (args.find(a => a.startsWith('--lang=')) || '').split('=')[1] || 'ja';
const OUT = LANG === 'en' ? 'data/country-info-en.json' : 'data/country-info.json';
const JA_WP = 'https://ja.wikipedia.org/w/api.php';
const EN_WP = 'https://en.wikipedia.org/w/api.php';
const WD = 'https://www.wikidata.org/w/api.php';
const H = { 'user-agent': 'FootballHighlightsCompass/1.0 (country info; https://highlight-compass.com)' };

// 代表名 → 日本語Wikipedia記事タイトル（既定は「サッカー〈名〉代表」。正式名称が異なるものだけ上書き）
const NATION_WIKI = {
  'アメリカ': 'サッカーアメリカ合衆国代表',
  '韓国': 'サッカー大韓民国代表',
  '南アフリカ': 'サッカー南アフリカ共和国代表',
};
// ナショナルサッカーチームを表す Wikidata クラス（P31 許容値）
const TEAM_CLASS = new Set(['Q135408445', 'Q6979593']);

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
// 概要を読みやすい長さに整える（文単位・最大約420字）。脚注番号や余分な空白を除去。
function trimExtract(t) {
  let s = (t || '').replace(/\s*\n\s*/g, ' ').replace(/\[\d+\]/g, '').trim();
  const sents = s.split(LANG === 'en' ? /(?<=\.)\s/ : /(?<=。)/); let out = '';
  for (const se of sents) { if ((out + se).length > 420) break; out += (LANG === 'en' && out ? ' ' : '') + se; if (out.length > 300) break; }
  return (out || s.slice(0, 420)).trim();
}
// 1記事の概要テキスト＋qidを取得
async function wpExtract(api, title) {
  const j = await jget(`${api}?action=query&format=json&redirects=1&prop=extracts|pageprops&exintro=1&explaintext=1&titles=${encodeURIComponent(title)}`);
  const p = Object.values(j.query.pages || {})[0];
  if (!p || 'missing' in p) return null;
  return { title: p.title, extract: p.extract || '', qid: (p.pageprops || {}).wikibase_item || '' };
}

async function fetchOne(name, info) {
  const jaTitle = NATION_WIKI[name] || `サッカー${name}代表`;
  const ja = await wpExtract(JA_WP, jaTitle);
  if (!ja || !ja.qid) return null;
  // Wikidataで分類(P31)検証＋英語記事タイトル(sitelinks)を取得
  const w = await jget(`${WD}?action=wbgetentities&format=json&ids=${ja.qid}&props=claims|sitelinks`);
  const ent = w.entities[ja.qid] || {};
  const p31 = ((ent.claims && ent.claims.P31 || []).map(s => (s.mainsnak.datavalue && s.mainsnak.datavalue.value || {}).id));
  if (!p31.some(id => TEAM_CLASS.has(id))) return null;   // 代表チーム記事でなければ採用しない（取り違え防止）
  if (LANG === 'en') {
    const enTitle = ((ent.sitelinks || {}).enwiki || {}).title;
    if (!enTitle) return null;
    const en = await wpExtract(EN_WP, enTitle);
    const extract = trimExtract(en && en.extract);
    if (!extract) return null;
    return { key: info.slug, rec: { slug: info.slug, title: en.title, wikiUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(en.title)}`, extract, updated: new Date().toISOString() } };
  }
  const extract = trimExtract(ja.extract);
  if (!extract) return null;
  return { key: name, rec: { name, title: ja.title, wikiUrl: `https://ja.wikipedia.org/wiki/${encodeURIComponent(ja.title)}`, extract, updated: new Date().toISOString() } };
}

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const out = { ...prev };
let names = Object.keys(COUNTRIES);
if (ONLY) names = names.filter(n => n === ONLY);

let ok = 0, skip = 0, fail = 0;
for (const name of names) {
  const info = COUNTRIES[name];
  if (!info || !info.slug) { skip++; continue; }
  try {
    const r = await fetchOne(name, info);
    if (r && r.rec && r.rec.extract) { out[r.key] = r.rec; ok++; process.stdout.write(`  ✓ ${name} (${r.rec.title})            \r`); }
    else { skip++; if (!prev[LANG === 'en' ? info.slug : name]) console.error(`\n  ? ${name}: 代表記事を特定できず`); }
  } catch (e) { fail++; console.error(`\n  ⚠ ${name}: ${e.message}（前回分を保持）`); }
  await sleep(200);
}
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`\n${OUT}: 更新 ${ok} / 特定できず ${skip} / 失敗 ${fail} / 収録 ${Object.keys(out).length}代表`);
