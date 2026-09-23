// 選手別ニュースを Google News RSS から取得して data/player-news.json に保存する。
// data/players.json の各選手（日本人選手中心）を対象。APIキー不要・consent無しでCI/クラウド取得可。
//
// 使い方:
//   node scripts/fetch-player-news.mjs                 # 全選手
//   node scripts/fetch-player-news.mjs --slug=kubo-takefusa
//   node scripts/fetch-player-news.mjs --per=6         # 1選手あたり記事数（既定6）
//
// 方針: 取得できた選手だけ更新し、失敗選手は既存内容を保持（全消え防止）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const argVal = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PER = parseInt(argVal('per', '6'), 10) || 6;
const ONLY_SLUG = argVal('slug', '');
const OUT = 'data/player-news.json';
const PLAYERS = (() => { try { return JSON.parse(readFileSync('data/players.json', 'utf8')).players || []; } catch { return []; } })();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = s => (s || '')
  .replace(/<!\[CDATA\[|\]\]>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .trim();

function parseItems(xml) {
  const out = [];
  for (const m of (xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const title = decode((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const link = decode((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '');
    const pub = decode((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '');
    const src = decode((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '');
    if (!title || !link) continue;
    let t = title;
    if (src && t.endsWith(' - ' + src)) t = t.slice(0, -(src.length + 3)).trim();
    const d = pub ? new Date(pub) : null;
    out.push({ t, u: link, src, d: d && !isNaN(d) ? d.toISOString() : '' });
  }
  return out;
}

async function fetchNews(name) {
  const q = encodeURIComponent(`${name} サッカー`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=ja&gl=JP&ceid=JP:ja`;
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'ja,en;q=0.8' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = await r.text();
  return parseItems(xml)
    .filter(it => it.t.length >= 6)
    .sort((a, b) => (b.d || '').localeCompare(a.d || ''))
    .slice(0, PER);
}

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const out = { ...prev };
let players = PLAYERS;
if (ONLY_SLUG) players = players.filter(p => p.slug === ONLY_SLUG);

let ok = 0, kept = 0, fail = 0;
for (const p of players) {
  try {
    const items = await fetchNews(p.name);
    if (items.length) { out[p.slug] = { name: p.name, updated: new Date().toISOString(), items }; ok++; process.stdout.write(`  ✓ ${p.slug} (${items.length})            \r`); }
    else if (prev[p.slug]) kept++;
  } catch (e) { fail++; console.error(`\n  ⚠ ${p.slug}: ${e.message}（前回分を保持）`); }
  await sleep(200);
}
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`\n${OUT}: 更新 ${ok}選手 / 保持(0件) ${kept} / 失敗 ${fail} / 収録 ${Object.keys(out).length}選手`);
