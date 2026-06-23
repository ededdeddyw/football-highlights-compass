// 実証: API-Football から1試合のフル出場選手を取得できるか確認
import { readFileSync } from 'node:fs';
const KEY = readFileSync(new URL('../api-key.txt', import.meta.url), 'utf8').trim();
const BASE = 'https://v3.football.api-sports.io';
const get = async (path) => {
  const r = await fetch(BASE + path, { headers: { 'x-apisports-key': KEY } });
  return r.json();
};
let used = 0;
// 1) Real Sociedad のチームID
const t = await get('/teams?search=Real Sociedad'); used++;
const team = (t.response || []).find(x => /sociedad/i.test(x.team.name)) || (t.response||[])[0];
const teamId = team?.team?.id;
console.log('1) team:', team?.team?.name, 'id=', teamId);
// 2) La Liga(140) 2025シーズンの該当チーム試合一覧
const fx = await get(`/fixtures?league=140&season=2025&team=${teamId}`); used++;
const fixtures = (fx.response || []).filter(f => f.fixture.status.short === 'FT');
console.log('2) finished fixtures found:', fixtures.length, '| 例:', fixtures.slice(0,3).map(f=>`${f.teams.home.name} ${f.goals.home}-${f.goals.away} ${f.teams.away.name} (R${f.league.round})`));
// 3) 1試合のラインアップ
const target = fixtures[0];
if (target) {
  const lu = await get(`/fixtures/lineups?fixture=${target.fixture.id}`); used++;
  console.log('3) lineup for:', target.teams.home.name, 'vs', target.teams.away.name, '/', target.fixture.date.slice(0,10));
  for (const side of (lu.response || [])) {
    const starters = (side.startXI||[]).map(p=>p.player.name);
    const subs = (side.substitutes||[]).map(p=>p.player.name);
    console.log(`  [${side.team.name}] formation ${side.formation}`);
    console.log('    先発:', starters.join(', '));
    console.log('    控え:', subs.join(', '));
  }
}
console.log('--- requests used this run:', used, '---');
