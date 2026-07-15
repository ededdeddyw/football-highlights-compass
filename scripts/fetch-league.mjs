// 五大リーグの日程・結果を取得して data/league-<code>-<season>.json に正規化保存する。
//  - bl（ブンデス）: OpenLigaDB（無料・キー不要）
//  - pl/sa/laliga/ligue1: TheSportsDB（無料・公開テストキー"3"・キー登録不要）
// 使い方: node scripts/fetch-league.mjs <code> <seasonStartYear>   例: node scripts/fetch-league.mjs pl 2025
// 出力: data/league-<code>-<season>.json … [{matchday, dateUTC, home, away, finished, score, videoId}]
//   - home/away は data/league-teams.json（原名→日本語）で日本語化（未登録は原名のまま＋警告ログ）。
//   - score は完了試合のみ "H-A"。videoId は空（後段 watch が公式ハイライトを紐付け）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [,, codeArg, seasonArg] = process.argv;
const CODE = (codeArg || 'bl').toLowerCase();
const SEASON = seasonArg || '2025';
const readJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };

const LEAGUES = {
  bl:     { jp: 'ブンデスリーガ', src: 'openliga', openliga: 'bl1' },
  pl:     { jp: 'プレミアリーグ', src: 'sportsdb', sdb: '4328' },
  sa:     { jp: 'セリエA',       src: 'sportsdb', sdb: '4332' },
  laliga: { jp: 'ラ・リーガ',     src: 'sportsdb', sdb: '4335' },
  ligue1: { jp: 'リーグアン',     src: 'sportsdb', sdb: '4334' },
};
const L = LEAGUES[CODE];
if (!L) { console.error(`未対応リーグ: ${CODE}（対応: ${Object.keys(LEAGUES).join(', ')}）`); process.exit(1); }

const TEAMS = readJson('data/league-teams.json', {});
const unknown = new Set();
const ja = name => { const v = TEAMS[name]; if (!v) unknown.add(name); return v || name; };
const num = v => (v === null || v === undefined || v === '') ? null : Number(v);
// 英語原名から安定したASCIIスラッグを作る（URL固定用）。日本語名の対応が未整備でもURLは変わらない。
const slugify = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

async function fetchOpenLiga() {
  const r = await fetch(`https://api.openligadb.de/getmatchdata/${L.openliga}/${SEASON}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`OpenLigaDB HTTP ${r.status}`);
  const arr = await r.json();
  return arr.map(m => {
    const finished = !!m.matchIsFinished;
    let score = '';
    if (finished) { const rs = Array.isArray(m.matchResults) ? m.matchResults : []; const f = rs.find(x => x.resultTypeID === 2) || rs[rs.length - 1]; if (f && f.pointsTeam1 != null && f.pointsTeam2 != null) score = `${f.pointsTeam1}-${f.pointsTeam2}`; }
    return { matchday: m.group?.groupOrderID ?? null, dateUTC: m.matchDateTimeUTC || m.matchDateTime || '', home: ja(m.team1?.teamName || ''), away: ja(m.team2?.teamName || ''), finished, score, videoId: '' };
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchSportsDB() {
  // 無料公開キーの eventsseason は件数が絞られる（1リーグ5件など）。ラウンド別 eventsround を1節ずつ回して全試合を集める。
  const season = `${SEASON}-${+SEASON + 1}`;
  const events = [];
  let emptyStreak = 0;
  for (let round = 1; round <= 46; round++) {
    let evs = null;
    for (let attempt = 1; attempt <= 4 && evs === null; attempt++) {
      try {
        const r = await fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsround.php?id=${L.sdb}&r=${round}&s=${season}`, { headers: { accept: 'application/json' } });
        if (r.ok) { const j = await r.json(); evs = j.events || []; }
        else if (r.status === 429) { await sleep(3000); }
        else evs = [];
      } catch { await sleep(1500); }
    }
    if (evs === null) evs = [];
    if (!evs.length) { emptyStreak++; if (emptyStreak >= 3 && round > 5) break; await sleep(400); continue; }   // 連続3節空で終了（節数はリーグで異なる／一時的な空を許容）
    emptyStreak = 0; events.push(...evs);
    await sleep(350);   // 無料枠のレート制限回避
  }
  if (!events.length) throw new Error('TheSportsDB: events空（IDやシーズン表記を確認）');
  return events.map(e => {
    const hs = num(e.intHomeScore), as = num(e.intAwayScore);
    const finished = /finished/i.test(e.strStatus || '') || (hs !== null && as !== null);
    return { matchday: num(e.intRound), dateUTC: e.strTimestamp || (e.dateEvent ? e.dateEvent + 'T00:00:00Z' : ''), home: ja(e.strHomeTeam || ''), away: ja(e.strAwayTeam || ''), homeSlug: slugify(e.strHomeTeam), awaySlug: slugify(e.strAwayTeam), finished, score: (finished && hs !== null && as !== null) ? `${hs}-${as}` : '', videoId: '' };
  });
}

let out = L.src === 'openliga' ? await fetchOpenLiga() : await fetchSportsDB();
out = out.filter(m => m.matchday != null && m.home && m.away)
         .sort((a, b) => (a.matchday - b.matchday) || String(a.dateUTC).localeCompare(String(b.dateUTC)));

const OUT = `data/league-${CODE}-${SEASON}.json`;
writeFileSync(OUT, JSON.stringify({ code: CODE, jp: L.jp, season: SEASON, updated: '', matches: out }, null, 2) + '\n');
const fin = out.filter(m => m.finished).length;
console.log(`fetch-league ${CODE} ${SEASON}: ${out.length}試合（完了 ${fin} / 未消化 ${out.length - fin}）→ ${OUT}`);
if (unknown.size) { console.log(`⚠ 日本語名 未登録 ${unknown.size}件（data/league-teams.json に追記）:`); [...unknown].forEach(t => console.log(`    "${t}": "",`)); }
