// W杯 決勝トーナメントのハイライト自動連携（APIキー不要・依存追加なし）
// 使い方: node scripts/watch-knockout.mjs [--dry-run]
//  - data/wc-knockout.json の「結果は確定済み・videoId未設定」の試合だけを対象にする
//    （結果は毎朝タスクがWeb検証で先に埋める前提。未消化/未検証はスキップ）
//  - 許可した公式チャンネル（FOX Sports / DAZN Japan / FIFA 等）を YouTube検索で照合し、
//    公式ハイライト/RECAP動画を厳格マッチング（両チーム名＋ラウンド語＋ハイライト系＋許可ch）
//    （ネタバレ防止＝タイトルにスコアを含む動画は採用しない。FOXの "X vs Y Highlights | Round of 16" 等はスコア非表示でOK）
//  - 確定 → wc-knockout.json の videoId を更新 ＋ index.html の /*WC_KO_AUTO*/ ブロックを再生成
//  - スコアは build-site.mjs が wc-knockout.json から自動導出（scores.json 手動記録は不要）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DRY = process.argv.includes('--dry-run');
// 診断モード: 動画が見つからない試合について、候補タイトル/投稿者/棄却理由を出力（原因切り分け用）。
// 環境変数 WATCH_DIAG=1 でも有効。既定OFF（通常運用のログを汚さない）。
const DIAG = process.argv.includes('--diag') || process.env.WATCH_DIAG === '1';
const readJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const KO_FILE = 'data/wc-knockout.json';
const IDX_FILE = 'site/index.html';
const WCKO = readJson(KO_FILE, {});
const TEAMS = readJson('data/team-names.json', {});
// 許可チャンネル（DAZN Japan等）。author_name 一致でも二重に担保
const CHANNELS = (readJson('data/wc2026-channels.json', { channels: [] }).channels || []).filter(c => c.enabled);
const CHANNEL_NAMES = new Set(CHANNELS.map(c => c.name).filter(Boolean));

// ラウンド定義：meta表示ラベル・検索クエリ語・タイトル判定キーワード
const ROUNDS = {
  r32:   { label: 'ラウンド32', q: 'ラウンド32',            match: t => /ラウンド\s*32|round of 32/i.test(t) },
  r16:   { label: 'ラウンド16', q: 'ラウンド16',            match: t => /ラウンド\s*16|ベスト\s*16|round of 16/i.test(t) },
  qf:    { label: '準々決勝',   q: '準々決勝',              match: t => /準々決勝|クォーターファイナル|quarter[- ]?final/i.test(t) },
  sf:    { label: '準決勝',     q: '準決勝',                match: t => /準決勝|セミファイナル|semi[- ]?final/i.test(t) },
  third: { label: '3位決定戦', q: '3位決定戦',            match: t => /3位決定戦|三位決定戦|third[- ]?place/i.test(t) },
  final: { label: '決勝',       q: '決勝 FIFAワールドカップ', match: t => /決勝/.test(t) && !/準決勝|準々決勝|決勝トーナメント/.test(t) },
};

// 既出 videoId（重複排除）：wc-knockout の全 videoId ＋ index.html の全 id
const idxHtml = existsSync(IDX_FILE) ? readFileSync(IDX_FILE, 'utf8') : '';
const knownIds = new Set([...idxHtml.matchAll(/id:"([A-Za-z0-9_-]{6,})"/g)].map(m => m[1]));
for (const k of Object.keys(WCKO)) if (Array.isArray(WCKO[k])) for (const f of WCKO[k]) if (f.videoId) knownIds.add(f.videoId);

const norm = s => (s || '').toLowerCase().replace(/\s+/g, '');
// 日本語名・英語名・別名(alt)すべてで照合（例: アメリカ=USA/United States、モロッコ=Morocco/Maroc）。
// FOX等の英語タイトルは "United States" 表記なので alt を含めないと取りこぼす。
const variants = ja => { const t = TEAMS[ja] || {}; return [ja, t.en, ...(t.alt || [])].filter(Boolean).map(norm); };

