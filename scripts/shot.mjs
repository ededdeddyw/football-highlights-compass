import { chromium } from 'playwright';
const b = await chromium.launch();
// 1) トップ（スマホ幅）
const p1 = await b.newPage({ viewport: { width: 414, height: 1000 }, deviceScaleFactor: 2 });
await p1.goto('https://highlight-compass.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p1.waitForTimeout(3000);
await p1.screenshot({ path: 'scripts/lineups.raw/shot-top.png' });
console.log('shot-top.png');
// 2) 個別ページ（久保）
const p2 = await b.newPage({ viewport: { width: 414, height: 1100 }, deviceScaleFactor: 2 });
await p2.goto('https://highlight-compass.com/match/rqvRbGTw2zc.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p2.waitForTimeout(3500);
await p2.screenshot({ path: 'scripts/lineups.raw/shot-match.png' });
console.log('shot-match.png');
await b.close();
