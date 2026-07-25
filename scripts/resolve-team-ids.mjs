// プレシーズン(親善試合)取得のための下準備：既存クラブ(scripts/entities.mjs の CLUBS)を
// TheSportsDB のチームIDに解決し、data/club-tsdb-ids.json に保存する。
// eventsnext.php / eventslast.php はチームID単位の取得のため、リーグ戦だけでなく
// 親善試合・プレシーズンツアーも拾える（fetch-preseason.mjs で使用）。
//
// 既にサイトで使っている data/club-crests.json のエンブレムURL（＝表示確認済みの正しいクラブ）と
// strTeamBadge を突き合わせ、一致すれば confirmed:true として自動確定。一致しない/複数候補の場合は
// candidates を列挙するので、data/club-tsdb-ids.json を手動で見直してから fetch-preseason.mjs を使う。
// 女子/育成/リザーブ扱いのチームは（1件しかヒットしなくても）自動採用しない。
// 注意: 「候補1件」の自動採用も無条件には信用できないことが分かっている
// （実例：マインツ→女子チーム、ACミラン→育成、ポルト→育成、PSG→無関係の
// 小クラブ Torcy を誤採用）。strCountry/strLeague を必ず出力するので、
// 特に強豪クラブは目視で確認してから fetch-preseason.mjs に進むこと。
//
// 無料公開キーの searchteams.php は1実行あたり ~30件でレート制限にかかることがある。
// 既に解決済みのクラブはスキップして再実行で続きから進められる（--force で再解決）。
//
// 使い方: node scripts/resolve-team-ids.mjs [--force]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { CLUBS } from './entities.mjs';

const FORCE = process.argv.includes('--force');
const readJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };
const CRESTS = readJson('data/club-crests.json', {});
const sleep = ms => new Promise(r => setTimeout(r, ms));

// slug → TheSportsDB検索語。基本は slug をタイトルケース化するが、略称・愛称ずれのあるものは上書き。
const OVERRIDES = {
  'bayern-munich': 'Bayern Munich',
  'marseille': 'Marseille',
  'benfica': 'Benfica',
  'urawa-reds': 'Urawa Red Diamonds',
  'inter': 'Inter Milan',
  'fc-barcelona': 'Barcelona',
  'atletico-madrid': 'Atletico Madrid',
  'as-monaco': 'Monaco',
  'ac-milan': 'AC Milan',
  'mainz-05': 'FSV Mainz 05',
  'fc-porto': 'Porto',
  'psg': 'Paris Saint-Germain',
};
const titleCase = slug => OVERRIDES[slug] || slug.split('-').map(w => /^\d+$/.test(w) ? w : w[0].toUpperCase() + w.slice(1)).join(' ');
// トップチーム以外（女子/育成/リザーブ/フットサル等）を除外
const NOT_TOP_TEAM = /\bwomen'?s?\b|\bladies\b|\bfemin|\byouth\b|\bjuniors?\b|\breserves?\b|\bacademy\b|\bU-?\d{2}\b/i;

async function searchTeam(name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(name)}`, { headers: { accept: 'application/json' } });
      if (r.ok) { const j = await r.json(); return { teams: j.teams || [], limited: false }; }
      if (r.status === 429) { console.log(`  （429レート制限。65秒待機して再試行 ${attempt}/3）`); await sleep(65000); continue; }
      return { teams: [], limited: false };
    } catch { await sleep(1500); }
  }
  return { teams: [], limited: true };
}

async function main() {
  const out = readJson('data/club-tsdb-ids.json', {});
  let ok = 0, ambiguous = 0, notfound = 0, skipped = 0, limitedOut = 0;
  for (const [ja, info] of Object.entries(CLUBS)) {
    if (!FORCE && out[info.slug]?.idTeam) { skipped++; continue; }
    const q = titleCase(info.slug);
    const { teams, limited } = await searchTeam(q);
    if (limited) {
      console.log(`${ja} (${q}) → レート制限で断念（再実行で再試行されます）`);
      limitedOut++;
      continue;
    }
    const crest = CRESTS[info.slug];
    const soccer = teams.filter(t => (t.strSport || '').toLowerCase() === 'soccer' && !NOT_TOP_TEAM.test(t.strTeam || ''));
    const exact = soccer.find(t => t.strTeamBadge && crest && t.strTeamBadge === crest);
    const pick = exact || (soccer.length === 1 ? soccer[0] : null);
    if (pick) {
      out[info.slug] = { idTeam: pick.idTeam, strTeam: pick.strTeam, strCountry: pick.strCountry || '', strLeague: pick.strLeague || '', confirmed: !!exact };
      ok++;
      console.log(`${ja} (${q}) → ${pick.strTeam} #${pick.idTeam} [${pick.strCountry || '?'}/${pick.strLeague || '?'}]${exact ? ' [crest一致=確定]' : ' [単一候補・要目視確認]'}`);
    } else {
      out[info.slug] = { idTeam: null, candidates: soccer.map(t => ({ idTeam: t.idTeam, strTeam: t.strTeam, strCountry: t.strCountry, strLeague: t.strLeague })) };
      if (soccer.length) ambiguous++; else notfound++;
      console.log(`${ja} (${q}) → ${soccer.length ? `候補${soccer.length}件（要確認）` : '該当なし'}`);
    }
    await sleep(600);
  }
  writeFileSync('data/club-tsdb-ids.json', JSON.stringify(out, null, 2));
  console.log(`\n新規確定/単一候補: ${ok} / 要確認(複数候補): ${ambiguous} / 該当なし: ${notfound} / スキップ(解決済み): ${skipped} / レート制限で断念: ${limitedOut} / 全${Object.keys(CLUBS).length}`);
  const stillMissing = Object.entries(out).filter(([, v]) => !v.idTeam).map(([slug]) => slug);
  if (stillMissing.length) console.log(`未解決: ${stillMissing.join(', ')}（再実行するかOVERRIDESに検索語を追加してください）`);
}
main();
