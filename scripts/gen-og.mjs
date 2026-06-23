import { chromium } from 'playwright';
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;font-family:"Hiragino Kaku Gothic ProN","Yu Gothic UI",sans-serif;
  background:linear-gradient(125deg,#0a1250 0%,#1b2a78 55%,#26368f 100%);color:#fff;overflow:hidden;position:relative}
.glow{position:absolute;right:-120px;top:-120px;width:520px;height:520px;border-radius:50%;
  background:radial-gradient(circle,rgba(80,120,255,.45),transparent 60%)}
.wrap{position:absolute;inset:0;padding:74px 80px;display:flex;flex-direction:column;justify-content:center}
.kicker{font-size:30px;color:#aebcf5;letter-spacing:.06em;margin-bottom:14px;font-weight:700}
h1{font-size:72px;line-height:1.18;font-weight:900;letter-spacing:.01em}
h1 .b{color:#7fa0ff}
.tags{margin-top:34px;display:flex;gap:14px;flex-wrap:wrap}
.tag{font-size:25px;font-weight:700;padding:10px 22px;border-radius:999px;background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.28)}
.foot{position:absolute;left:80px;bottom:54px;font-size:26px;color:#c8d2f6;font-weight:700}
.ball{position:absolute;right:88px;bottom:60px;font-size:120px;opacity:.92}
</style></head><body>
<div class="glow"></div>
<div class="wrap">
  <div class="kicker">⚽🧭 Football Highlights Compass</div>
  <h1>公式サッカーハイライト<br><span class="b">まとめ＆横断検索</span></h1>
  <div class="tags"><span class="tag">W杯26</span><span class="tag">Jリーグ</span><span class="tag">日本人所属クラブ</span><span class="tag">出場選手で検索</span></div>
</div>
<div class="foot">公式映像のみ・無断転載なし・ネタバレ防止</div>
<div class="ball">⚽</div>
</body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.screenshot({ path: 'site/og.png' });
await browser.close();
console.log('og.png generated -> site/og.png');
