// W杯2026 グループステージ全72試合を data/wc2026-schedule.json に生成。
// 出典: Al Jazeera 公式日程（GMT=UTC）。決勝T（R32以降）は対戦確定後に追記する。
// 実行: node scripts/seed-wc-schedule.mjs
import { writeFileSync } from 'node:fs';

const VEN = {
  mexicocity:['Estadio Azteca','Mexico City','Mexico'], guadalajara:['Estadio Akron','Guadalajara','Mexico'], monterrey:['Estadio BBVA','Monterrey','Mexico'],
  toronto:['BMO Field','Toronto','Canada'], vancouver:['BC Place','Vancouver','Canada'],
  la:['SoFi Stadium','Inglewood','USA'], sfbay:["Levi's Stadium",'Santa Clara','USA'], seattle:['Lumen Field','Seattle','USA'],
  nynj:['MetLife Stadium','East Rutherford','USA'], boston:['Gillette Stadium','Foxborough','USA'], philadelphia:['Lincoln Financial Field','Philadelphia','USA'],
  miami:['Hard Rock Stadium','Miami Gardens','USA'], atlanta:['Mercedes-Benz Stadium','Atlanta','USA'], houston:['NRG Stadium','Houston','USA'],
  dallas:['AT&T Stadium','Arlington','USA'], kansascity:['Arrowhead Stadium','Kansas City','USA']
};
const JA = { 'Mexico':'メキシコ','South Africa':'南アフリカ','South Korea':'韓国','Czechia':'チェコ','Canada':'カナダ','Bosnia and Herzegovina':'ボスニア・ヘルツェゴビナ','Qatar':'カタール','Switzerland':'スイス','Brazil':'ブラジル','Morocco':'モロッコ','Haiti':'ハイチ','Scotland':'スコットランド','USA':'アメリカ','Paraguay':'パラグアイ','Australia':'オーストラリア','Turkiye':'トルコ','Germany':'ドイツ','Curacao':'キュラソー','Ivory Coast':'コートジボワール','Ecuador':'エクアドル','Netherlands':'オランダ','Japan':'日本','Sweden':'スウェーデン','Tunisia':'チュニジア','Belgium':'ベルギー','Egypt':'エジプト','Iran':'イラン','New Zealand':'ニュージーランド','Spain':'スペイン','Cape Verde':'カーボベルデ','Saudi Arabia':'サウジアラビア','Uruguay':'ウルグアイ','France':'フランス','Senegal':'セネガル','Iraq':'イラク','Norway':'ノルウェー','Argentina':'アルゼンチン','Algeria':'アルジェリア','Austria':'オーストリア','Jordan':'ヨルダン','Portugal':'ポルトガル','DR Congo':'コンゴ民主共和国','Uzbekistan':'ウズベキスタン','Colombia':'コロンビア','England':'イングランド','Croatia':'クロアチア','Ghana':'ガーナ','Panama':'パナマ' };
// [group, matchday, dateLocal, koUTC, home(en), away(en), venueKey]
const R = [
['A',1,'2026-06-11','2026-06-11T19:00:00Z','Mexico','South Africa','mexicocity'],['A',1,'2026-06-11','2026-06-12T02:00:00Z','South Korea','Czechia','guadalajara'],
['A',2,'2026-06-18','2026-06-18T16:00:00Z','Czechia','South Africa','atlanta'],['A',2,'2026-06-18','2026-06-19T01:00:00Z','Mexico','South Korea','guadalajara'],
['A',3,'2026-06-24','2026-06-25T01:00:00Z','Czechia','Mexico','mexicocity'],['A',3,'2026-06-24','2026-06-25T01:00:00Z','South Africa','South Korea','monterrey'],
['B',1,'2026-06-12','2026-06-12T19:00:00Z','Canada','Bosnia and Herzegovina','toronto'],['B',1,'2026-06-13','2026-06-13T19:00:00Z','Qatar','Switzerland','sfbay'],
['B',2,'2026-06-18','2026-06-18T19:00:00Z','Switzerland','Bosnia and Herzegovina','la'],['B',2,'2026-06-18','2026-06-18T22:00:00Z','Canada','Qatar','vancouver'],
['B',3,'2026-06-24','2026-06-24T19:00:00Z','Switzerland','Canada','vancouver'],['B',3,'2026-06-24','2026-06-24T19:00:00Z','Bosnia and Herzegovina','Qatar','seattle'],
['C',1,'2026-06-13','2026-06-13T22:00:00Z','Brazil','Morocco','nynj'],['C',1,'2026-06-13','2026-06-14T01:00:00Z','Haiti','Scotland','boston'],
['C',2,'2026-06-19','2026-06-19T22:00:00Z','Scotland','Morocco','boston'],['C',2,'2026-06-19','2026-06-20T00:30:00Z','Brazil','Haiti','philadelphia'],
['C',3,'2026-06-24','2026-06-24T22:00:00Z','Scotland','Brazil','miami'],['C',3,'2026-06-24','2026-06-24T22:00:00Z','Morocco','Haiti','atlanta'],
['D',1,'2026-06-12','2026-06-13T01:00:00Z','USA','Paraguay','la'],['D',1,'2026-06-13','2026-06-14T04:00:00Z','Australia','Turkiye','vancouver'],
['D',2,'2026-06-19','2026-06-19T19:00:00Z','USA','Australia','seattle'],['D',2,'2026-06-19','2026-06-20T03:00:00Z','Turkiye','Paraguay','sfbay'],
['D',3,'2026-06-25','2026-06-26T02:00:00Z','Turkiye','USA','la'],['D',3,'2026-06-25','2026-06-26T02:00:00Z','Paraguay','Australia','sfbay'],
['E',1,'2026-06-14','2026-06-14T17:00:00Z','Germany','Curacao','houston'],['E',1,'2026-06-14','2026-06-14T23:00:00Z','Ivory Coast','Ecuador','philadelphia'],
['E',2,'2026-06-20','2026-06-20T20:00:00Z','Germany','Ivory Coast','toronto'],['E',2,'2026-06-20','2026-06-21T03:00:00Z','Ecuador','Curacao','kansascity'],
['E',3,'2026-06-25','2026-06-25T20:00:00Z','Ecuador','Germany','nynj'],['E',3,'2026-06-25','2026-06-25T20:00:00Z','Curacao','Ivory Coast','philadelphia'],
['F',1,'2026-06-14','2026-06-14T20:00:00Z','Netherlands','Japan','dallas'],['F',1,'2026-06-14','2026-06-15T02:00:00Z','Sweden','Tunisia','monterrey'],
['F',2,'2026-06-20','2026-06-20T17:00:00Z','Netherlands','Sweden','houston'],['F',2,'2026-06-20','2026-06-21T04:00:00Z','Tunisia','Japan','monterrey'],
['F',3,'2026-06-25','2026-06-25T23:00:00Z','Japan','Sweden','dallas'],['F',3,'2026-06-25','2026-06-25T23:00:00Z','Tunisia','Netherlands','kansascity'],
['G',1,'2026-06-15','2026-06-15T19:00:00Z','Belgium','Egypt','vancouver'],['G',1,'2026-06-15','2026-06-16T01:00:00Z','Iran','New Zealand','la'],
['G',2,'2026-06-21','2026-06-21T19:00:00Z','Belgium','Iran','la'],['G',2,'2026-06-21','2026-06-22T01:00:00Z','New Zealand','Egypt','vancouver'],
['G',3,'2026-06-26','2026-06-27T03:00:00Z','Egypt','Iran','seattle'],['G',3,'2026-06-26','2026-06-27T03:00:00Z','New Zealand','Belgium','vancouver'],
['H',1,'2026-06-15','2026-06-15T16:00:00Z','Spain','Cape Verde','atlanta'],['H',1,'2026-06-15','2026-06-15T22:00:00Z','Saudi Arabia','Uruguay','miami'],
['H',2,'2026-06-21','2026-06-21T16:00:00Z','Spain','Saudi Arabia','atlanta'],['H',2,'2026-06-21','2026-06-21T22:00:00Z','Uruguay','Cape Verde','miami'],
['H',3,'2026-06-26','2026-06-27T00:00:00Z','Cape Verde','Saudi Arabia','houston'],['H',3,'2026-06-26','2026-06-27T00:00:00Z','Uruguay','Spain','guadalajara'],
['I',1,'2026-06-16','2026-06-16T19:00:00Z','France','Senegal','nynj'],['I',1,'2026-06-16','2026-06-16T22:00:00Z','Iraq','Norway','boston'],
['I',2,'2026-06-22','2026-06-22T21:00:00Z','France','Iraq','philadelphia'],['I',2,'2026-06-22','2026-06-23T00:00:00Z','Norway','Senegal','nynj'],
['I',3,'2026-06-26','2026-06-26T19:00:00Z','Norway','France','boston'],['I',3,'2026-06-26','2026-06-26T19:00:00Z','Senegal','Iraq','toronto'],
['J',1,'2026-06-16','2026-06-17T01:00:00Z','Argentina','Algeria','kansascity'],['J',1,'2026-06-16','2026-06-17T04:00:00Z','Austria','Jordan','sfbay'],
['J',2,'2026-06-22','2026-06-22T17:00:00Z','Argentina','Austria','dallas'],['J',2,'2026-06-22','2026-06-23T03:00:00Z','Jordan','Algeria','sfbay'],
['J',3,'2026-06-27','2026-06-28T02:00:00Z','Algeria','Austria','kansascity'],['J',3,'2026-06-27','2026-06-28T02:00:00Z','Jordan','Argentina','dallas'],
['K',1,'2026-06-17','2026-06-17T17:00:00Z','Portugal','DR Congo','houston'],['K',1,'2026-06-17','2026-06-18T02:00:00Z','Uzbekistan','Colombia','mexicocity'],
['K',2,'2026-06-23','2026-06-23T17:00:00Z','Portugal','Uzbekistan','houston'],['K',2,'2026-06-23','2026-06-24T02:00:00Z','Colombia','DR Congo','guadalajara'],
['K',3,'2026-06-27','2026-06-27T23:30:00Z','Colombia','Portugal','miami'],['K',3,'2026-06-27','2026-06-27T23:30:00Z','DR Congo','Uzbekistan','atlanta'],
['L',1,'2026-06-17','2026-06-17T20:00:00Z','England','Croatia','dallas'],['L',1,'2026-06-17','2026-06-17T23:00:00Z','Ghana','Panama','toronto'],
['L',2,'2026-06-23','2026-06-23T20:00:00Z','England','Ghana','boston'],['L',2,'2026-06-23','2026-06-23T23:00:00Z','Panama','Croatia','toronto'],
['L',3,'2026-06-27','2026-06-27T21:00:00Z','Panama','England','nynj'],['L',3,'2026-06-27','2026-06-27T21:00:00Z','Croatia','Ghana','philadelphia']
];
const jst = iso => new Date(new Date(iso).getTime()+9*3600e3).toISOString().replace('.000Z','+09:00').replace(/Z$/,'+09:00');
const matches = R.map(([g,md,date,ko,h,a,vk],i)=>{ const [venue,city,country]=VEN[vk]; return {
  matchId:`wc2026-g${g}-${md}-${(i%2)+1}`, stage:'group', group:g, round:`第${md}節`,
  dateLocal:date, koUTC:ko, koJST:jst(ko), venue, city, country,
  home:{ja:JA[h],en:h}, away:{ja:JA[a],en:a}, broadcaster:'DAZN Japan', status:'scheduled', videoId:null
};});
const out = { _note:'グループ72試合は seed-wc-schedule.mjs が生成。決勝T(R32以降)は対戦確定後に追記。出典: Al Jazeera 公式日程(GMT=UTC)。', tournament:'FIFA World Cup 2026', updatedAt:new Date().toISOString(), matches };
writeFileSync('data/wc2026-schedule.json', JSON.stringify(out,null,2)+'\n');
console.log('schedule: '+matches.length+'試合を生成');
