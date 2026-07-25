// プレシーズン（親善試合・プレシーズンツアー）の日程・結果を取得して
// data/preseason-<season>.json に正規化保存する。
//
// 五大リーグ/Jリーグのようにリーグ全体を1つのIDで取得できないため、
// resolve-team-ids.mjs で解決した data/club-tsdb-ids.json のチームID単位で
// TheSportsDB の eventsnext.php（今後の予定）／eventslast.php（直近結果）を叩き、
// strLeague が「親善試合」を示すイベントだけを拾う。
//
// 無料公開キーは1実行あたり~30リクエストでレート制限(429)にかかることがある
// （resolve-team-ids.mjsで確認済み）。既に取得済みのクラブはスキップして
// 再実行で続きから進められる（--force で全クラブ再取得）。
//
// 使い方: node scripts/fetch-preseason.mjs [season] [--force]
// 出力: data/preseason-<season>.json … {season, fetchedSlugs:[...], matches:[{idEvent, dateUTC, home, away, homeSlug, awaySlug, venue, competition, finished, score, videoId}]}
//   - home/away は追跡中クラブなら日本語名、それ以外（対戦相手が当サイト未掲載クラブ）は原語表記のまま。
//   - videoId は空（後段の watch-preseason が公式ハイライトを紐付け）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { CLUBS } from './entities.mjs';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const SEASON = args.find(a => !a.startsWith('--')) || '2026';
const readJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const IDS = readJson('data/club-tsdb-ids.json', {});
// slug → 日本語名 の逆引き（対戦相手が追跡中クラブなら日本語表記に置き換える）
const SLUG_TO_JA = {};
for (const [ja, info] of Object.entries(CLUBS)) SLUG_TO_JA[info.slug] = ja;
const JA_TO_SLUG = {};
for (const [ja, info] of Object.entries(CLUBS)) JA_TO_SLUG[ja] = info.slug;
// TheSportsDBのidTeam → 追跡中クラブの日本語名（対戦相手側の照合用）
const TSDB_ID_TO_JA = {};
for (const [slug, rec] of Object.entries(IDS)) if (rec.idTeam && SLUG_TO_JA[slug]) TSDB_ID_TO_JA[rec.idTeam] = SLUG_TO_JA[slug];

const slugify = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const slugOfJa = ja => JA_TO_SLUG[ja] || slugify(ja);

// 親善試合と判定する条件（strLeagueの表記ゆれに対応）。リーグ戦・カップ戦の巻き込みを避けるため保守的に。
const FRIENDLY_RE = /friendl|pre-?season|club\s*friendlies|exhibition/i;

async function tsdb(path) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`https://www.thesportsdb.com/api/v1/json/3/${path}`, { headers: { accept: 'application/json' } });
      if (r.ok) return { json: await r.json(), limited: false };
      if (r.status === 429) { console.log(`  （429レート制限。65秒待機して再試行 ${attempt}/3）`); await sleep(65000); continue; }
      return { json: null, limited: false };
    } catch { await sleep(1500); }
  }
  return { json: null, limited: true };
}

function normalizeEvent(e, ownSlug, ownJa) {
  const homeIsOwn = e.idHomeTeam === IDS[ownSlug]?.idTeam;
  const home = homeIsOwn ? ownJa : (TSDB_ID_TO_JA[e.idHomeTeam] || e.strHomeTeam || '');
  const away = !homeIsOwn ? ownJa : (TSDB_ID_TO_JA[e.idAwayTeam] || e.strAwayTeam || '');
  const hs = e.intHomeScore, as = e.intAwayScore;
  const finished = /finished/i.test(e.strStatus || '') || (hs != null && as != null);
  return {
    idEvent: e.idEvent,
    dateUTC: e.strTimestamp || (e.dateEvent ? `${e.dateEvent}T${e.strTime || '00:00:00'}` : ''),
    home, away,
    homeSlug: TSDB_ID_TO_JA[e.idHomeTeam] ? slugOfJa(TSDB_ID_TO_JA[e.idHomeTeam]) : slugify(e.strHomeTeam),
    awaySlug: TSDB_ID_TO_JA[e.idAwayTeam] ? slugOfJa(TSDB_ID_TO_JA[e.idAwayTeam]) : slugify(e.strAwayTeam),
    venue: e.strVenue || '',
    competition: e.strLeague || '',
    finished,
    score: (finished && hs != null && as != null) ? `${hs}-${as}` : '',
    videoId: '',
  };
}

async function main() {
  const prev = readJson(`data/preseason-${SEASON}.json`, {});
  const fetchedSlugs = new Set(FORCE ? [] : (prev.fetchedSlugs || []));
  const byEvent = new Map((prev.matches || []).map(m => [m.idEvent, m]));

  let newlyFetched = 0, limitedOut = 0;
  for (const [slug, rec] of Object.entries(IDS)) {
    if (!rec.idTeam) continue;
    if (fetchedSlugs.has(slug)) continue;
    const ja = SLUG_TO_JA[slug];
    const next = await tsdb(`eventsnext.php?id=${rec.idTeam}`);
    if (next.limited) { console.log(`${ja} (#${rec.idTeam}) → レート制限で断念（再実行で再試行されます）`); limitedOut++; continue; }
    const last = await tsdb(`eventslast.php?id=${rec.idTeam}`);
    if (last.limited) { console.log(`${ja} (#${rec.idTeam}) → レート制限で断念（再実行で再試行されます）`); limitedOut++; continue; }
    const events = [...(next.json?.events || []), ...(last.json?.results || [])];
    let kept = 0;
    for (const e of events) {
      if (!e.idEvent) continue;
      if (!FRIENDLY_RE.test(e.strLeague || '')) continue;
      byEvent.set(e.idEvent, normalizeEvent(e, slug, ja));
      kept++;
    }
    console.log(`${ja} (#${rec.idTeam}) → 親善試合 ${kept}件（next${next.json?.events?.length || 0}/last${last.json?.results?.length || 0}件中）`);
    fetchedSlugs.add(slug);
    newlyFetched++;
    await sleep(600);
  }
  const out = [...byEvent.values()].sort((a, b) => (a.dateUTC || '').localeCompare(b.dateUTC || ''));
  writeFileSync(`data/preseason-${SEASON}.json`, JSON.stringify({ season: SEASON, fetchedSlugs: [...fetchedSlugs], matches: out }, null, 2));
  const totalClubs = Object.values(IDS).filter(r => r.idTeam).length;
  console.log(`\n新規取得クラブ: ${newlyFetched} / レート制限で断念: ${limitedOut} / 取得済み合計: ${fetchedSlugs.size}/${totalClubs} / 親善試合ユニーク件数: ${out.length}`);
  if (fetchedSlugs.size < totalClubs) console.log('未取得クラブが残っています。再実行してください。');
}
main();
