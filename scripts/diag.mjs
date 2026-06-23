import { readFileSync } from 'node:fs';
const KEY = readFileSync(new URL('../api-key.txt', import.meta.url), 'utf8').trim();
const BASE = 'https://v3.football.api-sports.io';
const get = async (p) => (await fetch(BASE + p, { headers: { 'x-apisports-key': KEY } })).json();

// La Liga coverage / seasons on this plan
const lg = await get('/leagues?id=140');
const node = (lg.response||[])[0];
console.log('La Liga seasons available:', (node?.seasons||[]).map(s=>s.year).join(','));
console.log('errors(leagues):', JSON.stringify(lg.errors||{}));

// try a few seasons for fixtures count (team Real Sociedad 548)
for (const s of [2023, 2024, 2025]) {
  const fx = await get(`/fixtures?league=140&season=${s}&team=548`);
  console.log(`fixtures L140 S${s} team548:`, fx.results, '| errors:', JSON.stringify(fx.errors||{}));
}
// World Cup 2026 (league id 1)
const wc = await get('/fixtures?league=1&season=2026');
console.log('World Cup L1 S2026 fixtures:', wc.results, '| errors:', JSON.stringify(wc.errors||{}));
const wc25 = await get('/fixtures?league=1&season=2022');
console.log('World Cup L1 S2022 fixtures:', wc25.results, '| errors:', JSON.stringify(wc25.errors||{}));
