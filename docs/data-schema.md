# データスキーマ定義（動画レコード）

手動キュレーション期でも、掲載した動画は**必ずこの形で記録する**。
そうすれば後でDB型検索サイトへ移行するときデータが無駄にならない。

- 1レコード = 1動画（同じ試合の通常版とロング版は別レコード）
- 保存形式: CSV（[../data/videos.sample.csv](../data/videos.sample.csv)）または JSON（下にサンプル）
- 列挙値（enum）は下表の値だけを使う。表記揺れを作らない。

---

## フィールド一覧

凡例: 必須 = ★ / 推奨 = ○ / 任意 = ・

| # | フィールド | 必須 | 型 | 説明 / 列挙値 |
|---|---|---|---|---|
| 1 | `match_id` | ★ | string | 試合の一意キー。`YYYYMMDD-home-away` 形式推奨（例 `20251123-arsenal-liverpool`） |
| 2 | `match_date` | ★ | date (YYYY-MM-DD) | 試合日。現地ではなくUTC基準で統一すると安全 |
| 3 | `competition` | ★ | string | 大会名（例 `Premier League`, `UEFA Champions League`, `J1 League`） |
| 4 | `season` | ○ | string | シーズン（例 `2025-26`） |
| 5 | `home_team` | ★ | string | ホームチーム名（英語表記で正規化） |
| 6 | `away_team` | ★ | string | アウェイチーム名（同上） |
| 7 | `score_spoiler` | ・ | string | スコア（例 `2-1`）。**ネタバレ情報**なので表示制御の対象。空でも可 |
| 8 | `players_featured` | ○ | list<string> | 動画で目立つ選手（`;` 区切り） |
| 9 | `japanese_players` | ○ | list<string> | 出場した日本人選手（`;` 区切り）。MVP1の主軸 |
| 10 | `video_title` | ★ | string | 動画の公式タイトル（引用。改変しない） |
| 11 | `video_url` | ★ | url | 公式ページ/動画のURL |
| 12 | `source_name` | ★ | string | 情報源の具体名（例 `Premier League (YouTube)`, `UEFA.tv`） |
| 13 | `source_type` | ★ | enum | `fifa` / `uefa` / `league` / `club` / `broadcaster` / `rights_holder` / `official_youtube` / `unknown` |
| 14 | `rights_holder_type` | ○ | enum | `fifa` / `uefa` / `league` / `club` / `broadcaster` / `rights_holder` / `unknown` |
| 15 | `is_official` | ★ | bool | 公式か。**false は原則掲載しない** |
| 16 | `is_embed_allowed` | ★ | bool | 公式埋め込み可か。不明・禁止は false（→リンクのみ） |
| 17 | `is_youtube` | ○ | bool | YouTube動画か |
| 18 | `is_free` | ○ | bool | 無料で視聴可能か |
| 19 | `requires_login` | ○ | bool | 視聴にログインが要るか |
| 20 | `requires_subscription` | ○ | bool | 有料サブスクが要るか |
| 21 | `geo_available_japan` | ★ | enum | `yes` / `no` / `login_required` / `subscription_required` / `unknown` |
| 22 | `duration_seconds` | ★ | int | 動画尺（秒）。`highlight_type` 判定の根拠 |
| 23 | `highlight_type` | ★ | enum | `short` / `normal` / `long` / `extended` / `condensed` / `full_match` （下の対応表参照） |
| 24 | `language` | ○ | string | 主言語（ISO例 `en` `es` `de` `fr` `ja`） |
| 25 | `thumbnail_source` | ・ | enum | `official_oembed` / `none` / `self_made` （**公式サムネの自前保存は使わない**） |
| 26 | `last_checked_at` | ★ | datetime | 最終確認日時（URL切れ・削除が多いため重要） |
| 27 | `status` | ★ | enum | `published` / `draft` / `dead_link` / `removed` |
| 28 | `notes` | ・ | string | 備考（規約上の注意、地域限定など） |

### 最重要フィールド（検索・差別化の軸）

`is_official` / `is_embed_allowed` / `geo_available_japan` / `duration_seconds` / `highlight_type` / `source_type`

---

## `highlight_type` と尺の対応表

| highlight_type | 目安の尺 | 説明 |
|---|---|---|
| `short` | 1〜3分 | ショートハイライト |
| `normal` | 3〜7分 | 通常ハイライト |
| `long` | 8〜15分 | **ロングハイライト（最重要差別化）** |
| `extended` | 15分以上 | Extended highlights |
| `condensed` | 可変 | Condensed match（凝縮版） |
| `full_match` | 45分以上 | フルマッチ / 前後半リプレイ |

> サービスの主戦場は `long` / `extended` / `condensed`。「3分では物足りないがフルは長すぎる」層。

---

## bool / enum の表記ルール

- bool は `true` / `false`（小文字）。空欄は「不明」を意味するので、確認したら必ず埋める。
- enum は上表の値のみ。新しい値が必要になったらこの文書に追記してから使う。
- list 型は CSV では `;`（セミコロン）区切り、JSON では配列。

---

## JSON サンプル（1レコード）

```json
{
  "match_id": "20251123-arsenal-liverpool",
  "match_date": "2025-11-23",
  "competition": "Premier League",
  "season": "2025-26",
  "home_team": "Arsenal",
  "away_team": "Liverpool",
  "score_spoiler": "2-1",
  "players_featured": ["Bukayo Saka"],
  "japanese_players": [],
  "video_title": "Arsenal v Liverpool | Extended Highlights",
  "video_url": "https://www.youtube.com/watch?v=EXAMPLE",
  "source_name": "Premier League (YouTube)",
  "source_type": "official_youtube",
  "rights_holder_type": "league",
  "is_official": true,
  "is_embed_allowed": true,
  "is_youtube": true,
  "is_free": true,
  "requires_login": false,
  "requires_subscription": false,
  "geo_available_japan": "yes",
  "duration_seconds": 720,
  "highlight_type": "long",
  "language": "en",
  "thumbnail_source": "official_oembed",
  "last_checked_at": "2025-11-24T10:00:00Z",
  "status": "published",
  "notes": ""
}
```

> 上は構造を示すサンプル。`video_url` 等はダミー。実掲載時は [embedding-policy.md](embedding-policy.md) のフローを通したうえで実データを入れる。
