# 暗記カード

大学受験向けの暗記カードサイトです。登録した人だけが使えます。

- カードをめくって「もう一度／あいまい／覚えた」で自己採点
- 間隔反復（FSRS）で次に出題する日を自動で決定し、入試日の前日までに必ず復習が回るよう調整
- 学習カレンダー・科目別の定着率・今後の復習予定・苦手カードを表示
- 数式（KaTeX）と化学式（mhchem）に対応
- スマホのホーム画面に追加でき、電波がない場所でも学習を続けられる
- 管理者はCSVでカードを取り込み、利用者の登録と学習状況の確認ができる

公開までの準備とCSVの形式は [docs/SETUP.md](docs/SETUP.md) を見てください。

## 構成

| 役割 | 使っているもの |
|---|---|
| 画面 | React + TypeScript（Vite） |
| 公開 | GitHub Pages（`main` に push すると GitHub Actions で自動公開） |
| ログイン | Firebase Authentication（Google・メール/パスワード） |
| データ | Cloud Firestore（アクセス制御は `firestore.rules`） |
| 復習の計算 | ts-fsrs |

Firestore のデータの置き方：

| パス | 中身 |
|---|---|
| `members/{メールアドレス}` | 利用者の名簿（`role`: `admin` / `member`） |
| `catalog/main` | 科目・単元の一覧と枚数 |
| `cards/{チャンクID}` | カード本体（1ドキュメントに最大800枚） |
| `users/{uid}` | 設定・日ごとの回答数・管理者向けの概要 |
| `users/{uid}/states/{チャンクID}` | カードごとの学習状態 |

書き込み回数を抑えるため、回答は5枚ごと（または20秒後・画面を離れたとき）にまとめて保存します。

## 開発

```bash
npm ci
npm test          # 計算部分のテスト
npm run build     # 型チェックと本番ビルド
```

Firebase のエミュレーターで動かす場合：

```bash
npx firebase-tools emulators:start --only auth,firestore --project demo-anki
VITE_USE_EMULATOR=1 npm run dev
```
