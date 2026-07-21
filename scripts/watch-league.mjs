// 五大リーグの公式ハイライトを YouTube から自動検知して data/league-<code>-<season>.json の videoId を埋める。
// 使い方: node scripts/watch-league.mjs [--code=sa] [--limit=20] [--diag] [--dry-run]
//  - 対象: 結果確定済み・videoId未設定の試合。
//  - 照合はリーグごとに形式が違うため LEAGUE 設定で切り替える（診断 diag-league-video で実タイトルを確認して調整）。
//    * bl（ブンデス）: 公式ch「Bundesliga」＋両チーム名＋"highlights"＋節(Matchday N)＋スコア非表示。
//    * sa/laliga/ligue1: 公式chはタイトルに節番号が無く、必ずスコアが入る（例 "SASSUOLO-NAPOLI 0-2 | HIGHLIGHTS"）。
//      → 節ゲートの代わりに「ホーム→アウェイの登場順」で往路/復路を判別。スコアは許可（ページ側は既定で隠す=ネタバレ防止）。
//      → ラ・リーガは "RESUMEN"、リーグアン公式は仏語見出しなので keyword を緩める/外す。
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const DIAG = args.includes('--diag') || process.env.WATCH_DIAG === '1';
const CODE = (args.find(a => a.startsWith('--code=')) || '').split('=')[1] || '';
const LIMIT = (() => { const v = +((args.find(a => a.startsWith('--limit=')) || '').split('=')[1]); return Number.isFinite(v) && v > 0 ? v : 30; })();
const readJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ALIASES = readJson('data/league-team-aliases.json', {});

// リーグごとの照合設定。channels は公式チャンネル名（正規化して厳密一致）。
//  kw: タイトルに要求するキーワード（null なら要求しない）。matchday: 節番号ゲートを使うか。
//  order: ホーム→アウェイの登場順で判定するか。allowScore: スコア入りタイトルを許可するか。
// league: タイトルにこのリーグ名が入っていることを必須化（同じ公式chが出すカップ戦=コッパ/コパ/クープ等を除外）。
const LEAGUE = {
  bl:     { q: 'Bundesliga',     channels: ['Bundesliga'],                                              kw: /highlights|ハイライト/i,          league: /bundesliga/i,     matchday: true,  order: false, allowScore: false },
  pl:     { q: 'Premier League', channels: ['Premier League'],                                          kw: /highlights|ハイライト/i,          league: /premier\s*league/i, matchday: true,  order: true,  allowScore: false },
  sa:     { q: 'Serie A',        channels: ['Serie A', 'Lega Serie A'],                                 kw: /highlights|ハイライト/i,          league: /serie\s*a/i,      matchday: false, order: true,  allowScore: true },
  laliga: { q: 'LaLiga',         channels: ['LALIGA EA SPORTS', 'LaLiga', 'LALIGA'],                    kw: /highlights|ハイライト|resumen/i,  league: /la\s*liga/i,      matchday: false, order: true,  allowScore: true },
  ligue1: { q: 'Ligue 1',        channels: ["Ligue 1 McDonald's", 'Ligue 1 McDonald’s', 'Ligue 1'],    kw: null,                              league: /ligue\s*1/i,      matchday: false, order: true,  allowScore: true },
};

// コンパイル/まとめ動画を弾く保険（公式chでもシーズン総集編・週間まとめ等がある）。
const NEG = /top\s*\d|best .*goals|goals of the|all goals|every goal|\bskills\b|preview|line-?ups?\b|simulation|predict|\bsquad|how old|efootball|fc mobile|\bshorts\b|\bpics\b|week\s*\d|results\s*&|round-?up|season review|best of/i;

// シーズン取り違え防止：同じ対戦は毎年あるため、別シーズン表記があれば弾く（現行=2025/26）。
const CUR_SEASON = /(2025\s*[\/-]\s*26|(^|\D)25\s*[\/-]\s*26(\D|$))/;
const OTHER_SEASON = /(20(1\d|2[0-4]|2[6-9])\s*[\/-]\s*\d{2})|((^|\D)(1\d|2[0-4]|2[6-9])\s*[\/-]\s*\d{2}(\D|$))/;

