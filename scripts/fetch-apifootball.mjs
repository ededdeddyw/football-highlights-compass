// API-Football（api-sports.io v3）から五大リーグの「得点王ランキング」を取得して
// data/topscorers-<code>.json に保存する。要 APIFOOTBALL_KEY（GitHub Secrets）。
//  使い方: node scripts/fetch-apifootball.mjs [--season=2026] [--code=pl]
//  無料プラン（100req/日）でも 5リーグ×1req = 5req/日 で十分。1日1回のビルド運用向け。
//  ※ 選手名はAPI準拠の英字表記（日本語辞書が無いため）。クラブ名は league-teams.json で可能な範囲だけ日本語化。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEY = process.env.APIFOOTBALL_KEY || '';
if (!KEY) { console.error('❌ APIFOOTBALL_KEY が未設定です（GitHub Secrets に登録してください）。'); process.exit(1); }

const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';
const SEASON = arg('season') || '2026';
const ONLY = arg('code');
const BASE = 'https://v3.football.api-sports.io';
// API-Football のリーグID（固定）: PL=39, La Liga=140, Serie A=135, Bundesliga=78, Ligue 1=61
const LEAGUES = { pl: 39, laliga: 140, sa: 135, bl: 78, ligue1: 61 };
const readJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };
const TEAMS = readJson('data/league-teams.json', {});
const jaTeam = en => TEAMS[en] || en;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path) {
  const r = await fetch(BASE + path, { headers: { 'x-apisports-key': KEY, accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  const errs = j && j.errors;
  const hasErr = errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length);
  if (hasErr) console.error('  ⚠ API errors:', JSON.stringify(errs));
  return j || {};
}

let wrote = 0;
for (const [code, id] of Object.entries(LEAGUES)) {
  if (ONLY && code !== ONLY) continue;
  const j = await get(`/players/topscorers?league=${id}&season=${SEASON}`);
  const arr = Array.isArray(j.response) ? j.response : [];
  console.log(`${code} (league ${id}, season ${SEASON}): results=${j.results ?? 0}`);
  if (!arr.length) { console.log('  取得0件（無料プランのシーズン制限 or 未開始/未対応の可能性）。errors↑を確認。'); await sleep(300); continue; }
  const scorers = arr.slice(0, 15).map((e, i) => {
    const st = (e.statistics && e.statistics[0]) || {};
    return {
      rank: i + 1,
      name: (e.player && e.player.name) || '',
      team: jaTeam((st.team && st.team.name) || ''),
      goals: (st.goals && st.goals.total) || 0,
      assists: (st.goals && st.goals.assists) || 0,
      apps: (st.games && st.games.appearences) || 0,
      nat: (e.player && e.player.nationality) || '',
    };
  });
  writeFileSync(`data/topscorers-${code}.json`, JSON.stringify({ code, season: SEASON, updated: new Date().toISOString().slice(0, 10), scorers }, null, 2) + '\n');
  console.log(`  → data/topscorers-${code}.json（${scorers.length}名, トップ: ${scorers[0].name} ${scorers[0].goals}G）`);
  wrote++;
  await sleep(400);
}
console.log(`\nfetch-apifootball: ${wrote}リーグ分を保存${wrote ? '' : '（0件＝キー/プラン/シーズンを確認）'}`);
