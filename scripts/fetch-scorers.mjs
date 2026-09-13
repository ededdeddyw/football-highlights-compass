// football-data.org から五大リーグの「得点王ランキング(scorers)」を取得して
// data/topscorers-<code>.json に保存する。要 FOOTBALL_DATA_TOKEN（無料枠でOK・現行シーズン対応）。
//  ※ API-Football の無料プランは現行シーズン非対応（2022-2024のみ）のため、得点王は football-data 経路を採用。
//  使い方: node scripts/fetch-scorers.mjs [--code=pl]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const TOKEN = process.env.FOOTBALL_DATA_TOKEN || '';
if (!TOKEN) { console.error('❌ FOOTBALL_DATA_TOKEN が未設定です（GitHub Secrets に登録してください）。'); process.exit(1); }

const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';
const ONLY = arg('code');
// football-data の competition コード
const COMP = { pl: 'PL', laliga: 'PD', sa: 'SA', bl: 'BL1', ligue1: 'FL1' };
const readJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };
const TEAMS = readJson('data/league-teams.json', {});
const jaTeam = en => TEAMS[en] || en;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let wrote = 0;
for (const [code, comp] of Object.entries(COMP)) {
  if (ONLY && code !== ONLY) continue;
  let r;
  try { r = await fetch(`https://api.football-data.org/v4/competitions/${comp}/scorers?limit=15`, { headers: { 'X-Auth-Token': TOKEN } }); }
  catch (e) { console.error(`${code}: fetch失敗 ${e.message}`); await sleep(6500); continue; }
  if (!r.ok) { const t = await r.text().catch(() => ''); console.error(`${code}: HTTP ${r.status} ${t}`.slice(0, 200)); await sleep(6500); continue; }
  const j = await r.json();
  const arr = Array.isArray(j.scorers) ? j.scorers : [];
  console.log(`${code} (${comp}): ${arr.length}名`);
  if (!arr.length) { await sleep(6500); continue; }
  const scorers = arr.slice(0, 15).map((e, i) => ({
    rank: i + 1,
    name: (e.player && e.player.name) || '',
    team: jaTeam((e.team && e.team.name) || ''),
    goals: e.goals || 0,
    assists: (e.assists ?? null),
    pens: (e.penalties ?? null),
    apps: e.playedMatches || 0,
    nat: (e.player && e.player.nationality) || '',
  }));
  const season = String((j.season && j.season.startDate) || '').slice(0, 4);
  writeFileSync(`data/topscorers-${code}.json`, JSON.stringify({ code, season, source: 'football-data.org', updated: new Date().toISOString().slice(0, 10), scorers }, null, 2) + '\n');
  console.log(`  → data/topscorers-${code}.json（トップ: ${scorers[0].name} ${scorers[0].goals}G）`);
  wrote++;
  await sleep(6500); // 無料枠 10req/min のレート制限に配慮
}
console.log(`\nfetch-scorers: ${wrote}リーグ分を保存${wrote ? '' : '（0件＝トークン/対象リーグを確認）'}`);
