// ============================================================================
// U-NEXT フットボール（@UNEXT_football）のプレミアリーグ公式ショートハイライトを
// 取得して data/league-pl-<season>.json の各試合に videoId を突合して埋めるスクリプト。
//
// ★ なぜ「あなたの日本の端末」で実行するのか
//   U-NEXTのハイライトは日本限定公開。GitHub Actions（米国サーバ）からは動画が
//   一切見えない（実証済み：チャンネルページは開けるが動画0件）。日本のあなたの端末
//   なら普通に見えるので、ここで取得すればVPN無しで確実に拾える。
//
// ★ 誤リンク防止（突合の担保）
//   U-NEXTのタイトル「【HOME v AWAY｜ショートハイライト】プレミアリーグ2026/27 第N節」
//   から HOME/AWAY・節・シーズンを取り出し、既存の日程表データ（home/away/matchday/
//   season）と一致した試合にだけ videoId を入れる。両チーム名＋（あれば）節番号＋
//   現行シーズンが揃わないと採用しない。
//
// ★ 使い方（Node 18以降が必要。リポジトリのルートで実行）
//   node scripts/fetch-unext-pl.mjs                # 現行シーズンを自動判定して更新
//   node scripts/fetch-unext-pl.mjs --season=2026  # シーズン開始年を明示（2026=2026/27）
//   node scripts/fetch-unext-pl.mjs --dry-run      # 書き込まず結果だけ表示
//   node scripts/fetch-unext-pl.mjs --keep-existing # U-NEXTで拾えなかった既存videoIdを消さない
//   実行後: git add data/league-pl-*.json && git commit && git push で本番に反映されます。
// ============================================================================
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const KEEP = args.includes('--keep-existing');
const SEASON_ARG = (args.find(a => a.startsWith('--season=')) || '').split('=')[1] || '';
const HANDLE = '@UNEXT_football';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 現行シーズン開始年（欧州は7月以降を新シーズン扱い）。--season 指定があればそれ。
const now = new Date();
const CUR_START = SEASON_ARG ? +SEASON_ARG : ((now.getUTCMonth() + 1) >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);

