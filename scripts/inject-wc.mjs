// 検知結果（data/wc2026-detected.json）を site/index.html の /*WC_AUTO*/ マーカーへ注入
// 手動キュレーション（EXTRA_WC 本体）には一切触れない。
// 使い方: node scripts/inject-wc.mjs        … detected を反映
//          node scripts/inject-wc.mjs --reset … 自動分を空に戻す（ロールバック）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const RESET = process.argv.includes('--reset');
const FILE = 'site/index.html';
const START = '/*WC_AUTO_START*/', END = '/*WC_AUTO_END*/';

let html = readFileSync(FILE, 'utf8');
if (!html.includes(START) || !html.includes(END)) { console.error('マーカー /*WC_AUTO_START|END*/ が index.html に見つかりません。'); process.exit(1); }

const esc = s => (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const schedule = existsSync('data/wc2026-schedule.json') ? (JSON.parse(readFileSync('data/wc2026-schedule.json', 'utf8')).matches || []) : [];
const schedById = new Map(schedule.map(m => [m.matchId, m]));

let items = [];
if (!RESET && existsSync('data/wc2026-detected.json')) {
  const detected = (JSON.parse(readFileSync('data/wc2026-detected.json', 'utf8')).detected) || [];
  const seen = new Set();
  for (const d of detected) {
    if (!d.videoId || seen.has(d.videoId)) continue; seen.add(d.videoId);
    const s = schedById.get(d.matchId) || {};
    const ttl = (s.home?.ja && s.away?.ja) ? `${s.home.ja} vs ${s.away.ja}` : (d.title || d.videoId);
    const stage = s.group ? `グループ${s.group}` : (s.stage || '');
    const meta = [stage, s.round].filter(Boolean).join('・') || 'FIFAワールドカップ26';
    items.push(`  {ttl:"${esc(ttl)}", meta:"${esc(meta)}", id:"${esc(d.videoId)}"}`);
  }
}

const body = `${START}\nvar EXTRA_WC_AUTO = [\n${items.join(',\n')}${items.length ? '\n' : ''}];\nEXTRA_WC.push.apply(EXTRA_WC, EXTRA_WC_AUTO);\n${END}`;
const re = new RegExp(START.replace(/[*/]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[*/]/g, '\\$&'));
html = html.replace(re, body);
writeFileSync(FILE, html);
console.log(`inject-wc: ${RESET ? 'リセット（自動分0件）' : items.length + '件'} を反映。`);
