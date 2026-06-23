import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36' });
await page.goto('https://www.jleague.jp/match/search/j1/latest', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(4000);
const info = await page.evaluate(() => {
  const links = [...new Set([...document.querySelectorAll('a[href*="/match/j1/2026/"]')].map(a => a.getAttribute('href').match(/\/match\/j1\/2026\/(\d{6})\//)?.[1]).filter(Boolean))];
  // section selector options (節 navigation)
  const opts = [...document.querySelectorAll('select option')].map(o => (o.value||'') + ':' + o.textContent.trim()).slice(0, 40);
  // any "section" / 節 label text
  const secLabels = [...document.querySelectorAll('[class*=section i], [class*=Section i]')].map(e=>e.textContent.trim().slice(0,20)).filter(Boolean).slice(0,10);
  return { matchCodes: links, codeCount: links.length, selectOptions: opts, secLabels };
});
console.log('match codes on latest page:', info.codeCount);
console.log('sample codes:', info.matchCodes.slice(0, 10));
console.log('select options (節ナビ?):', info.selectOptions);
console.log('section labels:', info.secLabels);
await browser.close();
