// 日程ページを描画して試合(code, home, away)を収集
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const dates = process.argv.slice(2); // YYYYMMDD list
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36';
const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA });
const all = [];
for (const d of dates) {
  for (const comp of ['j1', 'j2j3']) {
    const page = await ctx.newPage();
    try {
      await page.goto(`https://www.jleague.jp/match/search/${comp}/${d}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3500);
      const rows = await page.evaluate((comp) => {
        const res = [];
        const anchors = [...document.querySelectorAll(`a[href*="/match/${comp}/2026/"]`)];
        const seen = new Set();
        for (const a of anchors) {
          const m = a.getAttribute('href').match(/\/match\/[a-z0-9]+\/2026\/(\d{6})\//);
          if (!m || seen.has(m[1])) continue;
          // climb to a row container
          let row = a; for (let i=0;i<6 && row.parentElement;i++){ row = row.parentElement; if (/match/i.test(row.className||'')) break; }
          const clubs = [...row.querySelectorAll('[class*=lub], [class*=eam]')].map(e=>e.textContent.trim().replace(/\s+/g,'')).filter(t=>t && t.length<=12 && /[一-龠ぁ-んァ-ヶA-Za-z]/.test(t));
          const uniq = [...new Set(clubs)];
          seen.add(m[1]);
          res.push({ code: m[1], comp, clubs: uniq.slice(0,4), rowText: row.textContent.replace(/\s+/g,' ').trim().slice(0,90) });
        }
        return res;
      }, comp);
      console.log(`${d} ${comp}: ${rows.length} matches`);
      if (rows[0]) console.log('  e.g.', JSON.stringify(rows[0]));
      all.push(...rows);
    } catch (e) { console.log(`${d} ${comp}: ERR ${e.message.slice(0,60)}`); }
    await page.close();
  }
}
mkdirSync('scripts/lineups.raw', { recursive: true });
writeFileSync('scripts/lineups.raw/scan.json', JSON.stringify(all, null, 1));
console.log('TOTAL matches collected:', all.length, '-> scripts/lineups.raw/scan.json');
await browser.close();
