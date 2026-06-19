<div align="center">

[![English](https://img.shields.io/badge/English-555?style=for-the-badge)](README.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-555?style=for-the-badge)](README.ko.md)
[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-555?style=for-the-badge)](README.zh.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-2ea44f?style=for-the-badge)](README.ja.md)

</div>

# claude-session-bridge

**2つ（あるいはそれ以上）の Claude Code セッション同士を会話させ、必要なら自律的に
連携させましょう。**

たとえば、**backend** 用に Claude Code セッションを1つ開き、**frontend** 用にもう1つ
開いたとします。通常、この2つはお互いのことをまったく知りません。backend が API を
変更したら、その結果を手作業でコピー＆ペーストして frontend セッションに貼り付ける
必要があります。

このツールはそのコピー＆ペーストをなくします。あるセッションが結果を**送信（send）**
すると、同じ部屋にいる他のセッションがそれを**自動的に受信（receive）**します。任意の
オートモードを有効にすれば、作業を終えた backend が frontend を**起こして**反応させる
こともできます。つまり、人手を介さないピンポン（往復）です。その間も、安全装置
（自動コミットなし、デプロイのゲート、ループ防止）は完全にあなたの管理下にあり、
あらゆる設定を Claude の中から変更できます。

> はじめての方へ。上から下まで読んでください。必要なコマンドはすべて載っています。
> 内部の仕組みを理解しなくても使えます。

---

## 目次

