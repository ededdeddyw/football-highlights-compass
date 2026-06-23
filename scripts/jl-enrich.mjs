// Jリーグ公式から出場選手を取得し、サイトのJリーグカードに紐付ける
// 使い方: node scripts/jl-enrich.mjs --mode sample --limit 10
//        node scripts/jl-enrich.mjs --mode full
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const ARG = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i+1] : d; };
const MODE = ARG('--mode', 'sample');
const LIMIT = parseInt(ARG('--limit', MODE === 'sample' ? '10' : '9999'), 10);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36';
const RAW = 'scripts/lineups.raw';
mkdirSync(RAW + '/dates', { recursive: true });
mkdirSync(RAW + '/lu', { recursive: true });

// ---- クラブ名 正規化（長い名/短い名 どちらも同じkeyへ）----
const CLUBS = [
  ['横浜FC','yokohama_fc'], ['横浜F','yokohama_fm'], ['マリノス','yokohama_fm'],
  ['ヴェルディ','verdy'], ['東京V','verdy'], ['FC東京','fctokyo'],
  ['浦和','urawa'], ['川崎','kawasaki'], ['鹿島','kashima'], ['神戸','kobe'],
  ['ガンバ','gamba'], ['G大阪','gamba'], ['セレッソ','cerezo'], ['C大阪','cerezo'],
  ['広島','hiroshima'], ['名古屋','nagoya'], ['京都','kyoto'], ['福岡','fukuoka'],
  ['清水','shimizu'], ['新潟','niigata'], ['岡山','okayama'], ['千葉','chiba'],
  ['町田','machida'], ['柏','kashiwa'], ['水戸','mito'], ['湘南','shonan'],
  ['磐田','iwata'], ['鳥栖','tosu'], ['藤枝','fujieda'], ['松本','matsumoto'],
  ['栃木','tochigi'], ['福島','fukushima'], ['札幌','sapporo'], ['コンサドーレ','sapporo'],
  ['いわき','iwaki'], ['鳥取','tottori'], ['ガイナーレ','tottori'], ['愛媛','ehime'],
  ['今治','imabari'], ['高知','kochi'], ['讃岐','sanuki'], ['カマタマーレ','sanuki'],
  ['仙台','sendai'], ['ベガルタ','sendai'],
];
const toHalf = (s) => s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
const norm = (name) => { name = toHalf(name); for (const [sub,k] of CLUBS) if (name.includes(toHalf(sub))) return k; return null; };

// ---- サイトの EXTRA_JL カードを index.html から読む ----
function readCards() {
  const h = readFileSync('site/index.html', 'utf8');
  const block = h.match(/const EXTRA_JL = \[([\s\S]*?)\];/)[1];
  const cards = [];
  for (const m of block.matchAll(/\{ttl:"([^"]+)",\s*meta:"([^"]+)",\s*id:"([^"]+)"\}/g)) {
    const ttl = m[1], meta = m[2], id = m[3];
    const vs = ttl.split(' vs ');
    if (vs.length === 2) cards.push({ vid: id, ttl, meta, home: vs[0].trim(), away: vs[1].trim(), hk: norm(vs[0]), ak: norm(vs[1]) });
  }
  return cards;
}

// ---- 日付リスト ----
function fullDates() {
  const out = []; const start = new Date(Date.UTC(2026,1,13)), end = new Date(Date.UTC(2026,11,14));
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const d = new Date(t); const wd = d.getUTCDay();
    if ([0,3,5,6].includes(wd)) out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`);
  }
  return out;
}
const SAMPLE_DATES = ['20260606','20260607','20260307','20260308','20260404','20260405','20260503','20260504','20260221','20260222'];

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA });

async function scanDate(date) {
  const cacheAll = [];
  for (const comp of ['j1','j2j3']) {
    const cf = `${RAW}/dates/${date}_${comp}.json`;
    if (existsSync(cf)) { cacheAll.push(...JSON.parse(readFileSync(cf,'utf8'))); continue; }
    const page = await ctx.newPage(); let rows = [];
    try {
      await page.goto(`https://www.jleague.jp/match/search/${comp}/${date}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      rows = await page.evaluate((comp) => {
        const res = []; const seen = new Set();
        for (const a of document.querySelectorAll(`a[href*="/match/${comp}/2026/"]`)) {
          const m = a.getAttribute('href').match(/\/match\/[a-z0-9]+\/2026\/(\d{6})\//); if (!m || seen.has(m[1])) continue;
          let row = a; for (let i=0;i<6 && row.parentElement;i++){ row = row.parentElement; if (/match/i.test(row.className||'')) break; }
          const clubs = [...new Set([...row.querySelectorAll('[class*=lub],[class*=eam]')].map(e=>e.textContent.trim().replace(/\s+/g,'')).filter(t=>t&&t.length<=12&&/[一-龠ぁ-んァ-ヶA-Za-z]/.test(t)))];
          seen.add(m[1]); res.push({ code:m[1], comp, clubs: clubs.slice(0,2) });
        }
        return res;
      }, comp);
    } catch {}
    await page.close();
    writeFileSync(cf, JSON.stringify(rows));
    cacheAll.push(...rows);
  }
  return cacheAll;
}

