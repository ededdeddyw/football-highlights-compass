// クラブ別ニュースを Google News RSS から取得して data/club-news.json に保存する。
// APIキー不要・consent無し（YouTubeと違いクラウド/CIから取得できる）。
//
// 使い方:
//   node scripts/fetch-club-news.mjs                 # 全クラブ更新
//   node scripts/fetch-club-news.mjs --limit=5       # 先頭5クラブだけ（動作確認用）
//   node scripts/fetch-club-news.mjs --slug=urawa    # 特定クラブだけ
//   node scripts/fetch-club-news.mjs --per=6         # 1クラブあたり記事数（既定6）
//
// 方針: 取得できたクラブだけ更新し、失敗クラブは既存 data/club-news.json の内容を保持する
//       （一時的なネットワーク不調で全消えするのを防ぐ）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { CLUBS } from './entities.mjs';

const args = process.argv.slice(2);
const argVal = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const LIMIT = parseInt(argVal('limit', '0'), 10) || 0;
const PER = parseInt(argVal('per', '6'), 10) || 6;
const ONLY_SLUG = argVal('slug', '');
const OUT = 'data/club-news.json';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = s => (s || '')
  .replace(/<!\[CDATA\[|\]\]>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .trim();

// Google News RSS の <item> を素朴に分解（title/link/pubDate/source）。
function parseItems(xml) {
  const out = [];
  for (const m of (xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const title = decode((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const link = decode((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '');
    const pub = decode((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '');
    const src = decode((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '');
    if (!title || !link) continue;
    // Google News のタイトルは末尾に " - 媒体名" が付くことが多いので、媒体名が取れていれば重複を落とす。
    let t = title;
    if (src && t.endsWith(' - ' + src)) t = t.slice(0, -(src.length + 3)).trim();
    const d = pub ? new Date(pub) : null;
    out.push({ t, u: link, src, d: d && !isNaN(d) ? d.toISOString() : '' });
  }
  return out;
}

async function fetchClubNews(name) {
  const q = encodeURIComponent(`${name} サッカー`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=ja&gl=JP&ceid=JP:ja`;
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'ja,en;q=0.8' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = await r.text();
  const items = parseItems(xml)
    .filter(it => it.t.length >= 6)                 // ゴミ見出し除去
    .sort((a, b) => (b.d || '').localeCompare(a.d || ''))
    .slice(0, PER);
  return items;
}

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const out = { ...prev };
let entries = Object.entries(CLUBS);
if (ONLY_SLUG) entries = entries.filter(([, i]) => i.slug === ONLY_SLUG);
if (LIMIT) entries = entries.slice(0, LIMIT);

let ok = 0, kept = 0, fail = 0;
for (const [name, info] of entries) {
  try {
    const items = await fetchClubNews(name);
    if (items.length) {
      out[info.slug] = { name, updated: new Date().toISOString(), items };
      ok++;
      process.stdout.write(`  ✓ ${info.slug} (${items.length})            \r`);
    } else if (prev[info.slug]) {
      kept++;   // 0件なら前回分を保持
    }
  } catch (e) {
    fail++;
    if (!prev[info.slug]) { /* 前回も無い＝スキップ */ }
    console.error(`\n  ⚠ ${info.slug}: ${e.message}（前回分を保持）`);
  }
  await sleep(200);   // Google News への配慮（緩いレート制限）
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`\n${OUT}: 更新 ${ok}クラブ / 保持(0件) ${kept} / 失敗 ${fail} / 収録クラブ計 ${Object.keys(out).length}`);
