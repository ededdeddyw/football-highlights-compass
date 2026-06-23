import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 414, height: 900 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:8124/', { waitUntil: 'networkidle', timeout: 30000 });
await p.waitForTimeout(2500);
await p.screenshot({ path: 'scripts/lineups.raw/s-font.png' });
console.log('s-font');
// autocomplete
await p.fill('#q', '久保');
await p.waitForTimeout(700);
await p.screenshot({ path: 'scripts/lineups.raw/s-ac.png' });
console.log('s-ac');
// menu
await p.fill('#q', '');
await p.click('#menuBtn');
await p.waitForTimeout(600);
await p.screenshot({ path: 'scripts/lineups.raw/s-menu.png' });
console.log('s-menu');
await b.close();
