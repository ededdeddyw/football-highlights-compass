// プレシーズン/親善試合（data/preseason-<season>.json）の各試合について、
// YouTube からハイライト動画を探し、両チーム名がタイトルに含まれる公開動画だけを videoId として付与する。
// YouTube に到達できる CI ランナーで回す前提（ローカルのプロキシ環境では検索が通らない）。
//
// 使い方: node scripts/find-preseason-videos.mjs [--season=2026] [--limit=N] [--force] [--dry-run] [--probe]
//   --force    既に videoId のある試合も対象にする
//   --dry-run  JSON を書き換えず、選定結果のレポートだけ出力
//   --probe    採用候補の日本再生可否を ANDROID InnerTube で best-effort 判定（記録のみ・除外はしない）
//
// マッチング方針（ネタバレ・誤爆防止）:
//   - 未終了の試合（finished でない）は対象外。
//   - 候補は oEmbed で公開確認しタイトル/チャンネルを取得。
//   - タイトルに **両チームの識別トークンが両方** 含まれる動画だけ採用（片方だけ・無関係は不採用）。
//   - ハイライト系の語（highlights/ハイライト/resumen/friendly など）とチャンネルの公式らしさで加点。
//   - #shorts（縦型）や極端に短いタイトルは不採用。1件も条件を満たさなければ videoId は空のまま。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const has = f => args.includes(f);
const opt = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const SEASON = opt('season', '2026');
const LIMIT = (() => { const v = +opt('limit', ''); return Number.isFinite(v) && v > 0 ? v : Infinity; })();
const FORCE = has('--force');
const DRY = has('--dry-run');
const PROBE = has('--probe');

const FILE = `data/preseason-${SEASON}.json`;
if (!existsSync(FILE)) { console.log(`プレシーズンデータが見つかりません: ${FILE}`); process.exit(0); }
const data = JSON.parse(readFileSync(FILE, 'utf8'));
const matches = data.matches || [];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// 汎用的すぎて識別に使えない語（クラブ接頭辞・接尾辞・つなぎ語）
const STOP = new Set(['fc','cf','afc','sc','ac','as','rc','rcd','ud','us','ss','ssc','cd','de','del','the','of','and','vfl','vfb','rb','tsg','1','05','04','1899','1846','1904','1900','city','club','calcio','and','hove','albion']);
// slug から識別トークンを取り出す（例: brighton-and-hove-albion -> [brighton], manchester-united -> [manchester, united]）
function tokensOf(slug) {
  const raw = String(slug || '').split('-').map(norm).filter(Boolean);
  let toks = raw.filter(t => t.length >= 3 && !STOP.has(t));
  // manchester united/city のように識別に city/united が要る場合は残す
  if (raw.includes('united')) toks.push('united');
  if (raw.includes('city')) toks.push('city');
  if (!toks.length) toks = raw; // 全部STOPなら生トークン
  return [...new Set(toks)];
}
// 表示名（英語名のとき検索語に足すと精度が上がる）
const isAscii = s => /^[\x00-\x7f]+$/.test(s || '');
const HLWORDS = ['highlights', 'highlight', 'ハイライト', 'resumen', 'resume', 'extended', 'friendly', 'friendlies', 'pre-season', 'preseason', 'amichevole', 'amichevoli', 'pretemporada', 'testspiel', 'freundschaft', 'pre-epoca', 'pré-época', 'pre-temporada'];
// 別大会・別競技・非公式など「その親善試合ではない」動画を弾く保険（これに当たれば不採用）。
//   - 公式リーグ/カップ戦（J1/J2/ルヴァン/コパ/コッパ/ポカール/カラバオ/節番号 等）は夏の親善試合ではない
//   - サッカー以外（ハンドボール/バスケ/フットサル 等）や、非公式ライブ配信/リアクション/切り抜き
const PRESEASON_NEG = /\bj[123]\s*league\b|j\.?league.*(highlights|league)|levain|ルヴァン|league cup|carabao|coupe\s+de|copa\s+del|coppa\s+italia|dfb.?pokal|supercopa|community shield|campeonato nacional|\bmw\s?\d|\bmd\s?\d|matchday|jornada\s?\d|giornata|andebol|handball|balonmano|baloncesto|basket|futsal|voleibol|\bwatchalong\b|\breaction\b|live\s?score|live\s?stream|full\s?match|\bfifa\b|\befootball\b|\bfc\s?mobile\b/i;
// 今夏(2026)より前の年・シーズン表記があれば別試合とみなす（2026/2027・26/27 は許可）。
const OLD_YEAR = /\b20(0\d|1\d|2[0-5])\b|\b(0\d|1\d|2[0-5])\s*[\/-]\s*(0\d|1\d|2[0-6])\b/;

