import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 540 } });
await p.setContent(`<style>*{margin:0}body{width:1600px;height:540px;overflow:hidden}img{width:1600px;height:540px;object-fit:cover;object-position:center 42%;display:block;filter:saturate(1.05) contrast(1.03)}</style><img src="http://localhost:8124/img/_cand_incheon.jpg">`, { waitUntil: 'networkidle', timeout: 30000 });
await p.waitForTimeout(800);
await p.screenshot({ path: 'site/img/hero.jpg', quality: 80, type: 'jpeg' });
await b.close();
console.log('site/img/hero.jpg 生成');
