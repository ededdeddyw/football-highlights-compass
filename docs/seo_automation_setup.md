# SEO 自動レポートのセットアップ（GSC + GA4 → 毎朝自動取得）

> **目的**: 毎朝 GitHub Actions が Search Console と GA4 を API で取得し、`docs/seo_daily_report.md` を自動更新。
> **効果**: あなたが GSC/GA のスクショを貼る作業が不要に。Claude はこのレポートを読んで改善案を出す。
> **これは一度きりの設定**（PC・ブラウザでの作業。Google Cloud はスマホだと難しいので**デスクで**推奨）。
> 仕組み: `scripts/fetch_seo_metrics.py` + `.github/workflows/seo-report.yml`。docs のみ更新するので本番デプロイは動かない。

---

## 全体像（3ステップ）
1. Google 側：**サービスアカウント**（自動アクセス用の“ロボット用アカウント”）を作り、GSC と GA4 に**閲覧権限**を与える。
2. GitHub 側：その鍵と設定を **Secrets/Variables** に登録。
3. テスト実行 → `docs/seo_daily_report.md` ができれば完成。

---

## ステップ1：サービスアカウントと鍵を作る（Google Cloud）

1. `https://console.cloud.google.com/` を開く（GAと同じGoogleアカウントで）。
2. 上部でプロジェクトを選択（無ければ「プロジェクトを作成」→ 名前 `hc-seo` 等）。
3. **API を有効化**（2つ）:
   - 検索窓に「Search Console API」→ 開く →「有効にする」
   - 検索窓に「Google Analytics Data API」→ 開く →「有効にする」
4. 左メニュー **「IAM と管理」→「サービス アカウント」→「サービス アカウントを作成」**
   - 名前 `hc-seo-bot` → 作成して続行 → 役割は付けずに「完了」でOK
5. 作ったサービスアカウントをクリック →「**キー**」タブ →「鍵を追加」→「新しい鍵を作成」→ **JSON** → 作成
   - → JSON ファイルがダウンロードされる（これが鍵。**中身をあとで GitHub に貼る**）
6. そのサービスアカウントの **メールアドレス**をコピー（`hc-seo-bot@xxxx.iam.gserviceaccount.com` の形）。

**うまくいった確認**: JSON がダウンロードされ、SAのメールアドレスが分かる。

---

## ステップ2：GSC と GA4 に閲覧権限を与える

### Search Console
1. `https://search.google.com/search-console` → プロパティ `https://highlight-compass.com/` を選択
2. 左下 **「設定」→「ユーザーと権限」→「ユーザーを追加」**
3. メール＝**SAのメールアドレス**、権限＝**「制限付き」**（閲覧のみでOK）→ 追加

> ※ GSC プロパティが「ドメイン プロパティ（highlight-compass.com）」の場合、`GSC_SITE_URL` は
> `sc-domain:highlight-compass.com` を設定する（下のステップ3参照）。「URL プレフィックス プロパティ」なら
> `https://highlight-compass.com/`（末尾スラッシュ）。

### Google Analytics（GA4）
1. `https://analytics.google.com/` → 左下 **「管理」**
2. プロパティ列で **「プロパティのアクセス管理」→ 右上「＋」→「ユーザーを追加」**
3. メール＝**SAのメールアドレス**、役割＝**「閲覧者」** → 追加（「メールで通知」はオフでOK）
4. GA4 の **プロパティID**（数字のみ）を控える：管理 → プロパティ設定 の右上に表示。

> ※ このサイトにまだ GA4 を入れていない場合は、GA4 プロパティを作成し、計測タグ（`gtag.js` / GTM）を
> サイトに設置してから権限付与してください。GA4 未接続でも GSC 側だけは動きます（レポートの GA 欄が空になるだけ）。

**うまくいった確認**: 両方の「ユーザー一覧」にSAのメールが出る。

---

## ステップ3：GitHub に登録

GitHub リポジトリ `ededdeddyw/football-highlights-compass` → **Settings → Secrets and variables → Actions**

**Secrets タブ →「New repository secret」**
| Name | 値 |
|------|-----|
| `GOOGLE_SA_KEY` | ダウンロードした **JSON ファイルの中身を丸ごと**貼る（`{` から `}` まで全部） |

**Variables タブ →「New repository variable」**（3つ）
| Name | 値 |
|------|-----|
| `GSC_SITE_URL` | `https://highlight-compass.com/`（ドメインプロパティなら `sc-domain:highlight-compass.com`） |
| `GA4_PROPERTY_ID` | GA4 の数字ID（例 `123456789`）／GA4未接続なら空でOK |
| `SEO_REPORT_ENABLED` | `true` |

---

## ステップ4：テスト実行

1. GitHub → **Actions** タブ → 左の **「SEO daily report (GSC + GA4)」** を選択
2. 右の **「Run workflow」→ Run workflow**（手動実行）
3. 緑✓になったら、リポジトリの **`docs/seo_daily_report.md`** を開く → クリック/表示/順位・上位クエリ・流入・ページが入っていれば **完成** 🎉

以降は**毎朝07:00（JST）に自動更新**。あなたは何もしなくてOK。

---

## うまくいかないとき
| 症状 | 対処 |
|------|------|
| Actions が即 "skipping" で終わる | Variable `SEO_REPORT_ENABLED=true` になっているか |
| レポートに「GSC: ... 403/permission」 | GSC のユーザー追加（SAメール）ができているか・APIが有効か・`GSC_SITE_URL` の形式（`sc-domain:` か URL か）が合っているか |
| レポートに「GA4: ... permission」 | GA のアクセス管理でSAを「閲覧者」に追加したか・Data API 有効か・`GA4_PROPERTY_ID` が数字のみか |
| `GOOGLE_SA_KEY` エラー | JSON を**丸ごと**貼れているか（改行含め全部） |

---

## 運用（設定後）
- 毎朝レポートが自動更新 → **Claude が読んで改善案・実装**（本番反映は最終的に人間がOK）。
- スマホでも `docs/seo_daily_report.md` を GitHub で開けば数値が見られる（スクショ貼り不要）。
- 指標を増やしたい/減らしたいときは `scripts/fetch_seo_metrics.py` を調整。
- 「Claude に監視してほしい」場合：毎朝レポート更新後に Claude セッションを起こす **Routine（定期トリガー）** を組めば、
  Claude が最新レポートを読んで異常検知・改善提案まで自動で回せます（設定完了後に相談してください）。
