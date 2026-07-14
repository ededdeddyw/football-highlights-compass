// 五大リーグの日程・結果を取得して data/league-<code>.json に正規化保存する。
// フェーズ1（ブンデス）は OpenLigaDB（無料・APIキー不要）を使用。将来 football-data.org 等に拡張可。
// 使い方: node scripts/fetch-league.mjs bl 2025     （bl=ブンデス, 2025=2025-26シーズン）
// 出力: data/league-bl-2025.json  … [{matchday, dateUTC, homeDe, awayDe, home, away, finished, score, videoId}]
//   - home/away は data/league-teams.json の de→ja 対応表で日本語化（未登録はドイツ語のまま＋警告）。
//   - score は完了試合のみ "H-A"（未完了は ""）。ネタバレはページ側でマスクするのでデータには持つ。
//   - videoId は空で作り、後段（watch-league）が公式ハイライトを紐付ける。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [,, codeArg, seasonArg] = process.argv;
const CODE = (codeArg || 'bl').toLowerCase();
const SEASON = seasonArg || '2025';
const readJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };

// リーグ定義：OpenLigaDBのshortcut等。まずはブンデスのみ。
const LEAGUES = {
  bl: { openliga: 'bl1', jp: 'ブンデスリーガ' },
};
const L = LEAGUES[CODE];
if (!L) { console.error(`未対応リーグ: ${CODE}`); process.exit(1); }

const TEAMS = readJson('data/league-teams.json', {});   // { "FC Bayern München": "バイエルン", ... }
const ja = de => TEAMS[de] || null;

async function fetchOpenLiga() {
  const url = `https://api.openligadb.de/getmatchdata/${L.openliga}/${SEASON}`;
  const r = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!r.ok) throw new Error(`OpenLigaDB HTTP ${r.status}`);
  const arr = await r.json();
  const out = []; const unknown = new Set();
  for (const m of arr) {
    const homeDe = m.team1?.teamName || '';
    const awayDe = m.team2?.teamName || '';
    const md = m.group?.groupOrderID ?? null;                 // 節（数値）
    const dateUTC = m.matchDateTimeUTC || m.matchDateTime || '';
    const finished = !!m.matchIsFinished;
    // 最終結果（resultTypeID===2 = Endergebnis）を優先、無ければ最後の要素
    let score = '';
    if (finished) {
      const rs = Array.isArray(m.matchResults) ? m.matchResults : [];
      const fin = rs.find(x => x.resultTypeID === 2) || rs[rs.length - 1];
      if (fin && fin.pointsTeam1 != null && fin.pointsTeam2 != null) score = `${fin.pointsTeam1}-${fin.pointsTeam2}`;
    }
    const hj = ja(homeDe), aj = ja(awayDe);
    if (!hj) unknown.add(homeDe);
    if (!aj) unknown.add(awayDe);
    out.push({ matchday: md, dateUTC, homeDe, awayDe, home: hj || homeDe, away: aj || awayDe, finished, score, videoId: '' });
  }
  out.sort((a, b) => (a.matchday - b.matchday) || String(a.dateUTC).localeCompare(String(b.dateUTC)));
  return { out, unknown: [...unknown] };
}

const { out, unknown } = await fetchOpenLiga();
const OUT = `data/league-${CODE}-${SEASON}.json`;
writeFileSync(OUT, JSON.stringify({ code: CODE, jp: L.jp, season: SEASON, updated: '', matches: out }, null, 2) + '\n');
const fin = out.filter(m => m.finished).length;
console.log(`fetch-league ${CODE} ${SEASON}: ${out.length}試合（完了 ${fin} / 未消化 ${out.length - fin}）→ ${OUT}`);
if (unknown.length) {
  console.log(`⚠ 日本語名 未登録 ${unknown.length}件（data/league-teams.json に追記してください）:`);
  unknown.forEach(t => console.log(`    "${t}": "",`));
}