// YouTube検索（HTMLの ytInitialData から videoId を抽出・APIキー不要）
async function searchIds(query) {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36', 'accept-language': 'ja' } });
    if (!r.ok) return [];
    const html = await r.text();
    const seg = html.slice(Math.max(0, html.indexOf('ytInitialData')));
    const ids = []; const seen = new Set();
    for (const m of seg.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) { if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); } }
    return ids.slice(0, 15);
  } catch (e) { console.warn(`検索失敗 [${query}]: ${e.message}`); return []; }
}
// oEmbed でタイトル・投稿者を確定
async function meta(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`);
    if (!r.ok) return null;
    const j = await r.json();
    return { title: j.title || '', author: j.author_name || '' };
  } catch { return null; }
}

const esc = s => (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const confirmed = [];

for (const key of Object.keys(ROUNDS)) {
  const arr = WCKO[key]; if (!Array.isArray(arr)) continue;
  const R = ROUNDS[key];
  for (const f of arr) {
    if (f.videoId) continue;              // 既に連携済み
    if (!f.home || !f.away) continue;     // 両チーム未確定はスキップ
    // 結果(result)は不問：公式RECAPは試合後にしか存在しないため、動画が見つかった＝試合済み。
    //   結果検証(APIキー)を待たずに動画を即掲載＝鮮度優先。スコアは既定で隠れる（ネタバレ防止）ので後追いでOK。
    const hv = variants(f.home), av = variants(f.away);
    const ids = await searchIds(`${f.home} ${f.away} ${R.q} MATCH RECAP`);
    let hit = null; const rejects = [];
    for (const id of ids) {
      if (knownIds.has(id)) { rejects.push(`既出id ${id}`); continue; }
      const mt = await meta(id); await sleep(120);
      if (!mt) { rejects.push(`meta取得失敗 ${id}`); continue; }
      const t = norm(mt.title);
      const homeHit = hv.some(v => v && t.includes(v));
      const awayHit = av.some(v => v && t.includes(v));
      // ネタバレ防止の本質＝「タイトルにスコアを含まない」こと（例: FIFAの "Canada 0-3 Morocco" は除外）。
      //   公式RECAP/Highlights はタイトルにスコアを出さない（FOX "X vs Y Highlights | Round of 16" 等）。
      //   → "recap" 限定をやめ、recap/highlights/ハイライト を許可しつつ、スコア表記があれば棄却する。
      const isType = /recap|highlights|ハイライト/i.test(mt.title);       // ハイライト系動画か
      const hasScore = /\d+\s*[-–—]\s*\d+/.test(mt.title);              // スコア(例 2-1)を含む＝ネタバレ
      // 各ゲートの合否を記録（診断用）。棄却理由が一目で分かるようにする。
      const gate = !homeHit ? 'homeチーム名なし' : !awayHit ? 'awayチーム名なし'
        : !R.match(mt.title) ? 'ラウンド語なし' : !isType ? 'ハイライト/recap語なし'
        : hasScore ? 'スコア含む(ネタバレ)'
        : (CHANNEL_NAMES.size && !CHANNEL_NAMES.has(mt.author)) ? `非許可ch(${mt.author})` : 'OK';
      if (gate !== 'OK') { rejects.push(`✗ ${gate} | ${mt.author} | ${mt.title}`); continue; }
      hit = { id, title: mt.title, author: mt.author }; break;
    }
    if (hit) { f.videoId = hit.id; knownIds.add(hit.id); confirmed.push({ key, home: f.home, away: f.away, ...hit }); }
    else if (DIAG) {
      console.log(`  [診断] ${key} ${f.home} vs ${f.away}: 候補${ids.length}件・不採用`);
      rejects.slice(0, 6).forEach(r => console.log('      ' + r));
    }
  }
}

// index.html の /*WC_KO_AUTO*/ ブロックを wc-knockout.json の全 videoId から再生成（冪等）
function buildKoBlock() {
  const items = [];
  for (const key of Object.keys(ROUNDS)) {
    const arr = WCKO[key]; if (!Array.isArray(arr)) continue;
    const R = ROUNDS[key];
    for (const f of arr) {
      if (!f.videoId) continue;
      const pk = f.pk ? '・PK戦決着' : '';
      const meta = `FIFAワールドカップ26｜決勝トーナメント ${R.label}${pk}（MATCH RECAP）`;
      const jp = (f.home === '日本' || f.away === '日本') ? ', jp:"日本代表"' : '';
      items.push(`  {ttl:"${esc(f.home)} vs ${esc(f.away)}", meta:"${esc(meta)}"${jp}, id:"${esc(f.videoId)}"}`);
    }
  }
  return items;
}

console.log(`watch-knockout: 確定 ${confirmed.length}件`);
confirmed.forEach(c => console.log(`  ✓ [${c.key}] ${c.home} vs ${c.away} → ${c.id}  ${c.title}`));

if (DRY) { console.log('watch-knockout: --dry-run のため書き込みなし。'); process.exit(0); }

// wc-knockout.json 更新（videoId反映）
if (confirmed.length) writeFileSync(KO_FILE, JSON.stringify(WCKO, null, 2) + '\n');

// index.html KOブロック再生成（マーカー必須）
const START = '/*WC_KO_AUTO_START*/', END = '/*WC_KO_AUTO_END*/';
if (!idxHtml.includes(START) || !idxHtml.includes(END)) { console.error('マーカー /*WC_KO_AUTO_START|END*/ が index.html に見つかりません。'); process.exit(1); }
const items = buildKoBlock();
const body = `${START}\nvar EXTRA_WC_KO_AUTO = [\n${items.join(',\n')}${items.length ? '\n' : ''}];\nEXTRA_WC.push.apply(EXTRA_WC, EXTRA_WC_KO_AUTO);\n${END}`;
const re = new RegExp(START.replace(/[*/]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[*/]/g, '\\$&'));
writeFileSync(IDX_FILE, idxHtml.replace(re, body));
console.log(`watch-knockout: KOブロック ${items.length}件を index.html に反映。`);
