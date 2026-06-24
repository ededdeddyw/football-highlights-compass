// W杯ハイライト検知（YouTube RSS・APIキー不要・依存追加なし）
// 使い方: node scripts/watch-highlights.mjs [--dry-run]
//  - data/watch-config.json の enabled=false なら即終了（kill switch）
//  - 検知窓内の試合だけを対象に、許可チャンネルのRSSを取得し厳格マッチング
//  - 確定 → data/wc2026-detected.json に追記 / 曖昧 → data/wc-detect-candidates.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DRY = process.argv.includes('--dry-run');
const readJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };

const cfg = readJson('data/watch-config.json', {});
if (!cfg.enabled) { console.log('watch: 無効（watch-config.enabled=false）。終了。'); process.exit(0); }

const schedule = readJson('data/wc2026-schedule.json', { matches: [] }).matches.filter(m => m.matchId !== 'wc2026-example');
const TEAMS = readJson('data/team-names.json', {});
const channels = (readJson('data/wc2026-channels.json', { channels: [] }).channels || []).filter(c => c.enabled && c.channelId);
const detectedFile = readJson('data/wc2026-detected.json', { detected: [] });
const candFile = readJson('data/wc-detect-candidates.json', { candidates: [] });

// 既出ID（重複排除）：index.html の全 id:"..." ＋ detected
const idxHtml = existsSync('site/index.html') ? readFileSync('site/index.html', 'utf8') : '';
const knownIds = new Set([
  ...[...idxHtml.matchAll(/id:"([A-Za-z0-9_-]{6,})"/g)].map(m => m[1]),
  ...detectedFile.detected.map(d => d.videoId)
]);

const now = Date.now();
const MS = 60000;
const durMin = cfg.matchDurationMin ?? 115;
const win = cfg.detectWindow ?? { startOffsetMin: 45, endOffsetMin: 210 };
const minScore = cfg.minScore ?? 5;

// 検知窓内の試合
const windowMatches = schedule.filter(m => {
  if (m.status === 'highlighted') return false;
  if (!m.home?.ja || !m.away?.ja || m.away?.placeholder) return false;   // 対戦未定はスキップ
  const ko = Date.parse(m.koUTC || m.dateLocal);
  if (isNaN(ko)) return false;
  const end = ko + durMin * MS;
  return now >= end + win.startOffsetMin * MS && now <= end + win.endOffsetMin * MS;
});
if (!windowMatches.length) { console.log('watch: 検知窓内の試合なし。終了。'); process.exit(0); }

const norm = s => (s || '').toLowerCase().replace(/\s+/g, '');
function variants(side) {
  const t = TEAMS[side.ja] || {};
  return [side.ja, side.en, t.en].filter(Boolean).map(norm);   // 国名フル（altコードは誤検知防止のため必須判定に使わない）
}
const TOURN = ['world cup', 'ワールドカップ', 'fifa', 'worldcup'];
const HLWORD = ['ハイライト', 'highlights', 'highlight', 'recap', 'extended'];

// RSS取得＆パース
async function fetchEntries(ch) {
  try {
    const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channelId}`, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(e => {
      const blk = e[1];
      const vid = (blk.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
      const title = (blk.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
      const pub = (blk.match(/<published>([^<]+)<\/published>/) || [])[1];
      return { vid, title: title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"), pub: Date.parse(pub), channel: ch };
    }).filter(x => x.vid);
  } catch (e) { console.warn(`RSS失敗 ${ch.name}: ${e.message}`); return []; }
}

const allEntries = (await Promise.all(channels.map(fetchEntries))).flat();
const confirmed = [], candidates = [];

for (const m of windowMatches) {
  const ko = Date.parse(m.koUTC || m.dateLocal), end = ko + durMin * MS;
  const wStart = end + win.startOffsetMin * MS, wEnd = end + win.endOffsetMin * MS;
  const hv = variants(m.home), av = variants(m.away);
  let best = null;
  for (const e of allEntries) {
    if (knownIds.has(e.vid)) continue;
    const t = norm(e.title);
    const homeHit = hv.some(v => v && t.includes(v));
    const awayHit = av.some(v => v && t.includes(v));
    if (!homeHit || !awayHit) continue;                    // 両チーム名は必須
    const inWindow = e.pub >= wStart && e.pub <= wEnd;      // 公開時刻が窓内（必須）
    const lt = e.title.toLowerCase();
    const tourn = TOURN.some(w => lt.includes(w));
    const hl = HLWORD.some(w => lt.includes(w));
    let score = 4 + (inWindow ? 2 : 0) + (tourn ? 2 : 0) + (hl ? 2 : 0);
    score *= (e.channel.weight ?? 1);
    const rec = { matchId: m.matchId, videoId: e.vid, title: e.title, channel: e.channel.name, channelId: e.channel.channelId, publishedUTC: e.pub ? new Date(e.pub).toISOString() : null, score: +score.toFixed(1), reasons: { homeHit, awayHit, inWindow, tourn, hl } };
    if (!inWindow) { candidates.push({ ...rec, why: 'published_outside_window' }); continue; }
    if (score >= minScore) { if (!best || score > best.score) best = rec; }
    else candidates.push({ ...rec, why: 'below_threshold' });
  }
  if (best) confirmed.push({ ...best, detectedAt: new Date(now).toISOString() });
}

console.log(`watch: 窓内 ${windowMatches.length}試合 / RSS ${allEntries.length}本 → 確定 ${confirmed.length} / 候補 ${candidates.length}`);
confirmed.forEach(c => console.log(`  ✓ [${c.matchId}] ${c.videoId} score=${c.score}  ${c.title}`));
candidates.forEach(c => console.log(`  ? [${c.matchId}] ${c.videoId} score=${c.score} (${c.why})  ${c.title}`));

if (DRY) { console.log('watch: --dry-run のため書き込みなし。'); process.exit(0); }

if (confirmed.length) {
  detectedFile.detected.push(...confirmed);
  writeFileSync('data/wc2026-detected.json', JSON.stringify(detectedFile, null, 2) + '\n');
  // schedule の status/videoId を更新
  for (const c of confirmed) { const s = schedule.find(x => x.matchId === c.matchId); if (s) { s.status = 'highlighted'; s.videoId = c.videoId; } }
  const sched = readJson('data/wc2026-schedule.json', {});
  sched.matches = sched.matches.map(m => { const c = confirmed.find(x => x.matchId === m.matchId); return c ? { ...m, status: 'highlighted', videoId: c.videoId } : m; });
  writeFileSync('data/wc2026-schedule.json', JSON.stringify(sched, null, 2) + '\n');
}
if (candidates.length) { candFile.candidates.push(...candidates.map(c => ({ ...c, loggedAt: new Date(now).toISOString() }))); writeFileSync('data/wc-detect-candidates.json', JSON.stringify(candFile, null, 2) + '\n'); }