- [イメージで理解する](#イメージで理解する)
- [必要なもの](#必要なもの)
- [インストール（最初の1回だけ）](#インストール最初の1回だけ)
- [2つのセッションをつなぐ](#2つのセッションをつなぐ)
  - [変数を設定する2つの方法](#変数を設定する2つの方法)
  - [tmux を使う](#tmux-を使う)
- [メッセージを送受信する](#メッセージを送受信する)
- [ロールはただのラベル](#ロールはただのラベル)
- [複数のプロジェクトを同時に動かす](#複数のプロジェクトを同時に動かす)
- [オートモード：イベントスポナー](#オートモードイベントスポナー)
  - [2つのドライバー：tmux と spawn](#2つのドライバーtmux-と-spawn)
  - [設定して実行する](#設定して実行する)
  - [安全装置](#安全装置)
  - [機微なロールはデフォルトでオフ](#機微なロールはデフォルトでオフ)
  - [絶対に自動コミットしない（許可する方法も）](#絶対に自動コミットしない許可する方法も)
  - [自動デプロイには注意](#自動デプロイには注意)
- [Claude の中から設定を変更する](#claude-の中から設定を変更する)
- [リファレンス](#リファレンス)

---

## イメージで理解する

考え方はシンプルに2つだけです。

- **プロジェクト = チャットルーム。** 同じプロジェクト名で起動したセッションは同じ
  部屋にいて、会話できます。プロジェクト名が違えば別の部屋となり、隔離されます。
- **ロール = その部屋でのあなたのニックネーム。** `backend`、`frontend`、`infra` など、
  好きなラベルで構いません。メッセージはロール宛てに送ります。

```
セッション1   プロジェクト "shop"  ロール "backend"  ┐
                                                    ├─ 部屋 "shop"（会話できる）
セッション2   プロジェクト "shop"  ロール "frontend" ┘

セッション3   プロジェクト "blog"  ロール "backend"  ─── 部屋 "blog"（別の部屋・隔離）
```

「接続」ボタンのようなものは**ありません**。同じプロジェクト名で2つのセッションを
起動すること、それ自体が「つなぐ」ことなのです。

---

## 必要なもの

- **Node.js 18 以上** — `node --version` で確認できます
- **Claude Code**（`claude` コマンド） — `claude --version` で確認できます
- **tmux** — 推奨です。デフォルトのオートモード用ドライバーは、これを使って起動中の
  セッションを操作します。（バスだけを使う場合や `spawn` ドライバーを使う場合は不要
  です。）

---

## インストール（最初の1回だけ）

これは**1回だけ**行います。その後はこれらのファイルを編集することは二度とありません。
セッションごとに変わるのは2つの環境変数だけです（次のセクションで説明します）。

**1. コードを取得してビルドします。**

```bash
git clone <this-repo-url> claude-session-bridge-mcp
cd claude-session-bridge-mcp
npm install
npm run build
```

**2. ブリッジを登録します。** これは **Claude Code セッションの中で**実行してください
（そうすると、そのセッションの設定ディレクトリが対象になります。下の注記を参照）。

```bash
npm link                  # 任意：`session-bridge` を PATH に登録します
session-bridge install    # MCP サーバーとフックを登録します
session-bridge doctor     # 何がどこに設定されたかを確認します
```

`install` は、MCP サーバー、**受信（receive）**フック、そして **block-git** フック
（`git commit`／`push`／`reset` をブロックします）を、あなたの有効な settings.json に
マージします。冪等（べきとう）に動作し、他の設定には手を触れません。セッション自身が
コミットすることを*許可したい*場合は `--no-block-git` を付けてください。（`session-bridge`
が `PATH` にない場合は `node /ABSOLUTE/PATH/dist/cli.js install` を実行してください。）

> **仕事用アカウント／複数プロファイルについて。** Claude Code は、環境変数
> `CLAUDE_CONFIG_DIR` が設定されている場合は `$CLAUDE_CONFIG_DIR/settings.json` を
> 読み込みます（仕事用に別のログインを使っている場合によくあります）。設定されて
> いない場合は `~/.claude/settings.json` を読み込みます。これこそが「設定を編集したのに
> 何も変わらない」という問題の最大の原因です。別のファイルを編集してしまっているのです。
> **そのプロファイルのセッションの中で** `session-bridge install` を実行すれば、正しい
> ファイルが自動的に対象になります。プロファイルごとに1回ずつ実行してください。
> `session-bridge doctor` で確認できます。これは有効な設定ディレクトリを表示します。

<details>
<summary>手動での settings.json 設定（自分で編集したい場合）</summary>

正しい settings.json に次を追加します（`/ABSOLUTE/PATH` は置き換えてください）。

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
</details>

すべてのフックは、ブリッジを使っていないセッションでは安全に何もしません。そのため、
グローバルにインストールしても問題ありません。セットアップは以上ですべてです。

---

## 2つのセッションをつなぐ

セッションを部屋に入れるには、**起動するとき**に2つの値を渡します。

| 変数 | 意味 | 例 |
|----------|---------|---------|
| `BRIDGE_PROJECT` | 部屋の名前 | `shop` |
| `BRIDGE_ROLE` | このセッションのニックネーム | `backend` |

```bash
# ターミナル1 — プロジェクト "shop" の backend
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend claude

# ターミナル2 — プロジェクト "shop" の frontend
BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude
```

どちらもプロジェクト `shop` を使ったので、同じ部屋にいて会話できます。

### 変数を設定する2つの方法

どちらか一方を選んでください。**ただし混同しないこと。これは初心者がいちばん犯しやすい
ミスです。**

**方法A — 同じ行に書く（最もシンプルでおすすめ）：**

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude
```

この変数はその1回の `claude` にだけ適用されます。後片付けは不要です。

**方法B — 先に設定してから起動する。** 別々の行に書く場合は、**必ず** `export` を
使ってください。

```bash
export BRIDGE_PROJECT=shop
export BRIDGE_ROLE=frontend
claude
```

> ⚠️ **落とし穴：** `export` **なし**で `BRIDGE_PROJECT=shop` を単独の行に書くと、
> `claude` には**見えない**シェル変数になってしまい、ブリッジは静かに接続しません。
> `export` を使う（方法B）か、すべてを1行に書いてください（方法A）。

**ヒント — エイリアスを作る**と、毎回打ち込まずに済みます。`~/.zshrc`（または
`~/.bashrc`）に次を書きます。

```bash
alias shop-back='BRIDGE_PROJECT=shop BRIDGE_ROLE=backend claude'
alias shop-front='BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude'
```

### tmux を使う

tmux は起動方法を何も変えません。各ペインはそれぞれが独立したシェルで、別々の
ターミナルのようなものです。各ペインで変数を設定して `claude` を実行します。

```
tmux
 ├ ペイン1:  BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude
 ├ ペイン2:  BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude   ← ペイン1と同じ部屋
 └ ペイン3:  BRIDGE_PROJECT=blog BRIDGE_ROLE=backend  claude   ← 別の部屋
```

tmux がいちばん重要になるのは**オートモード**です。デフォルトのドライバーは、これらの
起動中のペインを自動的に起こします（[イベントスポナー](#オートモードイベントスポナー)
を参照）。tmux の中で起動したセッションは、自分のペインを自動的に登録します。手動の
設定は不要です。

> あるペインで `export`（方法B）を使い、その後**同じ**ペインで*別の*プロジェクトの
> `claude` を起動すると、古い `export` が残ってしまいます。tmux の中では、思わぬ動作を
> 避けるために方法Aを使うのがおすすめです。

---

## メッセージを送受信する

2つのセッションが部屋を共有していれば、これだけで動きます。

1. **backend** セッションで、共有する価値のあるものができたとき：
   > 「新しい `/users` のレスポンス形式を frontend セッションに送って。」

   すると `bridge_send` ツールが呼ばれ、メッセージが届けられます。

2. **frontend** セッションでは、次に何かを入力したときに、そのメッセージが
   コンテキストに**自動的に追加**されます。コピー＆ペーストは不要です。

これがデフォルトの（「バス」）モードです。**送信は意図的に行われ**（モデルは大量の文章
ではなく、本当の結果を共有します）、**受信は次のターンで自動的に**行われます。主導権は
まだあなたにあります。

どちらのセッションでも明示的に指示することもできます。*「ブリッジに新しいメッセージが
ないか確認して」*（`bridge_recv`）や、*「これを infra に送って：ステージングの準備が
できました」*（`bridge_send`）のように。

> あるセッションが作業を終えても共有する価値のあるものがなければ、単に送信しません。
> 何もバスには流れず、ピンポンは自然に終わります。アイドル状態のセッションが部屋を
> 荒らすことはありません。

---

## ロールはただのラベル

ロールは**好きな文字列なら何でも**構いません。`backend`／`frontend` だけではありません。
1つの部屋には好きなだけセッションを追加できます。

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=web      claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=infra    claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=qa       claude
```

送信するときは、特定のロール宛てに送る（`to: "infra"`）か、それ以外の全員にブロード
キャストする（`to: "*"`）かを指定します。`frontend` 宛てに送られたメッセージは `frontend`
に**だけ**届きます。`infra`／`qa` はそれを目にすることすらないので、誤って反応する
こともありません。（全員に届くのは `to: "*"` のときだけです。）そのため、複数ステップの
流れも自然に表現できます。

> backend が API を完成 → **web** に伝える → web が UI を更新 → **infra** に伝える
> → infra が再デプロイする。

その連鎖が**自動で**走るかどうかは、下記のスポナー次第です。デプロイについては、まず
[自動デプロイには注意](#自動デプロイには注意)を読んでください。

---

## 複数のプロジェクトを同時に動かす

異なるプロジェクト名を使います。お互いのメッセージを見ることは決してありません。

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude   # 部屋 "shop"
BRIDGE_PROJECT=blog BRIDGE_ROLE=frontend claude   # 部屋 "blog" — 隔離されている
```

隔離は構造的なもの（メッセージはプロジェクトごとのフォルダの下に保存されます）なので、
`shop` と `blog` が混ざり合うことはありません。

---

## オートモード：イベントスポナー

ここまでの内容はすべて**あなた**をループに含めています。セッションはあなたがターンを
与えたときにだけ動きます。**イベントスポナー**は、そのステップをなくす任意のバック
グラウンドプログラム（デーモン）です。あるロールがメッセージを受信すると、スポナーは
**そのロールを自動的に起こして**対応させます。これにより、人を間に挟まずに両者が
ピンポンできます。これは専用のターミナルで実行します。オプトイン方式で、簡単にオフに
できます。

### 2つのドライバー：tmux と spawn

**ドライバー**は、ロールを*どうやって*起こすかを決めます。

| | **tmux**（デフォルト） | **spawn** |
|---|---|---|
| 何をするか | **すでに開いている起動中のセッション**に文字を打ち込む（`tmux send-keys`） | イベントごとに**新しい `claude -p`** プロセスを起動する |
| セッション | 同じものが継続する（コンテキストを保持） | 毎回新しいセッション |
| 見える？ | はい — ペインの中で見られます | バックグラウンド（ログのみ） |
| `claude -p` を使う？ | **いいえ** | はい |
| tmux が必要？ | はい | いいえ |

たとえるなら、**tmux** はすでに席にいる従業員を肩を叩いて呼ぶようなもの。**spawn** は
タスクごとに新しい派遣スタッフを雇うようなものです。

tmux がデフォルトな理由：あなたがすでに作業している*開いている*セッションを連携させ、
コンテキストを保持し、見たり中断したりでき、しかも **`claude -p` を使いません**
（そのため、ヘッドレス／SDK の課金の変更の影響を受けません）。tmux を実行できない場合や、
隔離された使い切りの実行をしたい場合は `spawn` を使ってください。

### 設定して実行する

ロールは、セットアップして初めて自動的に起こされます。標準状態ではスポナーは何もしない
ので、ロールごとにオプトインしていきます。

```bash
# tmux ドライバー：tmux の中でそのロールのセッションを開くだけ — ペインが自動登録されます。
# spawn ドライバー：そのロールのコードがどこにあるかを伝えます：
session-bridge spawner set shop backend cwd=/path/to/backend

session-bridge spawner on              # 全体で有効化する
session-bridge spawner off shop        # ...またはプロジェクト単位で
session-bridge spawner off shop web    # ...または1つのロールだけ
session-bridge spawner status          # 現在の設定を確認する
```

（`session-bridge` はこのパッケージとともにインストールされる CLI です。`PATH` にない
場合は `node /ABSOLUTE/PATH/dist/cli.js spawner ...` を実行してください。）

デーモンは専用のターミナルで実行します。

```bash
session-bridge spawner run             # フォアグラウンド；Ctrl-C で停止
# またはバックグラウンドで実行する：
nohup session-bridge spawner run > ~/.claude/bridge/spawner.log 2>&1 &
```

設定はイベントごとに再読み込みされるので、`on`／`off` などの変更は**その場で**
反映されます。再起動は不要です。

### 安全装置

| 安全装置 | デフォルト | 何をするか |
|------|---------|--------------|
| `maxHops`（ループ防止） | 6 | プロジェクトごとの連鎖カウンターが、連続した自動起動の回数に上限を設けます。静かな時間が空くとリセットされます。暴走するピンポンを抑えます（両ドライバーで機能します）。 |
| `rateLimitPerMinute` | 12 | 1ロールあたり1分間の自動起動の最大回数。 |
| 機微なロール | `infra`、`qa` | 明示的に有効化しない限り、決して自動起動されません。誤配信されたメッセージがデプロイを引き起こすことはありません。 |
| 自動コミットなし | オン | `git commit`／`push`／`reset` をブロックします（下記参照）。 |
| シングルフライト／クールダウン | — | 1ロールにつき同時に1回の実行のみ（spawn）。再ナッジのクールダウン（tmux）。 |
| ターゲット必須 | — | 起動中のペインがない（tmux）、または cwd がない（spawn）ロールは決して起こされません。 |

### 機微なロールはデフォルトでオフ

`infra` と `qa` は `defaultOffRoles` に入った状態で出荷されます。スポナーは
**設定されていてもこれらを自動起動しません。** 名前を指定して明示的にオプトインする
必要があります。

**なぜ？** メッセージの*宛先*を選ぶのは送信側であり、その送信側は言語モデルだからです。
もしブロードキャスト（`to: "*"`）したり、宛先を間違えたりすると、`infra`／`qa` が本来
向けられていない要求を受け取ってしまうおそれがあります。そしてこれらのロールは最も
危険なこと（デプロイ、リリース、破壊的なテスト）を行います。これらをオフにしておくこと
は、モデルが正しく宛先を指定することに**依存しない**保証になります。誤配信された
メッセージは、人がそのセッションを開くまで受信箱にただ残るだけです。

**オンにする（完全な自動化を望む場合）：**

```bash
session-bridge spawner on shop infra      # 明示的なオプトイン（必須）
```

まず[自動デプロイには注意](#自動デプロイには注意)を読んでください。リストを変更するには、
`<BRIDGE_ROOT>/spawner.config.json` の中の `defaultOffRoles` を編集します。

### 絶対に自動コミットしない（許可する方法も）

デフォルトでは、自動で動かされるセッションはコミットできません。これを**2層**で
強制します。

1. **spawn ドライバー：** セッションは
   `--disallowed-tools "Bash(git commit:*)" "Bash(git push:*)" ...` 付きで起動します。
   拒否ルールは許可／バイパスより優先されるので、モデルは物理的にコミットできません。
2. **tmux ドライバー（起動中のセッション）：** これらのフラグは適用されないので、
   **`block-git` PreToolUse フック**をインストールします（[インストール](#インストール最初の1回だけ)
   にあります）。これは、どのようにターンが起動されたかに関わらず、あらゆるセッションで
   `git commit`／`push`／`reset` を拒否します。

> `CLAUDE.md` のリマインダー（「コミットしないで」）はあると良いものですが、自律的な
> ループには**不十分**です。モデルは方針からそれることがあります。フック／拒否ルール
> こそが本当の保証です。

**コミット／プッシュの自動化を本当に望む場合**（そういう人もいます）は、オプトアウト
します。

- `block-git` フックをインストールしない。**さらに**
- spawn ドライバーのために `denyTools`（`session-bridge spawner` の設定）から git の
  項目を削除する。
- もしくは `BRIDGE_BLOCK_GIT`（正規表現。例：commit は許可しつつ push はブロックする）で、
  ブロックする対象を絞り込む。

> ⚠️ 自動 `push` は外部に向かう操作で、取り消すのが困難です。許可するなら、**フィーチャー
> ブランチ**にプッシュし、`main` を保護してください（ブランチ保護）。`main` に自動
> プッシュしてはいけません。

### 自動デプロイには注意

⚠️ コミット／プッシュはブロックされます。しかし、**デプロイは git ではありません。**
`kubectl apply`、`vercel deploy`、`terraform apply`、SSH デプロイスクリプトなどは、
どれもデフォルトではブロックされません。そのため、自律的な `infra` セッションがそれらを
実行してしまう可能性があります。デプロイは外部に向かう操作で取り消すのが困難であり、
人がいない状態で行うのはリスクがあります。

`infra` をループに含めたい場合は、次のいずれかを選んでください。

1. **infra を手動のままにする**（デフォルト。オフです）。メッセージはキューに溜まります。
   あなたがセッションを開いて、自分でデプロイします。
2. **デプロイコマンドをブロックする**（`denyTools` または block-git の正規表現に追加します）。
3. **安全なステップだけを自動化する** — ステージング／ドライランは自動、本番は手動。

---

## Claude の中から設定を変更する

JSON を編集したり、CLI のフラグを覚えたりする必要はありません。MCP サーバーを使えば、
あらゆる自動化設定を **Claude セッションの中から**読み書きできます。会話形式でも `/mcp`
経由でも操作できる、ダッシュボードのようなものです。

**安全性：管理者ゲート付き。** 設定を*変更*できるのは、`BRIDGE_ADMIN=1` を付けて起動
したセッション（あなたの「control」セッション）だけです。自動で動かされるセッションは
これを持たないので、暴走したループが自分の安全設定を勝手に切り替えることはできません。
設定の読み取りは常に許可されています。

```bash
# あなたの control ／ダッシュボード用セッション
BRIDGE_PROJECT=shop BRIDGE_ROLE=control BRIDGE_ADMIN=1 claude
```

**操作する2つの方法：**

**A. ただ話しかける**（モデルがツールを呼び出します）：

> 「ブリッジの設定を見せて。」・「frontend を auto にして。」・「maxHops 3、driver は
> tmux で。」・「自動化をオフにして。」

**B. `/mcp` プロンプト**（その場で変更を適用するスラッシュコマンド）：

```
/mcp__session-bridge__show-config       現在の設定を表示する
/mcp__session-bridge__set-mode          project、role、auto|manual
/mcp__session-bridge__configure-role    cwd / model / tmuxTarget
/mcp__session-bridge__set-driver        tmux | spawn
/mcp__session-bridge__automation        on | off （マスタースイッチ）
/mcp__session-bridge__set-limits        maxHops / rateLimitPerMinute
```

どれか1つを選び、引数を埋めると、すぐに変更が書き込まれます（管理者セッションのみ）。
デーモンがそれをその場で拾います。

---

## リファレンス

### ツール（セッションから呼び出せます）

| ツール | 管理者？ | 目的 |
|------|--------|---------|
| `bridge_send(to, body)` | いいえ | ロール宛てに送信、または `"*"` でブロードキャスト |
| `bridge_recv()` | いいえ | 未読メッセージを取り出して消費する |
| `bridge_peek()` | いいえ | 消費せずに未読をプレビューする |
| `bridge_tail(limit?)` | いいえ | 最近のメッセージを確認する |
| `bridge_roles()` | いいえ | プロジェクト内のロール一覧を表示する |
| `bridge_whoami()` | いいえ | このセッションのプロジェクト＋ロールを表示する |
| `bridge_config()` | いいえ | 自動化設定を表示する |
| `bridge_mode(project, role, auto\|manual)` | **はい** | ロールのモードを設定する |
| `bridge_set(project, role, {...})` | **はい** | ロールを設定する（cwd/model/tmuxTarget/permissionMode） |
| `bridge_settings({...})` | **はい** | グローバルなつまみ（driver/maxHops/rate/…） |

### CLI

```bash
# セットアップ（有効な設定ディレクトリが対象：$CLAUDE_CONFIG_DIR または ~/.claude）
session-bridge install [--no-block-git] [--config-dir <dir>]
session-bridge doctor

# バスを確認する（任意のロールをあなたの身元として使えます）
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge roles
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge send frontend "hello"
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge tail 20
session-bridge root            # バスの保存ディレクトリ

# スポナー
session-bridge spawner set <project> <role> cwd=<path> [model=<m>] [tmuxTarget=<t>]
session-bridge spawner on  [project] [role]
session-bridge spawner off [project] [role]
session-bridge spawner status
session-bridge spawner run [--replay]
```

### 環境変数

| 変数 | 必須 | デフォルト | 意味 |
|-----|----------|---------|---------|
| `BRIDGE_PROJECT` | はい | — | プロジェクト（部屋）名 — 隔離の境界 |
| `BRIDGE_ROLE` | はい | — | このセッションのロール（ニックネーム） |
| `BRIDGE_ADMIN` | いいえ | オフ | `1` にすると、このセッションが自動化設定を変更できる |
| `BRIDGE_ROOT` | いいえ | `~/.claude/bridge` | メッセージ／設定が保存される場所 |
| `BRIDGE_BLOCK_GIT` | いいえ | `commit\|push\|reset` | block-git フックが拒否する git 操作の正規表現 |
| `BRIDGE_AUTOSEND` | いいえ | オフ | `1` にすると Stop 時の自動送信フックが有効になる |
| `BRIDGE_SEND_TO` | いいえ | `*` | 自動送信のデフォルトの宛先 |
| `BRIDGE_HOP` | いいえ | `0` | ループ防止のホップ（spawn ドライバーが設定する） |

### 任意：毎ターン自動送信する

デフォルトはオフです。意図的な `bridge_send` のほうが好まれます。セッションの最後の
メッセージを毎ターン自動的にブロードキャストするには、`BRIDGE_AUTOSEND=1` を設定し、
`settings.json` に Stop フック（`dist/hooks/send.js`）を追加します。宛先は
`BRIDGE_SEND_TO` で上書きできます。意図的な送信よりもノイズが多く、トークンも多く
消費します。

### 仕組み（興味のある方へ）

メッセージと設定は、`BRIDGE_ROOT` の下にある単なるファイルです。

```
~/.claude/bridge/
  spawner.config.json          自動化設定（その場で編集される）
  <project>/
    <role>.inbox.jsonl         そのロール宛てメッセージの追記専用ログ
    .cursors/<role>.cursor     そのロールが読んだメッセージ数
    .sessions/<role>.pane      tmux ペイン id。tmux ドライバーがそれを見つけるため
```

`bridge_send` は受信者の受信箱に追記します。受信フックは、あなたの受信箱をあなたの
カーソル位置から先へ読み、新しい行を注入して、カーソルを進めます。そのため、同じ
メッセージを二度見ることはありません。隔離は、プロジェクトごとのフォルダそのものです。

### テスト

```bash
npm test             # MCP バスのエンドツーエンド
npm run test:config  # 設定ダッシュボード＋管理者ゲート
npm run test:prompts # /mcp プロンプトが変更を適用する（管理者ゲート付き）
npm run test:spawner # spawn ドライバーのピンポン＋ループ防止
npm run test:tmux    # tmux ドライバーのピンポン＋ループ防止
npm run test:real    # `claude -p` を使った実際の2セッションテスト
```

### ライセンス

MIT
