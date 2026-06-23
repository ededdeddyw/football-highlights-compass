import { chromium } from 'playwright';
const b = await chromium.launch();
for (const sz of [180, 512]) {
  const p = await b.newPage({ viewport: { width: sz, height: sz }, deviceScaleFactor: 1 });
  await p.setContent(`<style>*{margin:0}body{width:${sz}px;height:${sz}px}img{width:${sz}px;height:${sz}px;display:block}</style><img src="http://localhost:8124/favicon.svg">`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.screenshot({ path: sz===180?'site/apple-touch-icon.png':'site/icon-512.png' });
  await p.close();
}
await b.close(); console.log('icons done');
