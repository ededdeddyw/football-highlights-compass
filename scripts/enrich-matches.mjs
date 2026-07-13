// 試合ページの独自記事（ネタバレなしの前フリ）をClaudeで生成し data/match-previews.json に保存する。
// 目的: 「動画の埋め込み＋1文」だけの薄いページを、独自の読み物を備えた充実ページに引き上げ、
//       AdSenseの「有用性の低いコンテンツ」を解消する。
// 入力: data/matches-index.json（build-site.mjs が毎回書き出す試合一覧）。
// 使い方: ANTHROPIC_API_KEY=... node scripts/enrich-matches.mjs [--limit N] [--ids a,b,c] [--dry-run]
//   - 記事未生成の試合だけを対象に、1回あたり最大 N 件（既定6）を生成する（毎時バッチ運用でコスト平準化）。
//   - スコア・勝敗・得点者など結果は一切書かせない（ネタバレ防止）。生成物にスコア表記があれば不採用。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const limArg = (args.find(a => a.startsWith('--limit=')) || '').split('=')[1];
const idsArg = (args.find(a => a.startsWith('--ids=')) || '').split('=')[1];
const LIMIT = Number.isFinite(+limArg) && +limArg > 0 ? +limArg : 6;
const ONLY_IDS = idsArg ? new Set(idsArg.split(',').map(s => s.trim()).filter(Boolean)) : null;

const IDX_FILE = 'data/matches-index.json';
const OUT_FILE = 'data/match-previews.json';
const RULES_FILE = 'docs/japanese-style-rules.md';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

if (!API_KEY) { console.log('enrich-matches: ANTHROPIC_API_KEY 未設定のためスキップ。'); process.exit(0); }
if (!existsSync(IDX_FILE)) { console.log('enrich-matches: matches-index.json なし（先に build-site を実行）。終了。'); process.exit(0); }

// web検索は使わないが、応答が長引く場合に備えて undici のタイムアウトを延長（未導入なら既定のまま・無害）。
try {
  const u = await import('undici');
  u.setGlobalDispatcher(new u.Agent({ headersTimeout: 300000, bodyTimeout: 300000, connectTimeout: 30000 }));
} catch (e) { console.warn('enrich-matches: undici未導入のため既定タイムアウトのまま:', e.message); }

const readJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };
const INDEX = readJson(IDX_FILE, []);
const PREVIEWS = readJson(OUT_FILE, {});

// 対象: まだ記事が無く、両チームが分かる試合（文脈が書けるもの）。--ids 指定時はそれを優先。
let pending = INDEX.filter(m => m && m.id && Array.isArray(m.teams) && m.teams.length >= 1 && !PREVIEWS[m.id]);
if (ONLY_IDS) pending = INDEX.filter(m => m && ONLY_IDS.has(m.id));
pending = pending.slice(0, LIMIT);

if (!pending.length) { console.log('enrich-matches: 生成対象なし。終了。'); process.exit(0); }

// 日本語表現ルールを読み込み、プロンプトに要点を反映（AI感を薄め、自然で読みやすい日本語にする）。
const RULES = existsSync(RULES_FILE) ? readFileSync(RULES_FILE, 'utf8') : '';

const styleDirective = `【日本語表現の厳守ルール】（このサイトの全記事に適用）
- 文末は「です・ます調」で最初から最後まで統一する（体言止め・である調を混在させない）。
- 主語と目的語を省略しない。「誰が」「何を」が分かる文を書く。抽象語で逃げない。
- 人が普段使わない造語的・不自然な表現を避け、読んで頭にすっと入る言い回しにする。
- 「必ず」「100%」「確実に」など、根拠を超えて言い切る表現を使わない。試合の勝敗を予想・断定しない。
- 事実（所属・大会・実績）と、評価・解釈の言葉を混同しない。確証のないことは書かない。
- 遠回しな述語（〜できる状態にする 等）を避け、端的な動詞で言い切る。同じ述語の連発を避ける。
- 前提や文脈を補い、初めて読む人でも一読で内容が分かるように書く。`;

