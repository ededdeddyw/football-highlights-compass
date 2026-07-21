// 見どころ記事の品質を全数機械精査する（読み取り専用・データは変更しない）。
// 使い方: node scripts/audit-previews.mjs [--list=カテゴリ] [--code=sa]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const LIST = (args.find(a => a.startsWith('--list=')) || '').split('=')[1] || '';
const CODE = (args.find(a => a.startsWith('--code=')) || '').split('=')[1] || '';

const raw = JSON.parse(readFileSync('data/match-previews.json', 'utf8'));
const P = raw.previews || raw;
let keys = Object.keys(P);
if (CODE) keys = keys.filter(k => k.startsWith(`${CODE}-2526`));

const ICONS = new Set(['speed','pace','goal','playmaker','keeper','shield','duel','star','tactics','history','nation','bond','transfer','stakes','ticket','venue','rising','set_piece','header','key']);

// すり抜けネタバレ（その試合の結果を示唆する語）。既存ガードより広い網。
const SPOILER = /\d+\s*[-–—]\s*\d+|先制|決勝ゴール|決勝点|決勝弾|ハットトリック|追加点|同点(弾|に追|ゴール)|逆転(勝ち|負け|劇|で)|完封|クリーンシート|無失点で|PK戦を制|PKで(決|勝|敗)|土壇場で(決|勝)|白星|黒星|勝ち越|勝点3|勝ち点3|下した|下しま|制した|制しま|破った|破りま|敗れ|勝利(し|を収)|敗北|快勝|辛勝|完勝|大勝/;
// 捏造リスク（LLMが作りがちな具体数値・断定）
const FABRIC = /通算|[0-9０-９]+回目|[0-9０-９]+度目|[0-9０-９]+連勝|[0-9０-９]+連敗|[0-9０-９]+連続|優勝[0-9０-９]+|[0-9０-９]+度の優勝|[0-9０-９]+回優勝|対戦成績|過去[0-9０-９]+|[0-9０-９]+ゴール|[0-9０-９]+得点|得点王|[12][0-9]{3}年|[0-9０-９]+シーズン|[0-9０-９]+勝|直近[0-9０-９]/;
// 汎用フィラー（多用は没個性の兆候）
const FILLER = /特別な一戦|好スタート|勢いをつかみ|見応え|目が離せない|注目の一戦|総力戦|大一番|意地(と|の|を)|プライドを?懸|譲れない|落とせない一戦|白熱|熱戦|好カード|見どころ満載/;

const cats = { spoiler:[], fabric:[], badIcon:[], longBody:[], longTitle:[], fewPoints:[], style:[], emptyLead:[] };
const bodyCount = new Map(), titleCount = new Map(), fillerCount = new Map();

for (const k of keys) {
  const pv = P[k]; if (!pv || !Array.isArray(pv.points)) continue;
  const texts = [pv.lead || '', ...pv.points.map(p => `${p.title||''} ${p.body||''}`)];
  const all = texts.join(' ');
  if (SPOILER.test(all)) cats.spoiler.push([k, (all.match(SPOILER)||[])[0]]);
  if (FABRIC.test(all)) cats.fabric.push([k, (all.match(FABRIC)||[])[0]]);
  const fm = all.match(FILLER); if (fm) fillerCount.set(fm[0], (fillerCount.get(fm[0])||0)+1);
  if (!pv.lead || pv.lead.length < 8) cats.emptyLead.push([k, pv.lead||'']);
  if (pv.points.length < 2) cats.fewPoints.push([k, pv.points.length]);
  for (const p of pv.points) {
    if (!ICONS.has(p.icon)) cats.badIcon.push([k, p.icon]);
    if ((p.body||'').length > 78) cats.longBody.push([k, (p.body||'').length]);
    if ((p.title||'').length > 22) cats.longTitle.push([k, (p.title||'').length]);
    bodyCount.set(p.body, (bodyCount.get(p.body)||0)+1);
    titleCount.set(p.title, (titleCount.get(p.title)||0)+1);
  }
  // 文体混在: ですます と である/だ の同居
  const desu = /です。|ます。|でしょう|ました。/.test(all);
  const dearu = /である。|だ。|だった。/.test(all);
  if (desu && dearu) cats.style.push([k, 'ですます×である混在']);
}

const dupBodies = [...bodyCount.entries()].filter(([b,c]) => c >= 5 && b).sort((a,b)=>b[1]-a[1]);
const dupTitles = [...titleCount.entries()].filter(([t,c]) => c >= 8 && t).sort((a,b)=>b[1]-a[1]);

console.log(`=== 見どころ品質精査（対象 ${keys.length}本${CODE?` / ${CODE}`:''}）===\n`);
console.log(`【ネタバレすり抜け疑い】 ${cats.spoiler.length}件`);
console.log(`【事実捏造リスク（具体数値/断定）】 ${cats.fabric.length}件`);
console.log(`【無効アイコン】 ${cats.badIcon.length}件`);
console.log(`【本文が長い(>78字)】 ${cats.longBody.length}件`);
console.log(`【見出しが長い(>22字)】 ${cats.longTitle.length}件`);
console.log(`【ポイント数<2】 ${cats.fewPoints.length}件`);
console.log(`【lead空/短すぎ】 ${cats.emptyLead.length}件`);
console.log(`【文体混在】 ${cats.style.length}件`);
console.log(`\n【本文の使い回し(5回以上・上位15)】`);
dupBodies.slice(0,15).forEach(([b,c]) => console.log(`  ${c}回: ${b}`));
console.log(`  …計 ${dupBodies.length}種類の本文が5回以上使い回し`);
console.log(`\n【見出しの使い回し(8回以上・上位15)】`);
dupTitles.slice(0,15).forEach(([t,c]) => console.log(`  ${c}回: ${t}`));
console.log(`\n【汎用フィラー語の出現】`);
[...fillerCount.entries()].sort((a,b)=>b[1]-a[1]).forEach(([w,c]) => console.log(`  ${c}回: ${w}`));

if (LIST && cats[LIST]) {
  console.log(`\n=== ${LIST} 全リスト ===`);
  cats[LIST].forEach(([k,v]) => console.log(`  ${k}  →  ${v}`));
}
