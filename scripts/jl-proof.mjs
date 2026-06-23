// 実証: Jリーグ公式の試合ページをヘッドレス描画して先発フルメンバーを抽出
import { chromium } from 'playwright';

const URL = 'https://www.jleague.jp/match/j1/2026/060603/live/';
const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36' });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3500);

// フォーメーション/メンバータブをクリック（あれば）
for (const label of ['フォーメーション', 'メンバー', '出場メンバー', 'スターティング']) {
  const tab = page.locator(`text=${label}`).first();
  if (await tab.count().catch(()=>0)) { try { await tab.click({ timeout: 3000 }); await page.waitForTimeout(1800); } catch {} }
}
// 選手リンクが増えるまで最大10秒待つ
for (let i=0;i<10;i++){
  const n = await page.evaluate(()=>document.querySelectorAll('a[href*="/player/detail/"]').length);
  if (n >= 20) break;
  await page.waitForTimeout(1000);
}

const data = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('a[href*="/player/detail/"]').forEach(a => {
    const m = a.getAttribute('href').match(/\/club\/([a-z]+)\/player\/detail\/(\d+)\//);
    if (m) out.push({ club: m[1], id: m[2], name: a.textContent.trim().replace(/\s+/g,' ') });
  });
  return out;
});
// dedupe by id
const seen = new Set(); const players = data.filter(p => !seen.has(p.id) && seen.add(p.id));
const byClub = {};
players.forEach(p => { (byClub[p.club] = byClub[p.club] || []).push(p.name); });
console.log('total unique players on page:', players.length);
for (const c of Object.keys(byClub)) console.log(`  [${c}] (${byClub[c].length}名):`, byClub[c].join('、'));
console.log('title:', (await page.title()));
await browser.close();