function buildPrompt(m) {
  const teams = m.teams.join(' 対 ');
  const comp = m.leagueName || (m.league === 'wc' ? 'FIFAワールドカップ2026' : '');
  const jp = (m.players && m.players.length) ? `この試合に関係する日本人選手: ${m.players.join('・')}。` : '';
  const metaLine = m.meta ? `節・ラウンド情報: ${m.meta}。` : '';
  return `あなたは日本語のサッカーメディアの編集者です。次の試合について、読者がざっと読んで見どころをつかめる「注目ポイント集」を作ってください。長い文章の羅列ではなく、見出し付きで手短にまとめます。

対戦: ${teams}
大会: ${comp}
${metaLine}${jp}

出力は次のJSONだけを \`\`\`json コードブロックで返してください（前置き・説明・マークダウンの見出しは付けない）:
\`\`\`json
{
  "lead": "1〜2文の短い導入（この試合が何で、大会の中でどんな一戦かが分かる程度）",
  "points": [
    {"icon": "アイコンキー（下の一覧から1つ）", "title": "見どころの短い見出し（12〜18字程度）", "body": "説明（1文・40〜65字程度で簡潔に。長くしない）"}
  ]
}
\`\`\`

icon は次のキーから、そのポイントの内容に最も合うものを1つ選んでください（内容と合わない場合は使わない）:
- speed=スピード/快足, pace=運動量/球際の速さ, goal=得点力/決定力, playmaker=司令塔/組み立て,
  keeper=GK/守護神, shield=守備/堅守, duel=因縁/対立/激突, star=注目のスター選手,
  tactics=戦術/かみ合わせ, history=歴史/伝統/実績, nation=国や地域の対比, bond=選手同士の関係/師弟,
  transfer=移籍/所属クラブの話題, stakes=大一番/懸かっているもの, ticket=勝ち上がり/進出争い,
  venue=会場/開催地, rising=成長株/上り調子, set_piece=セットプレー, header=空中戦/高さ, key=試合の鍵

要件:
- points は **2〜5個**。見どころの多い注目カードなら5個まで。無理に数を増やさず、確かに書ける見どころだけを挙げる。
- 拾ってよい観点の例（当てはまり、かつ確かな情報がある場合のみ・全部入れる必要はない）:
  - この大会・ラウンドでのこの試合の位置づけや懸かっているもの（グループ第2/3節なら決勝トーナメント進出争い、決勝トーナメントなら敗れれば終わりの一発勝負。勝敗の両シナリオを一般論として示す）
  - 注目選手とその役割・持ち味
  - 両国／両クラブの対戦の歴史や因縁、スタイルの対比
  - 選手の所属クラブや移籍の背景、選手同士の関係・因縁
  - 戦術やプレースタイルの見どころ
- **この試合そのものの結果には触れない**（スコア・勝敗・得点者・PKの行方を書かない）。ただし過去の対戦や移籍などの話題は書いてよい。
- **事実の捏造を絶対にしない**。過去の対戦成績・対戦回数・どちらが勝ったか・優勝回数・移籍先・在籍年・具体的な数字や日付は、確実に知っている場合だけ書く。少しでも不確かなら断定せず「過去にも対戦がある両国です」のように一般化し、勝者や回数を作らない。憶測で数字や勝敗を書かない。
- 迷ったら、確実に言える一般的な特徴（プレースタイル、大会での大まかな立ち位置、広く知られた選手）に寄せる。
- 落ち着いた紹介の筆致にし、誇張しない。

${styleDirective}`;
}

// 応答からJSON（{lead, points[]}）を取り出す。```json ブロック優先、無ければ最初の { … } を試す。
function parsePreview(text) {
  if (!text) return null;
  const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/```\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  let raw = m ? m[1] : text;
  raw = raw.trim().replace(/,\s*([}\]])/g, '$1');   // 末尾カンマを除去（JSON.parse失敗の定番要因）
  let obj; try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || !Array.isArray(obj.points)) return null;
  const points = obj.points
    .filter(p => p && typeof p.title === 'string' && typeof p.body === 'string' && p.title.trim() && p.body.trim())
    .map(p => ({ icon: (typeof p.icon === 'string' ? p.icon.trim() : ''), title: p.title.trim(), body: p.body.trim() }))
    .slice(0, 5);
  if (points.length < 2) return null;
  const lead = typeof obj.lead === 'string' ? obj.lead.trim() : '';
  return { lead, points };
}

async function callClaude(prompt) {
  const messages = [{ role: 'user', content: prompt }];
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages })
    });
    if (!res.ok) { console.warn('enrich-matches: API', res.status, (await res.text()).slice(0, 200)); return null; }
    const data = await res.json();
    return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  } catch (e) { console.warn('enrich-matches: 通信エラー（今回はスキップ）:', e.message); return null; }
}

// ネタバレ混入ガード: スコア表記（例 2-1）や、勝敗を「断定」する語があれば不採用にする（安全側）。
// 「敗れれば」「勝てば」等の条件節（前フリで許容）は誤検知しないよう、確定形の結果表現だけを対象にする。
function looksSpoilery(text) {
  if (/\d+\s*[-–—]\s*\d+/.test(text)) return true;                 // スコア
  // 確定形の勝敗表現のみ（条件節・仮定は含めない）
  if (/(敗れた|敗れまし|勝利し|勝利を収め|敗北し|完封し|逆転勝ち|下した|下しまし|破った|破りまし|制した|制しまし|白星|黒星)/.test(text)) return true;
  return false;
}

const added = [];
for (const m of pending) {
  const prompt = buildPrompt(m);
  // JSON解析に失敗しても最大2回まで試す（応答揺れ・稀な整形崩れの救済）。
  let pv = null;
  for (let attempt = 0; attempt < 2 && !pv; attempt++) {
    const raw = await callClaude(prompt);
    await new Promise(r => setTimeout(r, 600));   // レート制限回避の間隔
    if (raw) pv = parsePreview(raw);
  }
  if (!pv) { console.log(`  ✗ スキップ（JSON不正/ポイント不足） ${m.id} ${m.teams.join(' vs ')}`); continue; }
  const combined = [pv.lead, ...pv.points.map(p => p.title + ' ' + p.body)].join(' ');
  if (looksSpoilery(combined)) { console.log(`  ✗ スキップ（ネタバレ疑い） ${m.id} ${m.teams.join(' vs ')}`); continue; }
  PREVIEWS[m.id] = { lead: pv.lead, points: pv.points, teams: m.teams, ts: process.env.RUN_DATE || '' };
  added.push(`${m.id}  ${m.teams.join(' vs ')}（ポイント${pv.points.length}個）`);
}

console.log(`enrich-matches: 対象 ${pending.length}件 / 生成 ${added.length}件`);
added.forEach(a => console.log('  ✓ ' + a));
if (DRY) { console.log('enrich-matches: --dry-run のため書き込みなし。'); process.exit(0); }
if (added.length) writeFileSync(OUT_FILE, JSON.stringify(PREVIEWS, null, 2) + '\n');
