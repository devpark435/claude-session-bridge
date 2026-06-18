<div align="center">

[![English](https://img.shields.io/badge/English-555?style=for-the-badge)](README.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-555?style=for-the-badge)](README.ko.md)
[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-2ea44f?style=for-the-badge)](README.zh.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-555?style=for-the-badge)](README.ja.md)

</div>

# claude-session-bridge-mcp

**让两个（或更多）Claude Code 会话互相通信——并且可以选择让它们自我编排。**

你为**后端**打开了一个 Claude Code 会话，又为**前端**打开了另一个。
通常它们彼此一无所知——当后端改动了某个 API，你只能手动把结果从后端会话
复制粘贴到前端会话里。

这个工具去掉了复制粘贴这一步。一个会话**发送**它的结果；其他同伴会话会
**自动接收**它。打开可选的自动模式，完成任务的后端就能**唤醒**前端去做出
反应——全程不用动手的乒乓往返——同时你仍然牢牢掌控着所有安全护栏（不自动
提交、部署关卡、循环防护），并且可以在 Claude 内部修改每一项设置。

> 第一次接触？请从头读到尾——每条命令都包含在内。你不需要理解内部原理就能用它。

---

## 目录

- [如何想象它](#如何想象它)
- [环境要求](#环境要求)
- [安装（只需一次）](#安装只需一次)
- [连接两个会话](#连接两个会话)
  - [设置变量的两种方式](#设置变量的两种方式)
  - [使用 tmux](#使用-tmux)
- [发送和接收消息](#发送和接收消息)
- [角色只是标签](#角色只是标签)
- [同时运行多个项目](#同时运行多个项目)
- [自动模式：事件生成器](#自动模式事件生成器)
  - [两种驱动：tmux 与 spawn](#两种驱动tmux-与-spawn)
  - [配置并运行](#配置并运行)
  - [安全护栏](#安全护栏)
  - [敏感角色默认关闭](#敏感角色默认关闭)
  - [永不自动提交（以及如何允许它）](#永不自动提交以及如何允许它)
  - [小心自动部署](#小心自动部署)
- [在 Claude 内部修改设置](#在-claude-内部修改设置)
- [参考](#参考)

---

## 如何想象它

两个简单的概念：

- **项目 = 一个聊天室。** 用同一个项目名启动的会话处在同一个房间里，可以互相
  通信。不同的项目名 = 不同的房间，彼此隔离。
- **角色 = 你在那个房间里的昵称。** `backend`、`frontend`、`infra`——任何你
  喜欢的标签都行。你把消息发给某个角色。

```
会话 1   项目 "shop"  角色 "backend"  ┐
                                     ├─ 房间 "shop"（它们互相通信）
会话 2   项目 "shop"  角色 "frontend" ┘

会话 3   项目 "blog"  角色 "backend"  ─── 房间 "blog"（独立、隔离）
```

这里**没有"连接"按钮。** 用同一个项目名启动两个会话，*本身*就是把它们连接起来了。

---

## 环境要求

- **Node.js 18+** —— 用 `node --version` 检查
- **Claude Code**（即 `claude` 命令）—— 用 `claude --version` 检查
- **tmux** —— 推荐安装；默认的自动模式驱动通过它来驱动你正在运行的实时会话。
  （如果你只用消息总线，或者使用 `spawn` 驱动，则不需要它。）

---

## 安装（只需一次）

这一步你只做**一次。** 之后你再也不用编辑这些文件——每个会话唯一会变的，
是两个环境变量（下面会解释）。

**1. 获取代码并构建。**

```bash
git clone <this-repo-url> claude-session-bridge-mcp
cd claude-session-bridge-mcp
npm install
npm run build
```

**2. 找到这个文件夹的绝对路径** —— 你会把它粘贴进配置里：

```bash
pwd
# 示例：/Users/you/projects/claude-session-bridge-mcp
```

**3. 在 Claude Code 中注册这个桥接器。** 打开 `~/.claude/settings.json`
（如果没有就新建），加入下面这些代码块。把 `/ABSOLUTE/PATH` 替换为
`pwd` 打印出来的内容。

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

- `mcpServers` 添加了会话用来**发送**消息的工具，以及（在管理员会话中）用来
  修改设置的工具。
- `UserPromptSubmit` 钩子让会话能**自动接收**消息。
- `PreToolUse` 钩子会在任何会话中**拦截 `git commit`/`push`/`reset`**
  （推荐——参见[永不自动提交](#永不自动提交以及如何允许它)）。
  如果你*希望*会话自己提交，就跳过它。

> 如果 `settings.json` 里已经有这些键，请合并进去。这三个钩子在未桥接的会话中
> 都会安全地空操作，所以全局安装它们没有问题。

这就是全部的安装步骤。

---

## 连接两个会话

要把一个会话放进某个房间，**在启动它时**给它两个值：

| 变量 | 含义 | 示例 |
|----------|---------|---------|
| `BRIDGE_PROJECT` | 房间名 | `shop` |
| `BRIDGE_ROLE` | 这个会话的昵称 | `backend` |

```bash
# 终端 1 —— 项目 "shop" 的后端
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend claude

# 终端 2 —— 项目 "shop" 的前端
BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude
```

两者都用了项目 `shop`，所以它们在同一个房间里，可以互相通信。

### 设置变量的两种方式

二选一——**但别把两种方式搞混；这是新手最常犯的头号错误。**

**方式 A —— 写在同一行（最简单，推荐）：**

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude
```

这些变量只对那一个 `claude` 生效。没有任何需要清理的东西。

**方式 B —— 先设置，再启动。** 分行写时你**必须**用 `export`：

```bash
export BRIDGE_PROJECT=shop
export BRIDGE_ROLE=frontend
claude
```

> ⚠️ **陷阱：** 在单独一行上写 `BRIDGE_PROJECT=shop` 而**不加** `export`，
> 设置的只是一个 `claude` **看不到**的 shell 变量——桥接器会悄无声息地连接不上。
> 请使用 `export`（方式 B），或者把所有内容写在一行里（方式 A）。

**小技巧——创建别名**，省得反复输入。在 `~/.zshrc`（或 `~/.bashrc`）里：

```bash
alias shop-back='BRIDGE_PROJECT=shop BRIDGE_ROLE=backend claude'
alias shop-front='BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude'
```

### 使用 tmux

tmux 对启动方式没有任何改变——每个窗格都是它自己的 shell，就像一个独立的终端。
在每个窗格里设置好变量，然后运行 `claude`：

```
tmux
 ├ 窗格 1:  BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude
 ├ 窗格 2:  BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude   ← 与窗格 1 同一个房间
 └ 窗格 3:  BRIDGE_PROJECT=blog BRIDGE_ROLE=backend  claude   ← 不同的房间
```

tmux 对**自动模式**最为关键：默认驱动会自动唤醒这些实时窗格
（参见[事件生成器](#自动模式事件生成器)）。在 tmux 内部启动的会话会自己
注册它的窗格——无需手动设置。

> 如果你在某个窗格里用了 `export`（方式 B），之后又在**同一个**窗格里启动了
> *另一个*项目的 `claude`，旧的 `export` 就会残留下来。在 tmux 里建议使用
> 方式 A，以免出现意外。

---

## 发送和接收消息

一旦两个会话共享一个房间，这件事就自然成立：

1. 在**后端**会话里，当你有值得分享的东西时：
   > "把新的 `/users` 响应结构发给前端会话。"

   它会调用 `bridge_send` 工具来投递这条消息。

2. 在**前端**会话里，下一次你输入任何内容时，那条消息都会被**自动加入**它的
   上下文——无需复制粘贴。

这就是默认模式（即"总线"模式）：**发送是刻意为之的**（模型分享的是一个真实的
结果，而不是一大堆文字），而**接收在下一回合自动发生**。你仍然在掌舵。

你也可以在任一会话里显式操作：*"检查桥接器有没有新消息"*
（`bridge_recv`），或者 *"把这个发给 infra：staging 已就绪"*
（`bridge_send`）。

> 如果一个会话完成后没有值得分享的内容，它就干脆不发送——总线上不会有任何东西，
> 任何乒乓往返都会自然结束。空闲的会话不会刷屏整个房间。

---

## 角色只是标签

角色就是**任何你想要的字符串**——不仅限于 `backend`/`frontend`。你可以
往一个房间里加任意多的会话：

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=web      claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=infra    claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=qa       claude
```

发送时，可以指定某个具体角色（`to: "infra"`），或者广播给其他所有人
（`to: "*"`）。一条发给 `frontend` 的消息**只会**投递给 `frontend`——
`infra`/`qa` 根本看不到它，所以它们不会因此误操作。
（只有 `to: "*"` 才会触达所有人。）因此多步骤的流程很自然：

> 后端完成一个 API → 告诉 **web** → web 更新 UI → 告诉 **infra**
> → infra 重新部署。

这条链路是否会**自动**运行，取决于下面的生成器——而对于部署，请先阅读
[小心自动部署](#小心自动部署)。

---

## 同时运行多个项目

使用不同的项目名；它们永远看不到彼此的消息：

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude   # 房间 "shop"
BRIDGE_PROJECT=blog BRIDGE_ROLE=frontend claude   # 房间 "blog" —— 隔离
```

隔离是结构性的（消息存放在每个项目各自的文件夹下），所以 `shop`
和 `blog` 无法互相串到一起。

---

## 自动模式：事件生成器

上面的一切都把**你**留在闭环里——一个会话只有在你给它一个回合时才会行动。
**事件生成器**是一个可选的后台程序（一个守护进程），它去掉了那一步：当某个
角色收到消息时，生成器会**自动唤醒那个角色**去处理它，于是双方可以在没有人
介入的情况下乒乓往返。你在它自己的终端里运行它；它是可选启用的，而且很容易关掉。

### 两种驱动：tmux 与 spawn

**驱动**决定了角色*以何种方式*被唤醒：

| | **tmux**（默认） | **spawn** |
|---|---|---|
| 它做什么 | 向你**已经打开的实时会话**里输入内容（`tmux send-keys`） | 为每个事件启动一个**全新的 `claude -p`** 进程 |
| 会话 | 同一个会话继续（保留上下文） | 每次都是新会话 |
| 可见吗？ | 可见——你能在窗格里看着它 | 后台（只有日志） |
| 用 `claude -p` 吗？ | **不用** | 用 |
| 需要 tmux 吗？ | 需要 | 不需要 |

打个比方：**tmux** 是去拍一拍已经坐在工位上的员工；**spawn** 是为每个任务
临时雇一个新的临时工。

为什么 tmux 是默认：它编排的是你*已经*在工作的那些*打开着的*会话，保留它们的
上下文，让你能看着并随时打断，而且**不使用 `claude -p`**（所以它不受 headless/
SDK 计费变动的影响）。当你无法运行 tmux 或者想要隔离的一次性运行时，才用 `spawn`。

### 配置并运行

只有在角色设置好之后，它才会被自动唤醒——开箱即用时生成器什么都不做，所以你
要逐个角色地选择启用：

```bash
# tmux 驱动：只要在 tmux 里打开该角色的会话——它的窗格会自动注册。
# spawn 驱动：告诉它该角色的代码在哪里：
session-bridge spawner set shop backend cwd=/path/to/backend

session-bridge spawner on              # 全局启用
session-bridge spawner off shop        # ……或按项目
session-bridge spawner off shop web    # ……或单个角色
session-bridge spawner status          # 查看当前配置
```

（`session-bridge` 是随本包一起安装的 CLI。如果它不在你的 `PATH` 上，
就运行 `node /ABSOLUTE/PATH/dist/cli.js spawner ...`。）

在它自己的终端里运行这个守护进程：

```bash
session-bridge spawner run             # 前台运行；按 Ctrl-C 停止
# 或者放到后台：
nohup session-bridge spawner run > ~/.claude/bridge/spawner.log 2>&1 &
```

配置会在每个事件发生时被重新读取，所以 `on`/`off` 以及其他改动都会**实时**
生效——无需重启。

### 安全护栏

| 护栏 | 默认值 | 它做什么 |
|------|---------|--------------|
| `maxHops`（循环防护） | 6 | 一个按项目计的链路计数器，给连续自动唤醒设上限，在出现安静间隙后重置。用来约束失控的乒乓往返（对两种驱动都有效）。 |
| `rateLimitPerMinute` | 12 | 每个角色每分钟的最大自动唤醒次数。 |
| 敏感角色 | `infra`、`qa` | 除非显式启用，否则永不自动唤醒——一条投错的消息无法触发部署。 |
| 不自动提交 | 开启 | `git commit`/`push`/`reset` 被拦截（见下文）。 |
| 单飞 / 冷却 | —— | 每个角色同一时间只有一次实时运行（spawn）；再次推送之间有冷却（tmux）。 |
| 必须有目标 | —— | 没有实时窗格（tmux）或没有 cwd（spawn）的角色永远不会被唤醒。 |

### 敏感角色默认关闭

`infra` 和 `qa` 出厂时就在 `defaultOffRoles` 里——即使配置过了，生成器也
**不会自动唤醒它们。** 你必须按名字明确地为它们选择启用。

**为什么？** 发送者决定一条消息发给*谁*，而发送者是一个语言模型。如果它什么
时候广播了（`to: "*"`）或者发错了地址，`infra`/`qa` 就可能收到一个本不该
发给它们的请求——而这些角色做的是风险最高的事情（部署、发布、破坏性测试）。
让它们保持关闭，是一个**不**依赖模型正确寻址的保证：一条投错的消息只会静静地
待在收件箱里，直到有人去打开那个会话。

**打开它们（如果你想要完全自动化）：**

```bash
session-bridge spawner on shop infra      # 显式选择启用（必需）
```

请先阅读[小心自动部署](#小心自动部署)。要修改这个列表，编辑
`<BRIDGE_ROOT>/spawner.config.json` 里的 `defaultOffRoles`。

### 永不自动提交（以及如何允许它）

默认情况下，自动驱动的会话无法提交。**两层防护**强制执行这一点：

1. **spawn 驱动：** 会话启动时带着
   `--disallowed-tools "Bash(git commit:*)" "Bash(git push:*)" ...`。
   拒绝规则优先于允许/绕过规则，所以模型在物理上就无法提交。
2. **tmux 驱动（实时会话）：** 那些标志不适用，所以请安装
   **`block-git` PreToolUse 钩子**（见[安装](#安装只需一次)）。它会在任何
   会话里拒绝 `git commit`/`push`/`reset`，无论那个回合是怎么被触发的。

> 在 `CLAUDE.md` 里写一句提醒（"不要提交"）是个不错的补充，但对自主循环来说
> **不够**——模型可能会跑偏。钩子/拒绝规则才是真正的保证。

**如果你*想要*提交/推送的自动化**（有些人确实想），那就选择退出：

- 不要安装 `block-git` 钩子，**并且**
- 对于 spawn 驱动，从 `denyTools`（`session-bridge spawner` 配置）里移除
  git 相关条目。
- 或者用 `BRIDGE_BLOCK_GIT`（一个正则；例如允许 commit 但仍然拦截 push）
  来缩小拦截范围。

> ⚠️ 自动 `push` 是对外的，而且难以撤销。如果你允许它，请推送到一个
> **feature 分支**并保护好 `main`（分支保护）。不要自动推送到 `main`。

### 小心自动部署

⚠️ 提交/推送被拦截了——但**部署不是 git。** `kubectl apply`、
`vercel deploy`、`terraform apply`、一个 SSH 部署脚本——这些默认都不会被
拦截，所以一个自主的 `infra` 会话可能会运行它们。部署是对外的，而且难以撤销；
在没有人在场的情况下做这件事是有风险的。

如果你想把 `infra` 放进闭环，从以下三种里挑一个：

1. **让 infra 保持手动**（默认——它是关闭的）。消息会排队等待；你打开会话
   亲自部署。
2. **拦截部署命令**（把它们加到 `denyTools` 或 block-git 正则里）。
3. **只自动化安全的步骤**——staging/dry-run 自动，生产环境手动。

---

## 在 Claude 内部修改设置

你不必去编辑 JSON，也不用记 CLI 标志。MCP 服务器让你能**在 Claude 会话内部**
读取并修改每一项自动化设置——可以当成一个仪表盘，用对话方式，或者通过 `/mcp`。

**安全：受管理员限制。** 设置只能从一个用 `BRIDGE_ADMIN=1` 启动的会话
（你的"控制"会话）里被*修改*。自动驱动的会话没有这个标志，所以一个失控的循环
无法翻动它自己的安全设置。读取配置则始终允许。

```bash
# 你的控制 / 仪表盘会话
BRIDGE_PROJECT=shop BRIDGE_ROLE=control BRIDGE_ADMIN=1 claude
```

**驱动它的两种方式：**

**A. 直接跟它对话**（由模型来调用工具）：

> "显示桥接器配置。" · "把 frontend 设为 auto。" · "maxHops 设为 3，driver
> 设为 tmux。" · "把自动化关掉。"

**B. `/mcp` 提示词**（当场应用改动的斜杠命令）：

```
/mcp__session-bridge__show-config       显示当前设置
/mcp__session-bridge__set-mode          项目、角色、auto|manual
/mcp__session-bridge__configure-role    cwd / model / tmuxTarget
/mcp__session-bridge__set-driver        tmux | spawn
/mcp__session-bridge__automation        on | off（总开关）
/mcp__session-bridge__set-limits        maxHops / rateLimitPerMinute
```

挑一个，填好参数，它就会立即写入改动（仅限管理员会话）。守护进程会实时接管。

---

## 参考

### 工具（可由会话调用）

| 工具 | 管理员？ | 用途 |
|------|--------|---------|
| `bridge_send(to, body)` | 否 | 发给某个角色，或用 `"*"` 广播 |
| `bridge_recv()` | 否 | 拉取并消费未读消息 |
| `bridge_peek()` | 否 | 预览未读消息但不消费 |
| `bridge_tail(limit?)` | 否 | 查看最近的消息 |
| `bridge_roles()` | 否 | 列出项目中的角色 |
| `bridge_whoami()` | 否 | 显示本会话的项目 + 角色 |
| `bridge_config()` | 否 | 显示自动化设置 |
| `bridge_mode(project, role, auto\|manual)` | **是** | 设置某个角色的模式 |
| `bridge_set(project, role, {...})` | **是** | 配置某个角色（cwd/model/tmuxTarget/permissionMode） |
| `bridge_settings({...})` | **是** | 全局开关（driver/maxHops/rate/…） |

### CLI

```bash
# 查看消息总线（用任意角色作为你的身份）
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge roles
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge send frontend "hello"
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge tail 20
session-bridge root            # 消息总线的存储目录

# 生成器
session-bridge spawner set <project> <role> cwd=<path> [model=<m>] [tmuxTarget=<t>]
session-bridge spawner on  [project] [role]
session-bridge spawner off [project] [role]
session-bridge spawner status
session-bridge spawner run [--replay]
```

### 环境变量

| 变量 | 必填 | 默认值 | 含义 |
|-----|----------|---------|---------|
| `BRIDGE_PROJECT` | 是 | —— | 项目（房间）名——隔离的边界 |
| `BRIDGE_ROLE` | 是 | —— | 本会话的角色（昵称） |
| `BRIDGE_ADMIN` | 否 | 关闭 | 设为 `1` 时允许本会话修改自动化设置 |
| `BRIDGE_ROOT` | 否 | `~/.claude/bridge` | 消息/配置的存放位置 |
| `BRIDGE_BLOCK_GIT` | 否 | `commit\|push\|reset` | block-git 钩子要拒绝的 git 操作的正则 |
| `BRIDGE_AUTOSEND` | 否 | 关闭 | 设为 `1` 时启用 Stop 自动发送钩子 |
| `BRIDGE_SEND_TO` | 否 | `*` | 自动发送的默认收件人 |
| `BRIDGE_HOP` | 否 | `0` | 循环防护的跳数（由 spawn 驱动设置） |

### 可选：每回合自动发送

默认关闭——更推荐刻意的 `bridge_send`。要在每个回合自动广播一个会话的最后
一条消息，设置 `BRIDGE_AUTOSEND=1` 并把 Stop 钩子加到 `settings.json`
（`dist/hooks/send.js`）。用 `BRIDGE_SEND_TO` 覆盖目标。这比刻意的发送更吵闹，
也更费 token。

### 它是如何工作的（给好奇的人）

消息和配置都是 `BRIDGE_ROOT` 下的普通文件：

```
~/.claude/bridge/
  spawner.config.json          自动化设置（实时编辑）
  <project>/
    <role>.inbox.jsonl         该角色消息的只追加日志
    .cursors/<role>.cursor     该角色已经读了多少条消息
    .sessions/<role>.pane      tmux 窗格 id，供 tmux 驱动找到它
```

`bridge_send` 会向收件人的收件箱追加内容。接收钩子从你的游标位置往后读取你的
收件箱，注入那些新行，并推进游标——所以你永远不会看到同一条消息两次。隔离不过
就是每个项目各自的文件夹而已。

### 测试

```bash
npm test             # MCP 总线端到端
npm run test:config  # 配置仪表盘 + 管理员限制
npm run test:prompts # /mcp 提示词应用改动（受管理员限制）
npm run test:spawner # spawn 驱动乒乓往返 + 循环防护
npm run test:tmux    # tmux 驱动乒乓往返 + 循环防护
npm run test:real    # 使用 `claude -p` 的真实双会话测试
```

### 许可证

MIT
