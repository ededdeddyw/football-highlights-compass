// W杯 決勝トーナメントの「結果」をWeb検証して wc-knockout.json に反映（Claude API + web_search）
// 使い方: ANTHROPIC_API_KEY=... node scripts/verify-results.mjs [--dry-run]
//  - result が空のカード（両チーム確定済み）だけを対象に、Claudeがweb検索で最終結果を確認
//  - 「複数の信頼できるソースで確定した試合だけ」を home-away 順で返す。進行中/未確定はスキップ（憶測禁止）
//  - videoId の付与は watch-knockout.mjs が別途担当（このスクリプトは result/pk のみ）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DRY = process.argv.includes('--dry-run');
const KO_FILE = 'data/wc-knockout.json';
const API_KEY = process.env.ANTHROPIC_API_KEY;
// 既定は Sonnet（スコアのWeb照合＝事実確認用途に十分・毎時実行でも低コスト）。
// リポジトリ変数 ANTHROPIC_MODEL で上書き可（例: claude-opus-4-8=最高精度 / claude-haiku-4-5-20251001=最安）。
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

if (!API_KEY) { console.log('verify-results: ANTHROPIC_API_KEY 未設定のためスキップ。'); process.exit(0); }
if (!existsSync(KO_FILE)) { console.log('verify-results: wc-knockout.json なし。終了。'); process.exit(0); }

// web検索付きリクエストは数分かかり、node(fetch/undici)の既定5分タイムアウトで落ちる。
// グローバルディスパッチャのタイムアウトを10分に延長（undici未導入なら既定のまま・try/catchで無害）。
try {
  const u = await import('undici');
  u.setGlobalDispatcher(new u.Agent({ headersTimeout: 600000, bodyTimeout: 600000, connectTimeout: 30000 }));
} catch (e) { console.warn('verify-results: undici未導入のため既定タイムアウトのまま:', e.message); }

const WCKO = JSON.parse(readFileSync(KO_FILE, 'utf8'));
const ROUND_LABEL = { r32: 'ラウンド32', r16: 'ベスト16', qf: '準々決勝', sf: '準決勝', third: '3位決定戦', final: '決勝' };

// 対象：result が空・両チーム確定済みのカード
const pending = [];
for (const key of Object.keys(WCKO)) {
  if (!Array.isArray(WCKO[key])) continue;
  for (const f of WCKO[key]) {
    if (f && f.home && f.away && !f.result) pending.push({ round: key, home: f.home, away: f.away });
  }
}
if (!pending.length) { console.log('verify-results: 未確定カードなし。終了。'); process.exit(0); }

const list = pending.map((p, i) => `${i + 1}. [${ROUND_LABEL[p.round] || p.round}] ${p.home} vs ${p.away}`).join('\n');
const prompt = `あなたはサッカーの結果を正確に検証するアシスタントです。2026 FIFAワールドカップ 決勝トーナメントの次の試合について、web検索で最終結果を確認してください。

対象試合（home vs away 表記）:
${list}

厳守ルール:
- **複数の信頼できるソース（FIFA公式・ESPN・BBC・Sky・Yahoo・主要通信社・英語版Wikipedia等）で「最終結果(FINAL)」が一致した試合だけ**を返す。
- **進行中・未消化・キックオフ前・ソース不一致・確証なしの試合は絶対に含めない**（憶測禁止。含めないことが正しい）。
- スコアは必ず上記の **home-away 順**（例: homeが2点・awayが1点なら "2-1"）。向きを間違えない。
- **PK戦決着**は result に延長終了時スコア（例 "1-1"）、pk に home-away 順のPKスコア（例 "3-4"）。PKでなければ pk は付けない。
- 延長で決着（PKなし）なら最終スコアをそのまま result に。

出力は次の形式の**JSONだけ**を \`\`\`json コードブロックで返す（確定した試合が0件なら空配列）:
\`\`\`json
[{"home":"日本語チーム名","away":"日本語チーム名","result":"H-A","pk":"H-A(任意)"}]
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
      if (!res.ok) { console.warn('verify-results: API', res.status, (await res.text()).slice(0, 300)); return null; }
      data = await res.json();
    } catch (e) { console.warn('verify-results: 通信エラー（今回はスキップ・次回再試行）:', e.message); return null; }
    if (data.stop_reason === 'pause_turn') { messages = [messages[0], { role: 'assistant', content: data.content }]; continue; }
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    return text;
  }
  return null;
}

const text = await callClaude();
if (text == null) { console.log('verify-results: API応答なし。終了。'); process.exit(0); }
const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\[[\s\S]*\])/);
let arr;
try { arr = JSON.parse(m ? m[1] : text); } catch { console.log('verify-results: JSON解析失敗。書き込みなし。'); process.exit(0); }
if (!Array.isArray(arr)) { console.log('verify-results: 配列でない。書き込みなし。'); process.exit(0); }

// 反映：home/away が完全一致し、resultが空で、"数字-数字"形式のものだけ
const applied = [];
for (const r of arr) {
  if (!r || !r.home || !r.away || !/^\d+-\d+$/.test(String(r.result || ''))) continue;
  for (const key of Object.keys(WCKO)) {
    if (!Array.isArray(WCKO[key])) continue;
    const f = WCKO[key].find(x => x.home === r.home && x.away === r.away && !x.result);
    if (f) {
      f.result = r.result;
      if (r.pk && /^\d+-\d+$/.test(String(r.pk))) f.pk = String(r.pk);
      applied.push(`[${ROUND_LABEL[key] || key}] ${f.home} ${f.result}${f.pk ? ' (PK' + f.pk + ')' : ''} ${f.away}`);
      break;
    }
  }
}

console.log(`verify-results: 対象 ${pending.length}件 / 確定反映 ${applied.length}件`);
applied.forEach(a => console.log('  ✓ ' + a));
if (DRY) { console.log('verify-results: --dry-run のため書き込みなし。'); process.exit(0); }
if (applied.length) writeFileSync(KO_FILE, JSON.stringify(WCKO, null, 2) + '\n');
