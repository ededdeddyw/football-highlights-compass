// 過去シーズンの歴代データ（最終順位表・得点王・全試合結果）を API-Football(api-sports.io v3) から取得し
// data/history-<code>-<season>.json に保存する。要 APIFOOTBALL_KEY（GitHub Secrets）。
//   使い方: node scripts/fetch-history.mjs --season=2023 [--code=pl] [--no-results]
//   - 無料プランは過去シーズンのみ対応（現行シーズンは football-data 経路を使用）。取得0件ならプラン制限。
//   - 1シーズンあたり: standings 1req + topscorers 1req + fixtures 1req ＝ 最大3req/リーグ（100req/日で十分）。
//   - 結果(results)のスコアは「歴代記録」として保存。現行動画のネタバレ防止とは別概念（過去の確定記録）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEY = process.env.APIFOOTBALL_KEY || '';
if (!KEY) { console.error('❌ APIFOOTBALL_KEY が未設定です（GitHub Secrets に登録してください）。'); process.exit(1); }

const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';
const has = k => process.argv.includes(`--${k}`);
const SEASON = arg('season');
if (!/^\d{4}$/.test(SEASON)) { console.error('❌ --season=YYYY（4桁）で指定してください。例: --season=2023'); process.exit(1); }
const ONLY = arg('code');
const NO_RESULTS = has('no-results');
const BASE = 'https://v3.football.api-sports.io';
// API-Football のリーグID（固定）。cl/el は欧州カップ戦（グループ or リーグフェーズ＋ノックアウト）。
const LEAGUES = { pl: 39, laliga: 140, sa: 135, bl: 78, ligue1: 61, cl: 2, el: 3 };

const readJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };
const TEAMS = readJson('data/league-teams.json', {});
const jaTeam = en => TEAMS[en] || en;   // 英語→日本語（辞書にあれば）。無ければ英語のまま。
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path) {
  const r = await fetch(BASE + path, { headers: { 'x-apisports-key': KEY, accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  const errs = j && j.errors;
  const hasErr = errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length);
  if (hasErr) console.error('  ⚠ API errors:', JSON.stringify(errs));
  return j || {};
}

const rowOf = r => ({
  rank: r.rank,
  team: jaTeam((r.team && r.team.name) || ''),
  played: (r.all && r.all.played) ?? null,
  win: (r.all && r.all.win) ?? null,
  draw: (r.all && r.all.draw) ?? null,
  lose: (r.all && r.all.lose) ?? null,
  gf: (r.all && r.all.goals && r.all.goals.for) ?? null,
  ga: (r.all && r.all.goals && r.all.goals.against) ?? null,
  gd: r.goalsDiff ?? null,
  points: r.points ?? null,
});
// 順位表を「グループの配列」で返す（国内リーグ=1グループ、CL/EL旧方式=複数グループ、新リーグフェーズ=1グループ）。
function normStandings(j) {
  const resp = (j.response && j.response[0]) || null;
  const groups = resp && resp.league && resp.league.standings;
  if (!Array.isArray(groups)) return [];
  return groups.filter(g => Array.isArray(g) && g.length).map(g => ({
    group: (g[0] && g[0].group) || '',
    rows: g.map(rowOf),
  }));
}
// CL/EL の優勝は順位表トップではなく「決勝(Final)の勝者」。決勝が無ければ（国内リーグ）1グループ首位を優勝とする。
function findChampion(fixturesJson, standings) {
  const arr = Array.isArray(fixturesJson.response) ? fixturesJson.response : [];
  const finals = arr.filter(e => {
    const rd = String((e.league && e.league.round) || '');
    return /final/i.test(rd) && !/semi|quarter|1\/|round/i.test(rd) && e.fixture && e.fixture.status && ['FT', 'AET', 'PEN'].includes(e.fixture.status.short);
  });
  if (finals.length) {
    // 複数（2レグ）の場合は最後の試合を採用。winnerフラグ優先、無ければスコアで判定。
    const f = finals[finals.length - 1];
    const ht = f.teams && f.teams.home, at = f.teams && f.teams.away;
    if (ht && at) {
      if (ht.winner === true) return jaTeam(ht.name || '');
      if (at.winner === true) return jaTeam(at.name || '');
      const hg = (f.goals && f.goals.home) ?? 0, ag = (f.goals && f.goals.away) ?? 0;
      if (hg !== ag) return jaTeam((hg > ag ? ht.name : at.name) || '');
    }
  }
  return (standings[0] && standings[0].rows && standings[0].rows[0] && standings[0].rows[0].team) || '';
}
function normScorers(j) {
  const arr = Array.isArray(j.response) ? j.response : [];
  return arr.slice(0, 15).map(e => {
    const st = (e.statistics && e.statistics[0]) || {};
    return {
      name: (e.player && e.player.name) || '',
      team: jaTeam((st.team && st.team.name) || ''),
      goals: (st.goals && st.goals.total) ?? null,
      assists: (st.goals && st.goals.assists) ?? null,
      apps: (st.games && st.games.appearences) ?? null,
    };
  });
}
function normResults(j) {
  const arr = Array.isArray(j.response) ? j.response : [];
  // 終了した試合のみ（FT/AET/PEN）。将来/中止は除外。
  const done = new Set(['FT', 'AET', 'PEN']);
  return arr.filter(e => e.fixture && e.fixture.status && done.has(e.fixture.status.short))
    .map(e => ({
      round: (e.league && e.league.round) || '',
      date: (e.fixture && e.fixture.date ? String(e.fixture.date).slice(0, 10) : ''),
      home: jaTeam((e.teams && e.teams.home && e.teams.home.name) || ''),
      away: jaTeam((e.teams && e.teams.away && e.teams.away.name) || ''),
      hg: (e.goals && e.goals.home) ?? null,
      ag: (e.goals && e.goals.away) ?? null,
    }));
}

let wrote = 0;
for (const [code, id] of Object.entries(LEAGUES)) {
  if (ONLY && code !== ONLY) continue;
  console.log(`== ${code} (league ${id}, season ${SEASON}) ==`);

  const standJ = await get(`/standings?league=${id}&season=${SEASON}`); await sleep(400);
  const standings = normStandings(standJ);
  const scorersJ = await get(`/players/topscorers?league=${id}&season=${SEASON}`); await sleep(400);
  const scorers = normScorers(scorersJ);
  let results = [], fxJ = null;
  if (!NO_RESULTS) { fxJ = await get(`/fixtures?league=${id}&season=${SEASON}`); await sleep(400); results = normResults(fxJ); }

  const groupN = standings.length, rowN = standings.reduce((s, g) => s + (g.rows ? g.rows.length : 0), 0);
  console.log(`  standings=${groupN}グループ(計${rowN}) / scorers=${scorers.length} / results=${results.length}`);
  if (!groupN && !scorers.length && !results.length) {
    console.log('  取得0件（無料プランのシーズン制限 or 未対応の可能性）。保存しない。');
    continue;
  }
  const champion = fxJ ? findChampion(fxJ, standings) : ((standings[0] && standings[0].rows && standings[0].rows[0] && standings[0].rows[0].team) || '');
  const out = {
    code, season: SEASON,
    seasonLabel: `${SEASON}-${String((Number(SEASON) + 1) % 100).padStart(2, '0')}`,
    champion, topScorer: scorers[0] || null,
    standings, scorers, results,
    source: 'API-Football (api-sports.io)', updated: new Date().toISOString(),
  };
  writeFileSync(`data/history-${code}-${SEASON}.json`, JSON.stringify(out, null, 2) + '\n');
  wrote++;
  console.log(`  ✓ data/history-${code}-${SEASON}.json（優勝: ${champion}）`);
}
console.log(`\n完了: ${wrote} ファイル書き出し（season ${SEASON}）。`);
