<div align="center">

[![English](https://img.shields.io/badge/English-555?style=for-the-badge)](README.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-555?style=for-the-badge)](README.ko.md)
[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-555?style=for-the-badge)](README.zh.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-2ea44f?style=for-the-badge)](README.ja.md)

</div>

# claude-session-bridge-mcp

**2つ（またはそれ以上）の Claude Code セッションどうしを会話させる。そして必要なら、
セッションどうしで自律的に連携させることもできます。**

たとえば、**バックエンド**用に1つの Claude Code セッションを開き、**フロントエンド**用に
もう1つ開いたとします。普通はお互いの存在をまったく知りません。バックエンドが API を
変更したら、その結果を手作業でコピーしてフロントエンドのセッションに貼り付けることに
なります。

このツールはそのコピー＆ペーストをなくします。あるセッションが結果を**送信**すると、
同じ部屋にいる他のセッションがそれを**自動的に受信**します。さらに任意の自動モードを
オンにすれば、作業を終えたバックエンドがフロントエンドを**起こして**反応させることも
できます。つまり、人の手を介さないピンポン（やり取り）です。その間も、安全装置
（自動コミット禁止、デプロイのゲート、ループ防止）はあなたが完全にコントロールでき、
あらゆる設定を Claude の中から変更できます。

> はじめての方へ。上から下まで通して読んでください。必要なコマンドはすべて載っています。
> 内部のしくみを理解していなくても使えます。

---

## 目次

