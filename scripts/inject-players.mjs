// scripts/jl-players.json を index.html の JL_PLAYERS に注入
import { readFileSync, writeFileSync } from 'node:fs';
const data = JSON.parse(readFileSync('scripts/jl-players.json', 'utf8'));
const map = {};
for (const vid of Object.keys(data)) map[vid] = data[vid].players;
let h = readFileSync('site/index.html', 'utf8');
const json = JSON.stringify(map);
const re = /\/\*JL_PLAYERS_START\*\/[\s\S]*?\/\*JL_PLAYERS_END\*\//;
if (!re.test(h)) { console.error('markers not found'); process.exit(1); }
h = h.replace(re, '/*JL_PLAYERS_START*/\nvar JL_PLAYERS = ' + json + ';\n/*JL_PLAYERS_END*/');
writeFileSync('site/index.html', h);
const total = Object.values(map).reduce((s,a)=>s+a.length,0);
console.log('injected', Object.keys(map).length, 'matches /', total, 'player tags');
