// W杯 決勝トーナメントの「対戦カード（次ラウンドの組み合わせ）」をWeb検証で wc-knockout.json に追加。
// 勝ち上がりの自動生成: 両チームが確定した新規カードだけを追加。既存カード・結果(result)・videoId は保持。
// 使い方: ANTHROPIC_API_KEY=... node scripts/advance-knockout.mjs [--dry-run]
//  - 追加された対戦カードの result/videoId は空。結果は verify-results.mjs が、動画は watch-knockout.mjs が後で埋める。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DRY = process.argv.includes('--dry-run');
const KO_FILE = 'data/wc-knockout.json';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

if (!API_KEY) { console.log('advance-knockout: ANTHROPIC_API_KEY 未設定のためスキップ。'); process.exit(0); }
if (!existsSync(KO_FILE)) { console.log('advance-knockout: wc-knockout.json なし。終了。'); process.exit(0); }

// web検索付きリクエストは数分かかる。node(undici)の既定5分タイムアウト回避のため10分に延長。
try {
  const u = await import('undici');
  u.setGlobalDispatcher(new u.Agent({ headersTimeout: 600000, bodyTimeout: 600000, connectTimeout: 30000 }));
} catch (e) { console.warn('advance-knockout: undici未導入のため既定タイムアウトのまま:', e.message); }

const WCKO = JSON.parse(readFileSync(KO_FILE, 'utf8'));
const ROUNDS = ['r16', 'qf', 'sf', 'third', 'final'];
const ROUND_LABEL = { r16: 'ベスト16', qf: '準々決勝', sf: '準決勝', third: '3位決定戦', final: '決勝' };
for (const r of ROUNDS) if (!Array.isArray(WCKO[r])) WCKO[r] = [];

// 既知チーム名（データ上の全対戦から収集）。返答チームがこの集合に無ければ表記ゆれ/誤りとして採用しない
const KNOWN = new Set();
for (const k of Object.keys(WCKO)) if (Array.isArray(WCKO[k])) for (const m of WCKO[k]) { if (m.home) KNOWN.add(m.home); if (m.away) KNOWN.add(m.away); }
const norm = s => String(s || '').replace(/\s+/g, '');
const KNORM = new Map([...KNOWN].map(n => [norm(n), n]));       // 正規化→正式名
const canon = s => KNORM.get(norm(s)) || null;                 // 既知名に正規化（無ければ null）
const pairKey = (a, b) => [norm(a), norm(b)].sort().join('|');

// 既存の対戦（全ラウンド横断）をキー化して重複追加を防ぐ
const seen = new Set();
for (const r of ROUNDS) for (const m of WCKO[r]) if (m.home && m.away) seen.add(pairKey(m.home, m.away));

const prompt = `2026 FIFAワールドカップ 決勝トーナメントについて、web検索で「両チームが確定している対戦カード（fixture）」を確認してください。
対象ラウンド: ベスト16(r16) / 準々決勝(qf) / 準決勝(sf) / 3位決定戦(third) / 決勝(final)。

厳守:
- **FIFA公式・ESPN・BBC・Sky・主要通信社等の信頼ソースで、両チームが確定している組み合わせだけ**を返す（キックオフ前でも組み合わせが決まっていれば可）。**未確定・憶測は絶対に含めない**。
- チーム名は**日本語**（例: モロッコ, フランス, スペイン, ベルギー, ノルウェー, イングランド, アルゼンチン, スイス）。
- home/away はソース表記順でよい。**スコア・結果は不要**（対戦カードのみ）。
- 判明している全ラウンドの確定カードを列挙してよい（こちらで新規分のみ採用する）。

出力は次のJSONだけを \`\`\`json コードブロックで返す（0件なら空配列）:
\`\`\`json
[{"round":"r16","home":"日本語チーム名","away":"日本語チーム名"}]
\`\`\``;

async function callClaude() {
  let messages = [{ role: 'user', content: prompt }];
  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 12 }];
  for (let turn = 0; turn < 6; turn++) {
    let data;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 4000, thinking: { type: 'adaptive' }, tools, messages })
      });
      if (!res.ok) { console.warn('advance-knockout: API', res.status, (await res.text()).slice(0, 300)); return null; }
      data = await res.json();
    } catch (e) { console.warn('advance-knockout: 通信エラー（今回はスキップ・次回再試行）:', e.message); return null; }
    if (data.stop_reason === 'pause_turn') { messages = [messages[0], { role: 'assistant', content: data.content }]; continue; }
    return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  }
  return null;
}

const text = await callClaude();
if (text == null) { console.log('advance-knockout: API応答なし。終了。'); process.exit(0); }
const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\[[\s\S]*\])/);
let arr;
try { arr = JSON.parse(m ? m[1] : text); } catch { console.log('advance-knockout: JSON解析失敗。書き込みなし。'); process.exit(0); }
if (!Array.isArray(arr)) { console.log('advance-knockout: 配列でない。書き込みなし。'); process.exit(0); }

// 追加：ラウンド妥当・両チームが既知名・未登場の対戦のみ
const added = [];
for (const c of arr) {
  if (!c || !ROUNDS.includes(c.round)) continue;
  const h = canon(c.home), a = canon(c.away);
  if (!h || !a || h === a) continue;                 // 未知名/不正はスキップ（安全側）
  const key = pairKey(h, a);
  if (seen.has(key)) continue;                       // 既にどこかのラウンドに存在
  WCKO[c.round].push({ home: h, away: a, result: '', videoId: '' });
  seen.add(key); added.push(`[${ROUND_LABEL[c.round]}] ${h} vs ${a}`);
}

console.log(`advance-knockout: 新規対戦カード ${added.length}件`);
added.forEach(a => console.log('  + ' + a));
if (!added.length) console.log('advance-knockout: [診断] モデル生応答(先頭1200字):\n' + String(text).slice(0, 1200));
if (DRY) { console.log('advance-knockout: --dry-run のため書き込みなし。'); process.exit(0); }
if (added.length) writeFileSync(KO_FILE, JSON.stringify(WCKO, null, 2) + '\n');