// アクセント除去＋小文字化。タイトルはアクセント無し表記が多い（Atlético→atletico）ので両側で畳む。
const fold = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const norm = s => fold(s).toLowerCase();
const nsp = s => norm(s).replace(/\s+/g, '');
// 別名（2文字の愛称 OM/OL 等は誤爆するので3文字以上のみ採用）
const variants = ja => (ALIASES[ja] || [ja]).map(nsp).filter(v => v.length >= 3);
const firstAlias = ja => (ALIASES[ja] || [ja])[0];
const nameHit = (ja, titleNsp) => variants(ja).some(v => titleNsp.includes(v));
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// ホーム→アウェイの「隣接」判定：<home>〔スコア/記号〕<away> が近接して現れるか（先頭の編集見出しに騙されないため）。
// 例: "sassuolo-napoli0-2" / "villarrealcf2-0realoviedo" は home→away 隣接、"bologna-roma"（Romaがhome指定でも）は不一致。
const orderAdjacent = (home, away, titleNsp) => {
  const hAlt = variants(home).map(reEsc).join('|'), aAlt = variants(away).map(reEsc).join('|');
  if (!hAlt || !aAlt) return false;
  return new RegExp(`(?:${hAlt}).{0,12}(?:${aAlt})`).test(titleNsp);
};

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

const files = readdirSync('data').filter(n => /^league-([a-z0-9]+)-\d{4}\.json$/.test(n)).filter(n => !CODE || n.startsWith(`league-${CODE}-`));
let searched = 0, confirmedTotal = 0;

for (const f of files) {
  const path = `data/${f}`;
  const data = readJson(path, null); if (!data || !Array.isArray(data.matches)) continue;
  const code = data.code; const cfg = LEAGUE[code];
  if (!cfg) { console.log(`  [skip] ${code}: 照合設定なし`); continue; }
  const channelsN = cfg.channels.map(c => c.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const chOk = author => channelsN.includes((author || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const known = new Set(data.matches.map(m => m.videoId).filter(Boolean));
  const confirmed = [];
  for (const m of data.matches) {
    if (m.videoId || !m.finished || m.matchday == null) continue;
    if (confirmed.length >= LIMIT) break;
    if (searched++) await sleep(800);
    const mdRe = new RegExp('matchday\\s*0*' + m.matchday + '(?!\\d)', 'i');
    const ids = await searchIds(`${firstAlias(m.home)} ${firstAlias(m.away)} ${cfg.q} highlights${cfg.matchday ? ' matchday ' + m.matchday : ''}`);
    let hit = null; const rejects = [];
    for (const id of ids) {
      if (known.has(id)) { rejects.push(`既出 ${id}`); continue; }
      const mt = await meta(id); await sleep(120);
      if (!mt) { rejects.push(`meta失敗 ${id}`); continue; }
      const tN = nsp(mt.title);
      const gate = !chOk(mt.author) ? `非公式ch(${mt.author})`
        : !nameHit(m.home, tN) ? 'homeなし'
        : !nameHit(m.away, tN) ? 'awayなし'
        : (cfg.order && !orderAdjacent(m.home, m.away, tN)) ? 'ホーム→アウェイ隣接なし（別レグ/編集見出し）'
        : (cfg.kw && !cfg.kw.test(mt.title)) ? 'キーワード無し'
        : (cfg.league && !cfg.league.test(mt.title)) ? '別大会（リーグ名なし）'
        : (cfg.matchday && !mdRe.test(mt.title)) ? `節不一致(md${m.matchday})`
        : (!cfg.allowScore && /\d+\s*[-–—]\s*\d+/.test(mt.title)) ? 'スコア入り(ネタバレ)'
        : (OTHER_SEASON.test(mt.title) && !CUR_SEASON.test(mt.title)) ? '別シーズン'
        : NEG.test(mt.title) ? 'まとめ/総集編'
        : 'OK';
      if (gate !== 'OK') { rejects.push(`✗ ${gate} | ${mt.author} | ${mt.title}`); continue; }
      hit = { id, title: mt.title, author: mt.author }; break;
    }
    if (hit) {
      m.videoId = hit.id; known.add(hit.id); confirmed.push({ home: m.home, away: m.away, md: m.matchday, ...hit });
      if (!DRY && confirmed.length % 8 === 0) writeFileSync(path, JSON.stringify(data, null, 2) + '\n');   // 途中保存：タイムアウトで打ち切られても進捗を残す（次回は videoId 済みをスキップして再開）
    }
    else if (DIAG) { console.log(`  [診断] ${code} md${m.matchday} ${m.home} vs ${m.away}: 候補${ids.length}件・不採用`); rejects.slice(0, 6).forEach(r => console.log('      ' + r)); }
  }
  confirmedTotal += confirmed.length;
  console.log(`${code}: 確定 ${confirmed.length}件`);
  confirmed.forEach(c => console.log(`  ✓ md${c.md} ${c.home} vs ${c.away} → ${c.id}  [${c.author}] ${c.title}`));
  if (!DRY && confirmed.length) writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}
console.log(`watch-league: 合計確定 ${confirmedTotal}件${DRY ? '（--dry-run 書き込みなし）' : ''}`);
