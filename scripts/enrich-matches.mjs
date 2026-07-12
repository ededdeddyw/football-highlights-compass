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
  return `あなたは日本語のサッカーメディアの編集者です。次の試合について、読者が試合をより楽しめる「前フリの解説記事」を書いてください。

対戦: ${teams}
大会: ${comp}
${metaLine}${jp}

記事の要件:
- 日本語で、360〜480文字程度。段落は2〜3個（段落は空行で区切る）。
- 内容は「両チーム・両国の背景」「この大会・ラウンドでの位置づけや見どころ」「注目される選手や特徴」を中心に、読者が試合の背景を理解できるようにする。
- **この試合が大会の中でどんな一戦か（位置づけと懸かっているもの）を必ず盛り込む**。ただし前の試合の結果や現在の順位・勝ち点など、結果が分かる情報は書かない（ネタバレ防止）。勝敗の両方のシナリオを一般論として示し、どちらの状況かは断定しない。ラウンド別の書き分けは次のとおり:
  - グループステージ第1節（初戦）: 大会の入り口として、勢いをつけたい重要な一戦であること。
  - グループステージ第2節・第3節: 「勝てば決勝トーナメント進出に近づき、取りこぼせば苦しくなる」という、勝敗によって明暗が分かれる節目であること（第3節ならグループ突破が懸かる大一番になりうること）。
  - 決勝トーナメント（ラウンド16・準々決勝・準決勝・決勝など）: 敗れれば終わりの一発勝負であり、勝ち上がりを懸けた緊張感の高い試合であること。
- **結果には一切触れない**（スコア、勝敗、どちらが勝ったか、得点者、PKの行方などを書かない）。試合前の紹介として書く。ネタバレ防止がこのサイトの約束です。
- 一般に知られている確かな文脈だけを書く。具体的な数字・日付・スタメン・発言・その大会での個々の試合結果など、確証のない情報は創作しない。分からないことは書かない。
- 宣伝文句や誇張を避け、落ち着いた紹介の筆致にする。同じ文末（「注目が集まります」等）を繰り返さず、表現に変化をつける。

${styleDirective}

出力は記事本文のみ（見出しや前置き、マークダウン記法は付けない）。`;
}

async function callClaude(prompt) {
  const messages = [{ role: 'user', content: prompt }];
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, messages })
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
  const text = await callClaude(buildPrompt(m));
  await new Promise(r => setTimeout(r, 600));   // レート制限回避の間隔
  if (!text) continue;
  if (looksSpoilery(text)) { console.log(`  ✗ スキップ（ネタバレ疑い） ${m.id} ${m.teams.join(' vs ')}`); continue; }
  if (text.length < 120) { console.log(`  ✗ スキップ（短すぎ） ${m.id}`); continue; }
  PREVIEWS[m.id] = { text, teams: m.teams, ts: process.env.RUN_DATE || '' };
  added.push(`${m.id}  ${m.teams.join(' vs ')}（${text.length}字）`);
}

console.log(`enrich-matches: 対象 ${pending.length}件 / 生成 ${added.length}件`);
added.forEach(a => console.log('  ✓ ' + a));
if (DRY) { console.log('enrich-matches: --dry-run のため書き込みなし。'); process.exit(0); }
if (added.length) writeFileSync(OUT_FILE, JSON.stringify(PREVIEWS, null, 2) + '\n');