async function searchIds(query) {
  try {
    const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36', 'accept-language': 'en' } });
    if (!r.ok) return [];
    const html = await r.text(); const seg = html.slice(Math.max(0, html.indexOf('ytInitialData')));
    const ids = []; const seen = new Set();
    for (const m of seg.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) { if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); } if (ids.length >= 20) break; }
    return ids;
  } catch { return []; }
}
async function oembed(id) {
  try { const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`); if (!r.ok) return null; const j = await r.json(); return { title: j.title || '', author: j.author_name || '' }; } catch { return null; }
}
const YT_KEY = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';
async function playerProbe(id) {
  try {
    const body = { videoId: id, context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'ja', gl: 'JP', userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip' } } };
    const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${YT_KEY}&prettyPrint=false`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip', 'x-goog-api-format-version': '2' }, body: JSON.stringify(body) });
    if (!r.ok) return { status: `HTTP_${r.status}`, jp: null };
    const j = await r.json(); const ps = j.playabilityStatus || {};
    const mf = (j.microformat && j.microformat.playerMicroformatRenderer) || {};
    const countries = Array.isArray(mf.availableCountries) ? mf.availableCountries : null;
    const jp = countries ? countries.includes('JP') : (ps.status === 'OK' ? true : ps.status === 'UNPLAYABLE' ? false : null);
    return { status: ps.status || '不明', jp };
  } catch (e) { return { status: 'ERR', jp: null }; }
}

function scoreCandidate(title, author, homeToks, awayToks) {
  const t = norm(title);
  if (/#short|\bshorts\b/.test(t)) return { score: -1 };
  if (t.length < 8) return { score: -1 };
  if (PRESEASON_NEG.test(t)) return { score: -1 };   // 別大会・別競技・非公式など
  if (OLD_YEAR.test(t)) return { score: -1 };         // 今夏より前の年/シーズン表記
  const homeHit = homeToks.some(tok => t.includes(tok));
  const awayHit = awayToks.some(tok => t.includes(tok));
  if (!(homeHit && awayHit)) return { score: 0, homeHit, awayHit };  // 両チーム名が要る
  let score = 5;
  if (HLWORDS.some(w => t.includes(w))) score += 2;
  const a = norm(author);
  if ([...homeToks, ...awayToks].some(tok => a.includes(tok))) score += 1;  // 公式クラブchらしい
  if (/official|fc|club/.test(a)) score += 1;
  // 「vs」区切りで両チームが並ぶ形はより確度が高い
  if (/\bvs\b|\bv\b|-/.test(t)) score += 1;
  return { score, homeHit, awayHit };
}

const report = [];
let filled = 0, scanned = 0;
for (const mt of matches) {
  if (scanned >= LIMIT) break;
  if (!mt.finished) continue;                 // 未終了は対象外
  if (mt.videoId && !FORCE) continue;          // 既に付与済みはスキップ
  scanned++;
  const homeToks = tokensOf(mt.homeSlug);
  const awayToks = tokensOf(mt.awaySlug);
  // 検索語: slug由来の英語名 + 表示名(英語のとき) + highlights
  const homeEn = String(mt.homeSlug || '').replace(/-/g, ' ');
  const awayEn = String(mt.awaySlug || '').replace(/-/g, ' ');
  const extra = [mt.home, mt.away].filter(isAscii).join(' ');
  const query = `${homeEn} ${awayEn} ${extra} highlights`.replace(/\s+/g, ' ').trim();

  const ids = await searchIds(query); await sleep(300);
  let best = null;
  for (const id of ids) {
    const meta = await oembed(id); await sleep(140);
    if (!meta) continue;
    const s = scoreCandidate(meta.title, meta.author, homeToks, awayToks);
    if (s.score >= 6 && (!best || s.score > best.score)) best = { id, title: meta.title, author: meta.author, score: s.score };
  }
  const row = { date: (mt.dateUTC || '').slice(0, 10), home: mt.home, away: mt.away, query };
  if (best) {
    let probe = null;
    if (PROBE) { probe = await playerProbe(best.id); await sleep(200); }
    if (!DRY) mt.videoId = best.id;
    filled++;
    row.videoId = best.id; row.title = best.title; row.channel = best.author; row.score = best.score;
    if (probe) row.jp = probe.jp === null ? '不明' : probe.jp ? '○' : '×', row.playable = probe.status;
    console.log(`✅ ${row.date}  ${mt.home} vs ${mt.away}\n    → ${best.id} [${best.author}] ${best.title}${probe ? `  (JP=${row.jp}/${probe.status})` : ''}`);
  } else {
    // --force 再探索で、既に付いていた動画が新ゲートを通らない場合は空に戻す（誤マッチの掃除）。
    const cleared = FORCE && mt.videoId;
    if (!DRY && FORCE) mt.videoId = '';
    row.videoId = ''; row.note = (ids.length ? '該当なし（両チーム名一致の公開動画が見つからず）' : '検索結果ゼロ') + (cleared ? '／既存の誤マッチを解除' : '');
    console.log(`— ${row.date}  ${mt.home} vs ${mt.away}  … 見送り（${row.note}）`);
  }
  report.push(row);
}

console.log(`\n対象 ${scanned} 試合 / 動画付与 ${filled} 件${DRY ? '（dry-run：JSON未更新）' : ''}`);
if (!DRY && filled) {
  writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`更新: ${FILE}`);
}
writeFileSync(`data/preseason-video-report.json`, JSON.stringify({ generatedFor: SEASON, scanned, filled, rows: report }, null, 2) + '\n');
console.log(`レポート: data/preseason-video-report.json`);
