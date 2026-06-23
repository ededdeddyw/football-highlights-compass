import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36' });
await page.goto('https://www.jleague.jp/match/search/j1/latest', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(4000);
const nav = await page.evaluate(() => {
  // current heading (which 節/round)
  const heading = (document.querySelector('h1, h2, .matchHeader, [class*=section i]')||{}).textContent || '';
  // prev/next controls
  const ctrls = [...document.querySelectorAll('a, button')].filter(e => /前|次|prev|next|節/.test(e.textContent + (e.getAttribute('aria-label')||'') + (e.className||''))).map(e => ({ t: e.textContent.trim().slice(0,12), href: e.getAttribute('href'), cls: (e.className||'').slice(0,40) }));
  // any link that looks like a section/date navigation
  const links = [...new Set([...document.querySelectorAll('a[href*="/match/search/j1/"]')].map(a=>a.getAttribute('href')))].slice(0,20);
  return { heading: heading.replace(/\s+/g,' ').slice(0,80), ctrls: ctrls.slice(0,15), searchLinks: links };
});
console.log('heading:', nav.heading);
console.log('prev/next controls:', JSON.stringify(nav.ctrls, null, 1));
console.log('search links:', nav.searchLinks);
await browser.close();
