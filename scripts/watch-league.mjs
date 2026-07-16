// 五大リーグの公式ハイライトを YouTube から自動検知して data/league-<code>-<season>.json の videoId を埋める。
// 使い方: node scripts/watch-league.mjs [--code=bl] [--limit=20] [--diag] [--dry-run]
//  - 対象: 結果確定済み・videoId未設定の試合。
//  - 照合: 公式チャンネル（例 Bundesliga）＋ 両チーム名（別名表）＋ "highlights" ＋ その節(Matchday N) ＋ スコア非表示。
//    節でホーム/アウェイの2試合（往路/復路）を取り違えないようにする。
//  - スコアがタイトルに入る動画は不採用（プレイヤー内ネタバレ防止）。表示はページ側のマスクもあるが二重に安全側。
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const DIAG = args.includes('--diag') || process.env.WATCH_DIAG === '1';
const CODE = (args.find(a => a.startsWith('--code=')) || '').split('=')[1] || '';
const LIMIT = (() => { const v = +((args.find(a => a.startsWith('--limit=')) || '').split('=')[1]); return Number.isFinite(v) && v > 0 ? v : 30; })();
const readJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ALIASES = readJson('data/league-team-aliases.json', {});
// リーグごとの公式チャンネル（author_name 一致で許可）。まずはブンデス。
const CHANNELS = { bl: ['Bundesliga'], pl: ['Premier League'], sa: ['Serie A', 'Lega Serie A'], laliga: ['LaLiga'], ligue1: ['Ligue 1', 'Ligue1 UberEats'] };
const LEAGUE_Q = { bl: 'Bundesliga', pl: 'Premier League', sa: 'Serie A', laliga: 'LaLiga', ligue1: 'Ligue 1' };

const norm = s => (s || '').toLowerCase();
const nsp = s => norm(s).replace(/\s+/g, '');
const variants = ja => (ALIASES[ja] || [ja]).map(nsp);
const nameHit = (ja, titleNsp) => variants(ja).some(v => v && titleNsp.includes(v));

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
async function meta(id) {
  try { const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`); if (!r.ok) return null; const j = await r.json(); return { title: j.title || '', author: j.author_name || '' }; } catch { return null; }
}

const files = readdirSync('data').filter(n => /^league-([a-z]+)-\d{4}\.json$/.test(n)).filter(n => !CODE || n.startsWith(`league-${CODE}-`));
let searched = 0, confirmedTotal = 0;

for (const f of files) {
  const path = `data/${f}`;
  const data = readJson(path, null); if (!data || !Array.isArray(data.matches)) continue;
  const code = data.code; const allow = CHANNELS[code] || []; const lq = LEAGUE_Q[code] || '';
  if (!allow.length) { console.log(`  [skip] ${code}: 公式チャンネル未設定`); continue; }
  // 既出id（重複防止）
  const known = new Set(data.matches.map(m => m.videoId).filter(Boolean));
  const confirmed = [];
  for (const m of data.matches) {
    if (m.videoId || !m.finished || m.matchday == null) continue;
    if (confirmed.length >= LIMIT) break;
    if (searched++) await sleep(800);
    const mdRe = new RegExp('matchday\\s*0*' + m.matchday + '(?!\\d)', 'i');
    const ids = await searchIds(`${(ALIASES[m.home] || [m.home])[0]} ${(ALIASES[m.away] || [m.away])[0]} ${lq} highlights matchday ${m.matchday}`);
    let hit = null; const rejects = [];
    for (const id of ids) {
      if (known.has(id)) { rejects.push(`既出 ${id}`); continue; }
      const mt = await meta(id); await sleep(120);
      if (!mt) { rejects.push(`meta失敗 ${id}`); continue; }
      const tN = nsp(mt.title);
      const gate = !allow.includes(mt.author) ? `非公式ch(${mt.author})`
        : !nameHit(m.home, tN) ? 'homeなし'
        : !nameHit(m.away, tN) ? 'awayなし'
        : !/highlights|ハイライト/i.test(mt.title) ? 'highlights語なし'
        : !mdRe.test(mt.title) ? `節不一致(md${m.matchday})`
        : /\d+\s*[-–—]\s*\d+/.test(mt.title) ? 'スコア入り(ネタバレ)'
        : 'OK';
      if (gate !== 'OK') { rejects.push(`✗ ${gate} | ${mt.author} | ${mt.title}`); continue; }
      hit = { id, title: mt.title, author: mt.author }; break;
    }
    if (hit) { m.videoId = hit.id; known.add(hit.id); confirmed.push({ home: m.home, away: m.away, md: m.matchday, ...hit }); }
    else if (DIAG) { console.log(`  [診断] ${code} md${m.matchday} ${m.home} vs ${m.away}: 候補${ids.length}件・不採用`); rejects.slice(0, 5).forEach(r => console.log('      ' + r)); }
  }
  confirmedTotal += confirmed.length;
  console.log(`${code}: 確定 ${confirmed.length}件`);
  confirmed.forEach(c => console.log(`  ✓ md${c.md} ${c.home} vs ${c.away} → ${c.id}  [${c.author}] ${c.title}`));
  if (!DRY && confirmed.length) writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}
console.log(`watch-league: 合計確定 ${confirmedTotal}件${DRY ? '（--dry-run 書き込みなし）' : ''}`);