- [イメージでつかむ](#イメージでつかむ)
- [必要なもの](#必要なもの)
- [インストール（最初の1回だけ）](#インストール最初の1回だけ)
- [2つのセッションをつなぐ](#2つのセッションをつなぐ)
  - [変数を設定する2つの方法](#変数を設定する2つの方法)
  - [tmux を使う](#tmux-を使う)
- [メッセージの送受信](#メッセージの送受信)
- [ロールはただのラベル](#ロールはただのラベル)
- [複数のプロジェクトを同時に動かす](#複数のプロジェクトを同時に動かす)
- [自動モード：イベントスポーナー](#自動モードイベントスポーナー)
  - [2つのドライバー：tmux と spawn](#2つのドライバーtmux-と-spawn)
  - [設定して動かす](#設定して動かす)
  - [安全装置](#安全装置)
  - [機微なロールは既定でオフ](#機微なロールは既定でオフ)
  - [自動コミットは絶対にしない（許可する方法も）](#自動コミットは絶対にしない許可する方法も)
  - [自動デプロイには注意](#自動デプロイには注意)
- [Claude の中から設定を変更する](#claude-の中から設定を変更する)
- [リファレンス](#リファレンス)

---

## イメージでつかむ

シンプルな2つの考え方です。

- **プロジェクト = チャットルーム。** 同じプロジェクト名で起動したセッションは同じ部屋に
  いて、会話できます。プロジェクト名が違えば別の部屋で、互いに隔離されています。
- **ロール = その部屋でのあなたのニックネーム。** `backend`、`frontend`、`infra` など、
  好きなラベルでかまいません。メッセージはロール宛てに送ります。

```
Session 1   project "shop"  role "backend"  ┐
                                            ├─ room "shop" （会話する）
Session 2   project "shop"  role "frontend" ┘

Session 3   project "blog"  role "backend"  ─── room "blog" （別の部屋・隔離）
```

「**接続ボタン**」のようなものはありません。同じプロジェクト名で2つのセッションを起動
すること、それ自体がつなぐということです。

---

## 必要なもの

- **Node.js 18+** — `node --version` で確認できます。
- **Claude Code**（`claude` コマンド） — `claude --version` で確認できます。
- **tmux** — おすすめです。既定の自動モードのドライバーは、これを通してあなたの稼働中の
  セッションを動かします。（バスだけを使う場合や `spawn` ドライバーを使う場合は不要です。）

---

## インストール（最初の1回だけ）

これは**1回だけ**やればOKです。あとはこれらのファイルを二度と編集することはありません。
セッションごとに変わるのは2つの環境変数だけです（次の節で説明します）。

**1. コードを取得してビルドします。**

```bash
git clone <this-repo-url> claude-session-bridge-mcp
cd claude-session-bridge-mcp
npm install
npm run build
```

**2. このフォルダの絶対パスを調べます。** 設定に貼り付けるために使います。

```bash
pwd
# 例: /Users/you/projects/claude-session-bridge-mcp
```

**3. ブリッジを Claude Code に登録します。** `~/.claude/settings.json` を開き
（なければ作成します）、下記のブロックを追加します。`/ABSOLUTE/PATH` の部分を、
`pwd` が表示したパスに置き換えてください。

```json
{
  "mcpServers": {
    "session-bridge": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/claude-session-bridge-mcp/dist/server.js"]
    }
  },
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command",
        "command": "node /ABSOLUTE/PATH/claude-session-bridge-mcp/dist/hooks/recv.js" } ] }
    ],
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command",
        "command": "node /ABSOLUTE/PATH/claude-session-bridge-mcp/dist/hooks/block-git.js" } ] }
    ]
  }
}
```

- `mcpServers` は、セッションがメッセージを**送信**したり、（管理者セッションで）
  設定を変更したりするためのツールを追加します。
- `UserPromptSubmit` フックは、セッションがメッセージを**自動的に受信**できるようにします。
- `PreToolUse` フックは、どのセッションでも **`git commit`／`push`／`reset` をブロック**
  します（おすすめ。[自動コミットは絶対にしない](#自動コミットは絶対にしない許可する方法も)
  を参照）。セッション自身にコミットさせ*たい*場合は省略してください。

> すでに `settings.json` にこれらのキーがある場合は、その中にマージしてください。3つの
> フックはいずれも、ブリッジに参加していないセッションでは安全に何もしません。そのため
> グローバルにインストールしても問題ありません。

これでセットアップはすべて完了です。

---

## 2つのセッションをつなぐ

セッションを部屋に入れるには、**起動するとき**に2つの値を渡します。

| 変数 | 意味 | 例 |
|----------|---------|---------|
| `BRIDGE_PROJECT` | 部屋の名前 | `shop` |
| `BRIDGE_ROLE` | このセッションのニックネーム | `backend` |

```bash
# ターミナル1 — プロジェクト "shop" のバックエンド
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend claude

# ターミナル2 — プロジェクト "shop" のフロントエンド
BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude
```

どちらもプロジェクト `shop` を使っているので、同じ部屋にいて会話できます。

### 変数を設定する2つの方法

どちらか1つを選んでください。**ただし混同しないこと。これは初心者が一番やりがちな
ミスです。**

**方法A — 同じ行に書く（一番シンプル、おすすめ）:**

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude
```

この変数はその1回の `claude` にだけ適用されます。あとで片付ける必要もありません。

**方法B — 先に設定してから起動する。** 別々の行に書く場合は、**必ず** `export` を
使ってください。

```bash
export BRIDGE_PROJECT=shop
export BRIDGE_ROLE=frontend
claude
```

> ⚠️ **落とし穴:** `export` を**付けずに** `BRIDGE_PROJECT=shop` を単独の行に書くと、
> `claude` からは**見えない**シェル変数になってしまい、ブリッジは何も言わずに接続
> されません。`export` を使う（方法B）か、すべてを1行に書いてください（方法A）。

**ヒント — エイリアスを作る** と、毎回入力せずに済みます。`~/.zshrc`（または
`~/.bashrc`）に書きます。

```bash
alias shop-back='BRIDGE_PROJECT=shop BRIDGE_ROLE=backend claude'
alias shop-front='BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude'
```

### tmux を使う

tmux は起動のしかたを何も変えません。各ペインはそれぞれ独立したシェルで、別々の
ターミナルのようなものです。各ペインで変数を設定して `claude` を実行してください。

```
tmux
 ├ pane 1:  BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude
 ├ pane 2:  BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude   ← pane 1 と同じ部屋
 └ pane 3:  BRIDGE_PROJECT=blog BRIDGE_ROLE=backend  claude   ← 別の部屋
```

tmux がもっとも重要になるのは**自動モード**のときです。既定のドライバーは、これらの
稼働中ペインを自動的に起こします（[スポーナー](#自動モードイベントスポーナー)を参照）。
tmux 内で起動したセッションは、自分のペインを自動で登録します。手動の設定は不要です。

> あるペインで `export`（方法B）を使い、その後**同じ**ペインで*別の*プロジェクトの
> `claude` を起動すると、古い `export` が残ってしまいます。tmux の中では方法A を使うと
> 思わぬトラブルを避けられます。

---

## メッセージの送受信

2つのセッションが同じ部屋を共有していれば、これは何もしなくても動きます。

1. **バックエンド**セッションで、共有する価値のあるものができたとき:
   > 「新しい `/users` のレスポンス形式をフロントエンドのセッションに送って。」

   これにより `bridge_send` ツールが呼ばれ、メッセージが届けられます。

2. **フロントエンド**セッションでは、次に何か入力したときに、そのメッセージが
   コンテキストに**自動的に追加**されます。コピー＆ペーストは不要です。

これが既定の（「バス」）モードです。**送信はあえて意図的に行い**（モデルは大量の文章
ではなく本当の結果を共有します）、**受信は次のターンで自動的に**行われます。主導権は
依然としてあなたにあります。

どちらのセッションでも、明示的に指示することもできます。たとえば *「ブリッジに新しい
メッセージがないか確認して」*（`bridge_recv`）や *「これを infra に送って：ステージング
の準備ができた」*（`bridge_send`）のように。

> あるセッションが作業を終えても共有する価値のあるものがなければ、単に送信しません。
> バスには何も流れず、ピンポンは自然に終わります。アイドル状態のセッションが部屋を
> 荒らすことはありません。

---

## ロールはただのラベル

ロールは **好きな文字列でかまいません** — `backend`／`frontend` だけに限りません。
部屋には好きなだけセッションを追加できます。

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=web      claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=infra    claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=qa       claude
```

送信するときは、特定のロールを指定する（`to: "infra"`）か、自分以外の全員に
ブロードキャストします（`to: "*"`）。`frontend` 宛てのメッセージは `frontend` に
**のみ**届きます。`infra`／`qa` はそれを見ることすらないので、誤って動いてしまう
心配がありません。（全員に届くのは `to: "*"` のときだけです。）そのため、複数ステップ
の流れも自然に作れます。

> backend が API を完成 → **web** に伝える → web が UI を更新 → **infra** に伝える
> → infra が再デプロイする。

この連鎖が**自動的に**動くかどうかは、後述のスポーナー次第です。デプロイについては、
まず [自動デプロイには注意](#自動デプロイには注意) を読んでください。

---

## 複数のプロジェクトを同時に動かす

プロジェクト名を別々にすれば、互いのメッセージを見ることはありません。

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude   # room "shop"
BRIDGE_PROJECT=blog BRIDGE_ROLE=frontend claude   # room "blog" — 隔離
```

隔離は構造的なもの（メッセージはプロジェクトごとのフォルダの下に保存されます）なので、
`shop` と `blog` が交わることはありません。

---

## 自動モード：イベントスポーナー

ここまでの内容はすべて、**あなた**を流れの中に保ちます。セッションはあなたがターンを
与えたときだけ動きます。**イベントスポーナー**は、その一手間をなくす任意のバックグラウンド
プログラム（デーモン）です。あるロールがメッセージを受信すると、スポーナーがその
**ロールを自動的に起こして**対応させます。これにより、間に人を介さずに両者がピンポン
できます。これは専用のターミナルで動かします。オプトイン（明示的に有効化）であり、
簡単にオフにできます。

### 2つのドライバー：tmux と spawn

**ドライバー**は、ロールを*どうやって*起こすかを決めます。

| | **tmux**（既定） | **spawn** |
|---|---|---|
| 何をするか | **すでに開いている稼働中セッション**に入力する（`tmux send-keys`） | イベントごとに**新しい `claude -p`** プロセスを起動する |
| セッション | 同じものが継続する（コンテキストを保つ） | 毎回新しいセッション |
| 見える？ | はい — ペインで様子を見られます | バックグラウンド（ログのみ） |
| `claude -p` を使う？ | **いいえ** | はい |
| tmux が必要？ | はい | いいえ |

たとえると、**tmux** はすでに席にいる従業員に声をかける方式、**spawn** はタスクごとに
新しい派遣スタッフを雇う方式です。

なぜ tmux が既定なのか。tmux はあなたがすでに作業している*開いている*セッションを
連携させ、そのコンテキストを保ち、様子を見て割り込むこともでき、そして **`claude -p`
を使いません**（だからヘッドレス／SDK の課金変更の影響を受けません）。tmux を動かせない
場合や、隔離された使い切りの実行をしたい場合は `spawn` を使ってください。

### 設定して動かす

ロールは、セットアップして初めて自動的に起こされます。初期状態ではスポーナーは何も
しないので、ロールごとにオプトインしていきます。

```bash
# tmux ドライバー: tmux の中でそのロールのセッションを開くだけ — ペインが自動登録されます。
# spawn ドライバー: そのロールのコードがどこにあるかを教えます:
session-bridge spawner set shop backend cwd=/path/to/backend

session-bridge spawner on              # 全体を有効化
session-bridge spawner off shop        # ...またはプロジェクト単位
session-bridge spawner off shop web    # ...または1つのロール
session-bridge spawner status          # 現在の設定を確認
```

（`session-bridge` は、このパッケージと一緒にインストールされる CLI です。`PATH` に
ない場合は `node /ABSOLUTE/PATH/dist/cli.js spawner ...` を実行してください。）

デーモンは専用のターミナルで動かします。

```bash
session-bridge spawner run             # フォアグラウンド。Ctrl-C で停止
# またはバックグラウンドで動かす:
nohup session-bridge spawner run > ~/.claude/bridge/spawner.log 2>&1 &
```

設定はイベントのたびに読み直されるので、`on`／`off` などの変更は**その場で**反映
されます。再起動は不要です。

### 安全装置

| 安全装置 | 既定 | 何をするか |
|------|---------|--------------|
| `maxHops`（ループ防止） | 6 | プロジェクトごとの連鎖カウンターで、連続した自動起動の回数に上限を設けます。静かな間隔があるとリセットされます。暴走するピンポンを抑えます（両方のドライバーで有効）。 |
| `rateLimitPerMinute` | 12 | 1分あたり・ロールごとの自動起動の最大回数。 |
| 機微なロール | `infra`、`qa` | 明示的に有効化しない限り、自動起動されません。誤って届いたメッセージがデプロイを引き起こすことを防ぎます。 |
| 自動コミット禁止 | オン | `git commit`／`push`／`reset` をブロックします（下記参照）。 |
| シングルフライト／クールダウン | — | ロールごとに同時に稼働するのは1回だけ（spawn）。再ナッジのクールダウン（tmux）。 |
| ターゲット必須 | — | 稼働中ペインがない（tmux）、または cwd がない（spawn）ロールは決して起こされません。 |

### 機微なロールは既定でオフ

`infra` と `qa` は `defaultOffRoles` に含まれて出荷されます。スポーナーは、**設定済み
であってもこれらを自動起動しません。** 名前を指定して明示的にオプトインする必要が
あります。

**なぜか？** メッセージを*誰に*送るかは送信側が決めますが、その送信側は言語モデル
です。もしブロードキャスト（`to: "*"`）したり宛先を間違えたりすると、`infra`／`qa`
が本来向けられていないリクエストを受け取る可能性があります。そしてこれらのロールは
もっともリスクの高いこと（デプロイ、リリース、破壊的なテスト）を行います。オフのまま
にしておくことは、モデルが正しく宛先を指定することに**依存しない**保証になります。
誤って届いたメッセージは、人がそのセッションを開くまで受信箱に置かれたままになるだけ
です。

**有効にする（完全な自動化が欲しい場合）:**

```bash
session-bridge spawner on shop infra      # 明示的なオプトイン（必須）
```

まず [自動デプロイには注意](#自動デプロイには注意) を読んでください。リストを変更する
には、`<BRIDGE_ROOT>/spawner.config.json` の `defaultOffRoles` を編集します。

### 自動コミットは絶対にしない（許可する方法も）

既定では、自動駆動のセッションはコミットできません。これを **2つの層** で強制します。

1. **spawn ドライバー:** セッションは
   `--disallowed-tools "Bash(git commit:*)" "Bash(git push:*)" ...` 付きで起動します。
   拒否ルールは許可／バイパスより優先されるため、モデルは物理的にコミットできません。
2. **tmux ドライバー（稼働中セッション）:** これらのフラグは適用されないので、
   **`block-git` の PreToolUse フック**（[インストール](#インストール最初の1回だけ)
   を参照）をインストールしてください。これは、どんなきっかけでターンが始まったとしても、
   どのセッションでも `git commit`／`push`／`reset` を拒否します。

> `CLAUDE.md` に「コミットしないで」と書いておくのはあると嬉しいものですが、自律的な
> ループには**不十分**です。モデルは方針からずれることがあります。フックや拒否ルール
> こそが本当の保証です。

**もしコミット／プッシュの自動化が欲しい場合**（そういう人もいます）は、オプトアウト
します。

- `block-git` フックをインストールしない。**そして**
- spawn ドライバー向けに、`denyTools`（`session-bridge spawner` の設定）から git の
  エントリを削除する。
- もしくは `BRIDGE_BLOCK_GIT`（正規表現。たとえば commit は許可しつつ push は
  ブロックする）でブロック対象を絞り込む。

> ⚠️ 自動の `push` は外向きで、取り消すのが難しい操作です。許可する場合は
> **フィーチャーブランチ** に push し、`main` を保護してください（ブランチ保護）。
> `main` への自動 push はしないこと。

### 自動デプロイには注意

⚠️ コミット／プッシュはブロックされます。しかし**デプロイは git ではありません。**
`kubectl apply`、`vercel deploy`、`terraform apply`、SSH のデプロイスクリプト — これらは
どれも既定ではブロックされません。そのため、自律的な `infra` セッションがそれらを実行
してしまう可能性があります。デプロイは外向きで取り消しが難しく、人がいない状態で行う
のは危険です。

`infra` を流れに組み込みたい場合は、次のどれかを選んでください。

1. **infra は手動のままにする**（既定 — オフです）。メッセージは溜まり、あなたが
   セッションを開いて自分でデプロイします。
2. **デプロイ系コマンドをブロックする**（`denyTools` か block-git の正規表現に追加します）。
3. **安全なステップだけ自動化する** — ステージング／ドライランは自動、本番は手動。

---

## Claude の中から設定を変更する

JSON を編集したり CLI のフラグを覚えたりする必要はありません。MCP サーバーを使えば、
あらゆる自動化設定を **Claude セッションの中から** 読み取って変更できます。ダッシュボード
のように、会話で、あるいは `/mcp` 経由で操作できます。

**安全性：管理者ゲートで保護。** 設定を*変更*できるのは、`BRIDGE_ADMIN=1` を付けて
起動したセッション（あなたの「コントロール」セッション）だけです。自動駆動のセッション
はこれを持たないため、暴走したループが自分の安全設定を勝手に書き換えることはできません。
設定の読み取りは常に許可されています。

```bash
# あなたのコントロール／ダッシュボード用セッション
BRIDGE_PROJECT=shop BRIDGE_ROLE=control BRIDGE_ADMIN=1 claude
```

**操作する方法は2つあります。**

**A. ただ話しかける**（モデルがツールを呼びます）:

> 「ブリッジの設定を見せて。」・「frontend を auto にして。」・「maxHops を 3、driver
> を tmux に。」・「自動化をオフにして。」

**B. `/mcp` プロンプト**（その場で変更を適用するスラッシュコマンド）:

```
/mcp__session-bridge__show-config       現在の設定を表示
/mcp__session-bridge__set-mode          project, role, auto|manual
/mcp__session-bridge__configure-role    cwd / model / tmuxTarget
/mcp__session-bridge__set-driver        tmux | spawn
/mcp__session-bridge__automation        on | off  （マスタースイッチ）
/mcp__session-bridge__set-limits        maxHops / rateLimitPerMinute
```

どれか1つを選び、引数を埋めれば、すぐに変更が書き込まれます（管理者セッションのみ）。
デーモンはその場で反映します。

---

## リファレンス

### ツール（セッションから呼び出せる）

| ツール | 管理者？ | 用途 |
|------|--------|---------|
| `bridge_send(to, body)` | いいえ | ロールに送信、または `"*"` でブロードキャスト |
| `bridge_recv()` | いいえ | 未読メッセージを取り出して消費する |
| `bridge_peek()` | いいえ | 消費せずに未読をプレビューする |
| `bridge_tail(limit?)` | いいえ | 最近のメッセージを確認する |
| `bridge_roles()` | いいえ | プロジェクト内のロール一覧 |
| `bridge_whoami()` | いいえ | このセッションの project と role を表示 |
| `bridge_config()` | いいえ | 自動化設定を表示 |
| `bridge_mode(project, role, auto\|manual)` | **はい** | ロールのモードを設定 |
| `bridge_set(project, role, {...})` | **はい** | ロールを設定する（cwd/model/tmuxTarget/permissionMode） |
| `bridge_settings({...})` | **はい** | 全体の設定値（driver/maxHops/rate/…） |

### CLI

```bash
# バスを確認する（任意のロールを自分の身元として使う）
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge roles
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge send frontend "hello"
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge tail 20
session-bridge root            # バスの保存ディレクトリ

# スポーナー
session-bridge spawner set <project> <role> cwd=<path> [model=<m>] [tmuxTarget=<t>]
session-bridge spawner on  [project] [role]
session-bridge spawner off [project] [role]
session-bridge spawner status
session-bridge spawner run [--replay]
```

### 環境変数

| 変数 | 必須 | 既定 | 意味 |
|-----|----------|---------|---------|
| `BRIDGE_PROJECT` | はい | — | プロジェクト（部屋）名 — 隔離の境界 |
| `BRIDGE_ROLE` | はい | — | このセッションのロール（ニックネーム） |
| `BRIDGE_ADMIN` | いいえ | オフ | `1` にすると、このセッションが自動化設定を変更できる |
| `BRIDGE_ROOT` | いいえ | `~/.claude/bridge` | メッセージ／設定の保存先 |
| `BRIDGE_BLOCK_GIT` | いいえ | `commit\|push\|reset` | block-git フックが拒否する git 操作の正規表現 |
| `BRIDGE_AUTOSEND` | いいえ | オフ | `1` で Stop 時の自動送信フックを有効化 |
| `BRIDGE_SEND_TO` | いいえ | `*` | 自動送信の既定の宛先 |
| `BRIDGE_HOP` | いいえ | `0` | ループ防止のホップ数（spawn ドライバーが設定する） |

### 任意：毎ターン自動送信する

既定ではオフです。意図的な `bridge_send` のほうが望ましいからです。セッションの最後の
メッセージを毎ターン自動的にブロードキャストしたい場合は、`BRIDGE_AUTOSEND=1` を設定し、
`settings.json` に Stop フック（`dist/hooks/send.js`）を追加します。宛先は
`BRIDGE_SEND_TO` で上書きできます。意図的な送信よりノイズが多く、トークンも多く消費
します。

### しくみ（知りたい方へ）

メッセージと設定は `BRIDGE_ROOT` の下にある単なるファイルです。

```
~/.claude/bridge/
  spawner.config.json          自動化設定（ライブで編集される）
  <project>/
    <role>.inbox.jsonl         そのロール宛てメッセージの追記専用ログ
    .cursors/<role>.cursor     そのロールが読んだメッセージ数
    .sessions/<role>.pane      tmux のペインID。tmux ドライバーが探すために使う
```

`bridge_send` は受信側の受信箱に追記します。受信フックは、あなたのカーソル位置から先の
受信箱を読み、新しい行を注入し、カーソルを進めます。そのため同じメッセージを二度見る
ことはありません。隔離は、プロジェクトごとのフォルダそのものです。

### テスト

```bash
npm test             # MCP バスのエンドツーエンド
npm run test:config  # 設定ダッシュボード + 管理者ゲート
npm run test:prompts # /mcp プロンプトが変更を適用する（管理者ゲート）
npm run test:spawner # spawn ドライバーのピンポン + ループ防止
npm run test:tmux    # tmux ドライバーのピンポン + ループ防止
npm run test:real    # `claude -p` を使った実際の2セッションテスト
```

### ライセンス

MIT