// ---- 正規化・チーム名突合（watch-league と同じ考え方。日本語名も含めて畳む）----
const ALIASES = (() => { try { return JSON.parse(readFileSync('data/league-team-aliases.json', 'utf8')); } catch { return {}; } })();
const fold = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const nsp = s => fold(s).toLowerCase().replace(/[\s・･‐-‒–—―.,'’`｜|()（）]/g, '');
const variants = ja => [ja, ...(ALIASES[ja] || [])].map(nsp).filter(v => v.length >= 2);
// トークン（U-NEXTタイトル中のチーム表記）が、日程表のチーム ja に一致するか（部分一致・双方向）
const teamMatch = (ja, token) => { const t = nsp(token); if (!t) return false; return variants(ja).some(v => t === v || t.includes(v) || v.includes(t)); };

// ---- YouTube: チャンネル投稿一覧を取得（初期ページ＋継続ページで最大~150本）----
function braceJson(html, marker) {
  const i = html.indexOf(marker); if (i < 0) return null;
  const start = html.indexOf('{', i); if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { if (--depth === 0) return html.slice(start, j + 1); }
  }
  return null;
}
function walkVideos(node, out, seen) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const x of node) walkVideos(x, out, seen); return; }
  const vr = node.videoRenderer || node.gridVideoRenderer;
  if (vr && vr.videoId) {
    const id = vr.videoId;
    const title = (vr.title && (vr.title.runs ? vr.title.runs.map(r => r.text).join('') : vr.title.simpleText)) || '';
    if (!seen.has(id)) { seen.add(id); out.push({ id, title }); }
  }
  for (const k in node) walkVideos(node[k], out, seen);
}
function findToken(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.continuationItemRenderer) {
    const t = node.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token;
    if (t) return t;
  }
  for (const k in node) { const t = findToken(node[k]); if (t) return t; }
  return null;
}
async function channelVideos() {
  const r = await fetch(`https://www.youtube.com/${HANDLE}/videos?hl=ja&gl=JP`, { headers: { 'user-agent': UA, 'accept-language': 'ja-JP,ja;q=0.9' } });
  if (!r.ok) throw new Error(`チャンネル取得に失敗: HTTP ${r.status}`);
  const html = await r.text();
  const key = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
  const ver = (html.match(/"clientVersion":"([^"]+)"/) || [])[1] || '2.20240101.00.00';
  const data = JSON.parse(braceJson(html, 'ytInitialData'));
  const out = [], seen = new Set();
  walkVideos(data, out, seen);
  let token = findToken(data), pages = 0;
  while (token && key && pages < 5 && out.length < 150) {
    pages++;
    const cr = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${key}&prettyPrint=false`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA, 'accept-language': 'ja' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: ver, hl: 'ja', gl: 'JP' } }, continuation: token })
    });
    if (!cr.ok) break;
    const cj = await cr.json();
    const before = out.length; walkVideos(cj, out, seen); token = findToken(cj);
    if (out.length === before) break;
    await new Promise(r => setTimeout(r, 400));
  }
  return out;
}

// ---- タイトル解析：「【HOME v AWAY｜…】…第N節…プレミアリーグ2026/27」----
function parseTitle(title) {
  const isPL = /プレミアリーグ|premier\s*league/i.test(title);
  const isHi = /ハイライト|highlight/i.test(title);
  const md = (title.match(/第\s*0*(\d+)\s*節/) || [])[1];
  const sm = title.match(/20(\d\d)\s*[\/\-]\s*(\d{2})/);            // 2026/27 → 開始年2026
  const seasonStart = sm ? 2000 + (+sm[1]) : null;
  const br = title.match(/[【\[]([^】\]]+)[】\]]/);                  // 【 】内
  const teamsPart = (br ? br[1] : title).split(/[｜|]/)[0];         // ｜より前（ショート/ロングハイライト等を除去）
  const vs = teamsPart.split(/\s*(?:vs?\.?|×|✕|ｖｓ|対)\s*/i);
  if (vs.length < 2) return { isPL, isHi, md: md ? +md : null, seasonStart, home: null, away: null };
  return { isPL, isHi, md: md ? +md : null, seasonStart, home: vs[0].trim(), away: vs[1].trim() };
}

// ---- 実行 ----
const vids = await channelVideos();
console.log(`U-NEXT(@UNEXT_football) 投稿取得: ${vids.length}本`);
const parsed = vids.map(v => ({ ...v, p: parseTitle(v.title) }))
  .filter(v => v.p.isPL && v.p.isHi && v.p.home && v.p.away && (v.p.seasonStart == null || v.p.seasonStart === CUR_START));
console.log(`うちプレミア・現行シーズン(${CUR_START}/${String((CUR_START + 1) % 100).padStart(2, '0')})のハイライト候補: ${parsed.length}本`);

const files = readdirSync('data').filter(n => /^league-pl-\d{4}\.json$/.test(n))
  .filter(n => n.endsWith(`-${CUR_START}.json`));
if (!files.length) { console.error(`対象ファイルが見つかりません（data/league-pl-${CUR_START}.json）。--season を確認してください。`); process.exit(1); }

let filled = 0, replaced = 0, cleared = 0; const used = new Set(); const unmatchedVids = [];
for (const f of files) {
  const path = `data/${f}`; const j = JSON.parse(readFileSync(path, 'utf8'));
  for (const m of (j.matches || [])) {
    if (!m.finished || m.matchday == null || !m.home || !m.away) continue;
    // この試合に一致するU-NEXT動画を探す（両オリエンテーション・節番号があれば一致必須）
    const hit = parsed.find(v => used.has(v.id) ? false : (
      ((teamMatch(m.home, v.p.home) && teamMatch(m.away, v.p.away)) ||
       (teamMatch(m.home, v.p.away) && teamMatch(m.away, v.p.home)))
      && (v.p.md == null || v.p.md === m.matchday)
    ));
    if (hit) {
      used.add(hit.id);
      if (m.videoId === hit.id) { /* 変更なし */ }
      else if (m.videoId) { m.videoId = hit.id; replaced++; }
      else { m.videoId = hit.id; filled++; }
    } else if (m.videoId && !KEEP) {
      // U-NEXTで拾えなかった既存videoId（＝日本で見られないNBC等）は既定でクリア
      m.videoId = ''; cleared++;
    }
  }
  if (!DRY) writeFileSync(path, JSON.stringify(j, null, 2) + '\n');
  const withV = (j.matches || []).filter(m => m.videoId).length;
  const finN = (j.matches || []).filter(m => m.finished).length;
  console.log(`${path}: 完了${finN}試合中 videoId付き ${withV}件`);
}
// 突合できなかったU-NEXT動画（日程表に無い＝表記ゆれ/カップ戦等）を表示（要確認）
for (const v of parsed) if (!used.has(v.id)) unmatchedVids.push(v);
console.log(`\n新規${filled} / 差し替え${replaced} / クリア（日本再生不可の既存を除去）${cleared}`);
if (unmatchedVids.length) {
  console.log(`\n⚠ 日程表と突合できなかったU-NEXT動画 ${unmatchedVids.length}件（表記ゆれ等・要確認）:`);
  unmatchedVids.slice(0, 15).forEach(v => console.log(`   ${v.id}  ${v.title}`));
  console.log('   → 一致すべき試合があれば data/league-team-aliases.json に日本語別名を足すと拾えます。');
}
console.log(DRY ? '\n(--dry-run: 書き込みなし)' : '\n書き込み完了。git add/commit/push で本番反映されます。');
