// プレシーズン(親善試合)取得のための下準備：既存クラブ(scripts/entities.mjs の CLUBS)を
// TheSportsDB のチームIDに解決し、data/club-tsdb-ids.json に保存する。
// eventsnext.php / eventslast.php はチームID単位の取得のため、リーグ戦だけでなく
// 親善試合・プレシーズンツアーも拾える（fetch-preseason.mjs で使用）。
//
// 既にサイトで使っている data/club-crests.json のエンブレムURL（＝表示確認済みの正しいクラブ）と
// strTeamBadge を突き合わせ、一致すれば confirmed:true として自動確定。一致しない/複数候補の場合は
// candidates を列挙するので、data/club-tsdb-ids.json を手動で見直してから fetch-preseason.mjs を使う。
//
// 使い方: node scripts/resolve-team-ids.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { CLUBS } from './entities.mjs';

const readJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };
const CRESTS = readJson('data/club-crests.json', {});
const sleep = ms => new Promise(r => setTimeout(r, ms));

// slug → TheSportsDB検索語。基本は slug をタイトルケース化するが、略称・愛称ずれのあるものは上書き。
const OVERRIDES = {
  'psg': 'Paris Saint-Germain',
  'bayern-munich': 'Bayern Munich',
  'marseille': 'Marseille',
  'benfica': 'Benfica',
  'urawa-reds': 'Urawa Red Diamonds',
  'inter': 'Inter Milan',
  'fc-barcelona': 'Barcelona',
  'atletico-madrid': 'Atletico Madrid',
};
const titleCase = slug => OVERRIDES[slug] || slug.split('-').map(w => /^\d+$/.test(w) ? w : w[0].toUpperCase() + w.slice(1)).join(' ');

async function searchTeam(name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(name)}`, { headers: { accept: 'application/json' } });
      if (r.ok) { const j = await r.json(); return j.teams || []; }
      if (r.status === 429) { await sleep(3000); continue; }
      return [];
    } catch { await sleep(1500); }
  }
  return [];
}

async function main() {
  const out = readJson('data/club-tsdb-ids.json', {});
  let ok = 0, ambiguous = 0, notfound = 0;
  for (const [ja, info] of Object.entries(CLUBS)) {
    const q = titleCase(info.slug);
    const teams = await searchTeam(q);
    const crest = CRESTS[info.slug];
    const soccer = teams.filter(t => (t.strSport || '').toLowerCase() === 'soccer');
    const exact = soccer.find(t => t.strTeamBadge && crest && t.strTeamBadge === crest);
    const pick = exact || (soccer.length === 1 ? soccer[0] : null);
    if (pick) {
      out[info.slug] = { idTeam: pick.idTeam, strTeam: pick.strTeam, confirmed: !!exact };
      ok++;
      console.log(`${ja} (${q}) → ${pick.strTeam} #${pick.idTeam}${exact ? ' [crest一致=確定]' : ' [単一候補]'}`);
    } else {
      out[info.slug] = { idTeam: null, candidates: soccer.map(t => ({ idTeam: t.idTeam, strTeam: t.strTeam, strCountry: t.strCountry, strLeague: t.strLeague })) };
      if (soccer.length) ambiguous++; else notfound++;
      console.log(`${ja} (${q}) → ${soccer.length ? `候補${soccer.length}件（要確認）` : '該当なし'}`);
    }
    await sleep(350);
  }
  writeFileSync('data/club-tsdb-ids.json', JSON.stringify(out, null, 2));
  console.log(`\n確定/単一候補: ${ok} / 要確認(複数候補): ${ambiguous} / 該当なし: ${notfound} / 全${Object.keys(CLUBS).length}`);
}
main();