async function getLineup(comp, code) {
  const cf = `${RAW}/lu/${code}.json`;
  if (existsSync(cf)) return JSON.parse(readFileSync(cf,'utf8'));
  const page = await ctx.newPage(); let players = [];
  try {
    await page.goto(`https://www.jleague.jp/match/${comp}/2026/${code}/live/`, { waitUntil:'domcontentloaded', timeout:30000 });
    await page.waitForTimeout(3500);
    for (const label of ['フォーメーション','メンバー']) { const t = page.locator(`text=${label}`).first(); if (await t.count().catch(()=>0)) { try{ await t.click({timeout:2500}); await page.waitForTimeout(1500);}catch{} } }
    for (let i=0;i<8;i++){ const n=await page.evaluate(()=>document.querySelectorAll('a[href*="/player/detail/"]').length); if(n>=20)break; await page.waitForTimeout(1000); }
    players = await page.evaluate(() => {
      const o=[]; document.querySelectorAll('a[href*="/player/detail/"]').forEach(a=>{ const m=a.getAttribute('href').match(/\/club\/([a-z]+)\/player\/detail\/(\d+)\//); if(m)o.push({club:m[1],id:m[2],name:a.textContent.trim().replace(/\s+/g,' ').replace(/^(OUT|IN)/,'')}); });
      return o;
    });
  } catch {}
  await page.close();
  const seen=new Set(); players=players.filter(p=>p.name && !seen.has(p.id) && seen.add(p.id));
  writeFileSync(cf, JSON.stringify(players));
  return players;
}

// ---- main ----
const cards = readCards();
console.log(`cards: ${cards.length}, mode=${MODE}, limit=${LIMIT}`);
const dates = MODE === 'sample' ? SAMPLE_DATES : fullDates();
console.log('scanning dates:', dates.length);
const codeMap = {}; // "hk|ak" -> {code,comp}
let scanned = 0;
for (const d of dates) {
  const rows = await scanDate(d); scanned++;
  for (const r of rows) {
    if (r.clubs.length < 2) continue;
    const a = norm(r.clubs[0]), b = norm(r.clubs[1]); if (!a || !b) continue;
    codeMap[`${a}|${b}`] = { code: r.code, comp: r.comp };
    if (!codeMap[`${b}|${a}`]) codeMap[`${b}|${a}`] = { code: r.code, comp: r.comp }; // 順序不明対策
  }
  if (scanned % 10 === 0) console.log(`  scanned ${scanned}/${dates.length} dates, map size ${Object.keys(codeMap).length}`);
}
console.log('schedule pairs collected:', Object.keys(codeMap).length);

const out = existsSync('scripts/jl-players.json') ? JSON.parse(readFileSync('scripts/jl-players.json','utf8')) : {};
let matched = 0, done = 0, unmatched = [];
for (const c of cards) {
  if (!c.hk || !c.ak) { unmatched.push(c.ttl + ' (名前正規化不可)'); continue; }
  const hit = codeMap[`${c.hk}|${c.ak}`];
  if (!hit) { unmatched.push(c.ttl); continue; }
  matched++;
  if (out[c.vid]) { done++; continue; }
  if (done >= LIMIT) continue;
  const players = await getLineup(hit.comp, hit.code);
  if (players.length) { out[c.vid] = { code: hit.code, comp: hit.comp, players: players.map(p=>p.name) }; done++; console.log(`  [${done}] ${c.ttl} -> ${players.length}名`); }
  writeFileSync('scripts/jl-players.json', JSON.stringify(out, null, 0));
}
console.log(`MATCHED ${matched}/${cards.length} | lineups stored ${Object.keys(out).length} | unmatched ${unmatched.length}`);
if (unmatched.length) console.log('unmatched sample:', unmatched.slice(0,15));
await browser.close();
