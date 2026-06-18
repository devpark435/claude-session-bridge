<div align="center">

[![English](https://img.shields.io/badge/English-555?style=for-the-badge)](README.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-555?style=for-the-badge)](README.ko.md)
[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-2ea44f?style=for-the-badge)](README.zh.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-555?style=for-the-badge)](README.ja.md)

</div>

# claude-session-bridge-mcp

**让两个（或多个）Claude Code 会话互相对话——并且还能选择让它们自我编排。**

你为**后端**打开一个 Claude Code 会话，又为**前端**打开另一个。通常它们彼此一无所知——当后端改了某个 API，你只能手动把结果复制粘贴到前端会话里。

这个工具去掉了复制粘贴这一步。一个会话**发送**它的结果，同伴会话便会**自动接收**到。打开可选的自动模式后，一个完成工作的后端可以**唤醒**前端去做出响应——无需动手的乒乓往返——与此同时，你仍然完全掌控各项安全护栏（不自动提交、部署关卡、循环保护），并且可以在 Claude 内部修改每一项设置。

> 第一次用？请从头读到尾——每条命令都包含在内。你不需要理解内部原理就能使用它。

---

## 目录

- [如何想象它](#如何想象它)
- [环境要求](#环境要求)
- [安装（一次性）](#安装一次性)
- [连接两个会话](#连接两个会话)
  - [设置变量的两种方式](#设置变量的两种方式)
  - [使用 tmux](#使用-tmux)
- [发送与接收消息](#发送与接收消息)
- [角色只是标签](#角色只是标签)
- [同时运行多个项目](#同时运行多个项目)
- [自动模式：事件 spawner](#自动模式事件-spawner)
  - [两种驱动：tmux 与 spawn](#两种驱动tmux-与-spawn)
  - [配置并运行](#配置并运行)
  - [安全护栏](#安全护栏)
  - [敏感角色默认关闭](#敏感角色默认关闭)
  - [绝不自动提交（以及如何允许它）](#绝不自动提交以及如何允许它)
  - [小心自动部署](#小心自动部署)
- [在 Claude 内部修改设置](#在-claude-内部修改设置)
- [参考](#参考)

---

## 如何想象它

两个简单的概念：

- **项目 = 一个聊天室。** 用相同项目名启动的会话处在同一个房间里，可以对话。不同的项目名 = 不同的房间，彼此隔离。
- **角色 = 你在那个房间里的昵称。** `backend`、`frontend`、`infra`——任何你喜欢的标签。你把消息发给某个角色。

```
会话 1   项目 "shop"  角色 "backend"  ┐
                                      ├─ 房间 "shop"（它们对话）
会话 2   项目 "shop"  角色 "frontend" ┘

会话 3   项目 "blog"  角色 "backend"  ─── 房间 "blog"（独立，隔离）
```

这里**没有"连接"按钮。** 用相同项目名启动两个会话*本身*就是把它们连接起来了。

---

## 环境要求

- **Node.js 18+**——用 `node --version` 检查
- **Claude Code**（即 `claude` 命令）——用 `claude --version` 检查
- **tmux**——推荐安装；默认的自动模式驱动通过它来驱动你正在运行的会话。（如果你只用消息总线，或者使用 `spawn` 驱动，则不需要它。）

---

## 安装（一次性）

这件事你只做**一次。** 之后你再也不用编辑这些文件——每个会话唯一会变的就是两个环境变量（下文会讲）。

**1. 获取代码并构建它。**

```bash
git clone <this-repo-url> claude-session-bridge-mcp
cd claude-session-bridge-mcp
npm install
npm run build
```

**2. 注册 bridge。** 请**在一个 Claude Code 会话内部**运行这些命令（这样它会针对该会话的配置目录生效——见下方说明）：

```bash
npm link                  # 可选：把 `session-bridge` 加入 PATH
session-bridge install    # 注册 MCP 服务器 + 各个 hook
session-bridge doctor     # 核对都装好了什么，以及装在哪里
```

`install` 会把 MCP 服务器、**接收（receive）** hook 以及 **block-git** hook（拦截 `git commit`/`push`/`reset`）合并进你当前生效的 settings.json——以幂等方式合并，不会动你的其他设置。如果你*希望*会话能自行提交，就加上 `--no-block-git`。（如果 `session-bridge` 不在你的 `PATH` 上，运行 `node /ABSOLUTE/PATH/dist/cli.js install`。）

> **工作账号 / 多个配置档（profile）。** 当 `CLAUDE_CONFIG_DIR` 这个环境变量被设置时（单独的工作登录账号常见这种情况），Claude Code 会读取 `$CLAUDE_CONFIG_DIR/settings.json`，否则读取 `~/.claude/settings.json`。这是"我改了设置却毫无变化"的头号原因——你改错了文件。**在某个配置档的会话内部**运行 `session-bridge install`，会自动针对正确的文件生效。每个配置档运行一次即可。用 `session-bridge doctor` 来核对，它会打印出当前生效的配置目录。

<details>
<summary>手动配置 settings.json（如果你更愿意手工编辑）</summary>

把以下内容加进正确的那个 settings.json（替换 `/ABSOLUTE/PATH`）：

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

所有 hook 在未接入 bridge 的会话里都会安全地空操作（no-op），所以全局安装它们也没问题。这就是全部的安装步骤。

---

## 连接两个会话

要把一个会话放进某个房间，**在启动它时**给它两个值：

| 变量 | 含义 | 示例 |
|----------|---------|---------|
| `BRIDGE_PROJECT` | 房间名 | `shop` |
| `BRIDGE_ROLE` | 该会话的昵称 | `backend` |

```bash
# 终端 1 —— 项目 "shop" 的后端
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend claude

# 终端 2 —— 项目 "shop" 的前端
BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude
```

两者都用了项目 `shop`，所以它们在同一个房间里，可以对话。

### 设置变量的两种方式

选一种用——**但别把它们搞混；这是新手第一大坑。**

**方式 A —— 写在同一行上（最简单，推荐）：**

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude
```

这些变量只对那一次 `claude` 生效。没有任何需要清理的东西。

**方式 B —— 先设置，再启动。** 分行写时你**必须**用 `export`：

```bash
export BRIDGE_PROJECT=shop
export BRIDGE_ROLE=frontend
claude
```

> ⚠️ **陷阱：** `BRIDGE_PROJECT=shop` 单独成行而**不加** `export`，设置的是一个 shell 变量，`claude` 将**看不到**它——bridge 会悄无声息地不连接。请使用 `export`（方式 B），或者把所有内容写在一行上（方式 A）。

**小技巧——做几个别名（alias）**，免得每次都重新敲一遍。在 `~/.zshrc`（或 `~/.bashrc`）里：

```bash
alias shop-back='BRIDGE_PROJECT=shop BRIDGE_ROLE=backend claude'
alias shop-front='BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude'
```

### 使用 tmux

tmux 对启动方式毫无影响——每个面板（pane）都是它自己的 shell，就像一个独立的终端。在每个面板里设置好变量并运行 `claude`：

```
tmux
 ├ 面板 1:  BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude
 ├ 面板 2:  BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude   ← 与面板 1 同一房间
 └ 面板 3:  BRIDGE_PROJECT=blog BRIDGE_ROLE=backend  claude   ← 不同房间
```

tmux 对**自动模式**最为重要：默认驱动会自动唤醒这些正在运行的面板（见[事件 spawner](#自动模式事件-spawner)）。在 tmux 内部启动的会话会自行登记它的面板——无需任何手动设置。

> 如果你在某个面板里用了 `export`（方式 B），随后又在**同一个**面板里启动*另一个*项目的 `claude`，旧的 `export` 会残留下来。在 tmux 内部建议优先用方式 A，以免出现意外。

---

## 发送与接收消息

一旦两个会话共享同一个房间，下面这套就会自然生效：

1. 在**后端**会话里，当你有值得分享的东西时：
   > "把新的 `/users` 响应结构发给前端会话。"

   它会调用 `bridge_send` 工具来投递这条消息。

2. 在**前端**会话里，下一次你输入任何内容时，那条消息会被**自动加入**它的上下文——无需复制粘贴。

这就是默认的（"总线 / bus"）模式：**发送是有意为之的**（模型分享的是一个真实结果，而不是一大段文字），而**接收在下一轮自动发生**。方向盘仍然握在你手里。

你也可以在任一会话里显式操作：*"检查一下 bridge 有没有新消息"*（`bridge_recv`）或者*"把这个发给 infra：staging 已就绪"*（`bridge_send`）。

> 如果一个会话完成了工作却没有值得分享的东西，它就干脆不发送——什么都不会上总线，任何乒乓往返都会自然结束。空闲的会话不会刷屏。

---

## 角色只是标签

角色就是**任意一个你想要的字符串**——不限于 `backend`/`frontend`。你想往一个房间里加多少会话都行：

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=web      claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=infra    claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=qa       claude
```

发送时，可以指定一个具体角色（`to: "infra"`），或者广播给其他所有人（`to: "*"`）。一条发给 `frontend` 的消息**只会**投递给 `frontend`——`infra`/`qa` 甚至根本看不到它，所以它们不会误打误撞地对它采取行动。（只有 `to: "*"` 才会送达每个人。）所以一个多步骤的流程很自然：

> backend 完成一个 API → 告诉 **web** → web 更新 UI → 告诉 **infra** → infra 重新部署。

这条链是否**自动**运行，取决于下文的 spawner——而对于部署，请先读[小心自动部署](#小心自动部署)。

---

## 同时运行多个项目

使用不同的项目名；它们永远看不到彼此的消息：

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude   # 房间 "shop"
BRIDGE_PROJECT=blog BRIDGE_ROLE=frontend claude   # 房间 "blog" —— 隔离
```

这种隔离是结构性的（消息存放在按项目划分的文件夹下），所以 `shop` 和 `blog` 不可能串到一起。

---

## 自动模式：事件 spawner

上面所有内容都把**你**留在回路里——一个会话只在你给它一个回合时才行动。**事件 spawner** 是一个可选的后台程序（一个守护进程 / daemon），它去掉了这一步：当一个角色收到消息时，spawner 会**自动唤醒那个角色**去处理它，于是双方可以在没有人类介入的情况下乒乓往返。你在它自己的终端里运行它；它是选择性启用（opt-in）的，关闭也很容易。

### 两种驱动：tmux 与 spawn

**驱动（driver）**决定一个角色是*怎么*被唤醒的：

| | **tmux**（默认） | **spawn** |
|---|---|---|
| 它做什么 | 向你**已经打开的、正在运行的会话**里输入内容（`tmux send-keys`） | 每个事件启动一个**全新的 `claude -p`** 进程 |
| 会话 | 同一个会话延续下去（保留上下文） | 每次都是新会话 |
| 可见吗？ | 是——你在面板里看着它跑 | 后台（只有日志） |
| 用 `claude -p` 吗？ | **不用** | 用 |
| 需要 tmux 吗？ | 需要 | 不需要 |

打个比方：**tmux** 是去拍一拍已经坐在工位上的员工；**spawn** 是为每个任务雇一个新的临时工。

为什么 tmux 是默认：它编排的是你已经在其中工作的*打开着的*会话，保留它们的上下文，让你能看着并打断它，并且**不使用 `claude -p`**（所以它不受 headless/SDK 计费方式变动的影响）。当你无法运行 tmux，或者想要隔离的一次性运行时，就使用 `spawn`。

### 配置并运行

一个角色只有在被设置好之后才会被自动唤醒——开箱即用时 spawner 什么都不做，所以你需要一个角色一个角色地选择性启用：

```bash
# tmux 驱动：只要在 tmux 内部打开该角色的会话即可——它的面板会自动登记。
# spawn 驱动：告诉它该角色的代码在哪里：
session-bridge spawner set shop backend cwd=/path/to/backend

session-bridge spawner on              # 全局启用
session-bridge spawner off shop        # ……或者按项目
session-bridge spawner off shop web    # ……或者只针对一个角色
session-bridge spawner status          # 查看当前配置
```

（`session-bridge` 是随本包安装的 CLI。如果它不在你的 `PATH` 上，运行 `node /ABSOLUTE/PATH/dist/cli.js spawner ...`。）

在它自己的终端里运行守护进程：

```bash
session-bridge spawner run             # 前台运行；按 Ctrl-C 停止
# 或者把它放到后台：
nohup session-bridge spawner run > ~/.claude/bridge/spawner.log 2>&1 &
```

配置在每个事件发生时都会被重新读取，所以 `on`/`off` 及其他改动会**实时**生效——无需重启。

### 安全护栏

| 护栏 | 默认 | 它做什么 |
|------|---------|--------------|
| `maxHops`（循环保护） | 6 | 一个按项目计数的链路计数器，给连续自动唤醒的次数封顶，并在出现一段安静的间隙后重置。约束失控的乒乓往返（对两种驱动都有效）。 |
| `rateLimitPerMinute` | 12 | 每个角色每分钟最多的自动唤醒次数。 |
| 敏感角色 | `infra`、`qa` | 除非被显式启用，否则绝不会被自动唤醒——一条投递错误的消息无法触发部署。 |
| 不自动提交 | 开启 | `git commit`/`push`/`reset` 被拦截（见下文）。 |
| 单飞 / 冷却（single-flight / cooldown） | — | 每个角色同时只允许一次实时运行（spawn）；再次推动有一个冷却时间（tmux）。 |
| 必须有目标 | — | 没有实时面板（tmux）或没有 cwd（spawn）的角色永远不会被唤醒。 |

### 敏感角色默认关闭

`infra` 和 `qa` 出厂时就在 `defaultOffRoles` 里——即使被配置了，spawner 也**不会自动唤醒它们。** 你必须按名字把它们显式启用。

**为什么？** 发送方决定一条消息*发给谁*，而发送方是一个语言模型。如果它有朝一日广播了（`to: "*"`）或者寻址错误，`infra`/`qa` 就可能收到一个本不该给它们的请求——而这些角色干的是风险最高的事（部署、发布、破坏性测试）。让它们保持关闭是一种**不**依赖模型寻址正确的保证：一条投递错误的消息只会静静地待在收件箱里，直到有人类打开那个会话。

**把它们打开（如果你想要完全自动化）：**

```bash
session-bridge spawner on shop infra      # 显式选择启用（必需）
```

请先读[小心自动部署](#小心自动部署)。要修改这份名单，编辑 `<BRIDGE_ROOT>/spawner.config.json` 里的 `defaultOffRoles`。

### 绝不自动提交（以及如何允许它）

默认情况下，自动驱动的会话不能提交。**两层**机制来保证这一点：

1. **spawn 驱动：** 会话启动时带着 `--disallowed-tools "Bash(git commit:*)" "Bash(git push:*)" ...`。拒绝（deny）规则优先于允许 / 绕过（allow/bypass），所以模型在物理上无法提交。
2. **tmux 驱动（实时会话）：** 那些标志不适用，所以请安装 **`block-git` PreToolUse hook**（在[安装](#安装一次性)里）。无论一个会话的回合是怎么被触发的，它都会拒绝其中的 `git commit`/`push`/`reset`。

> 一条 `CLAUDE.md` 里的提醒（"不要提交"）算个加分项，但对自主循环来说**远远不够**——模型会跑偏。hook / 拒绝规则才是真正的保证。

**如果你确实*想要*提交 / 推送自动化**（有些人确实想），就退出这层保护：

- 不要安装 `block-git` hook，**并且**
- 对于 spawn 驱动，从 `denyTools`（`session-bridge spawner` 配置）里移除 git 相关条目。
- 或者用 `BRIDGE_BLOCK_GIT`（一个正则；例如允许 commit 但仍然拦截 push）来收窄被拦截的范围。

> ⚠️ 自动 `push` 是对外的，而且很难撤销。如果你允许它，请推送到一个**功能分支（feature branch）**，并保护好 `main`（分支保护）。不要自动推送到 `main`。

### 小心自动部署

⚠️ commit/push 被拦截了——但**部署不是 git。** `kubectl apply`、`vercel deploy`、`terraform apply`、一个 SSH 部署脚本——这些默认都不会被拦截，所以一个自主的 `infra` 会话可能会运行它们。部署是对外的，而且很难撤销；在没有人类在场的情况下做这件事是有风险的。

如果你想让 `infra` 进入回路，从中挑一种：

1. **让 infra 保持手动**（默认——它是关闭的）。消息排着队；你打开会话，自己去部署。
2. **拦截部署命令**（把它们加进 `denyTools` 或 block-git 的正则）。
3. **只自动化安全的步骤**——staging/dry-run 自动化，生产环境手动。

---

## 在 Claude 内部修改设置

你不必去编辑 JSON，也不必记住 CLI 标志。MCP 服务器让你能**在 Claude 会话内部**读取和修改每一项自动化设置——既可以是一个仪表盘式的对话，也可以通过 `/mcp`。

**安全：受 admin 门控。** 设置只能从一个用 `BRIDGE_ADMIN=1` 启动的会话（你的 "control" 会话）里被*修改*。自动驱动的会话没有这个标志，所以一个失控的循环无法翻动它自己的安全设置。读取配置则始终允许。

```bash
# 你的 control / 仪表盘会话
BRIDGE_PROJECT=shop BRIDGE_ROLE=control BRIDGE_ADMIN=1 claude
```

**两种驱动它的方式：**

**A. 直接跟它说话**（由模型来调用这些工具）：

> "显示 bridge 配置。" · "把 frontend 设为 auto。" · "maxHops 设为 3，driver 设为 tmux。" · "把自动化关掉。"

**B. `/mcp` 提示词**（当场应用改动的 slash 命令）：

```
/mcp__session-bridge__show-config       显示当前设置
/mcp__session-bridge__set-mode          project、role、auto|manual
/mcp__session-bridge__configure-role    cwd / model / tmuxTarget
/mcp__session-bridge__set-driver        tmux | spawn
/mcp__session-bridge__automation        on | off（总开关）
/mcp__session-bridge__set-limits        maxHops / rateLimitPerMinute
```

挑一个，填好参数，它就会立刻把改动写入（仅限 admin 会话）。守护进程会实时拾取它。

---

## 参考

### 工具（可由会话调用）

| 工具 | Admin？ | 用途 |
|------|--------|---------|
| `bridge_send(to, body)` | 否 | 发给某个角色，或用 `"*"` 广播 |
| `bridge_recv()` | 否 | 拉取并消费未读消息 |
| `bridge_peek()` | 否 | 预览未读消息但不消费 |
| `bridge_tail(limit?)` | 否 | 查看最近的消息 |
| `bridge_roles()` | 否 | 列出项目里的各个角色 |
| `bridge_whoami()` | 否 | 显示该会话的项目 + 角色 |
| `bridge_config()` | 否 | 显示自动化设置 |
| `bridge_mode(project, role, auto\|manual)` | **是** | 设置一个角色的模式 |
| `bridge_set(project, role, {...})` | **是** | 配置一个角色（cwd/model/tmuxTarget/permissionMode） |
| `bridge_settings({...})` | **是** | 全局开关（driver/maxHops/rate/…） |

### CLI

```bash
# 安装设置（针对当前生效的配置目录：$CLAUDE_CONFIG_DIR 或 ~/.claude）
session-bridge install [--no-block-git] [--config-dir <dir>]
session-bridge doctor

# 查看消息总线（用任意角色作为你的身份）
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge roles
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge send frontend "hello"
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge tail 20
session-bridge root            # 消息总线的存储目录

# spawner
session-bridge spawner set <project> <role> cwd=<path> [model=<m>] [tmuxTarget=<t>]
session-bridge spawner on  [project] [role]
session-bridge spawner off [project] [role]
session-bridge spawner status
session-bridge spawner run [--replay]
```

### 环境变量

| 变量 | 必需 | 默认 | 含义 |
|-----|----------|---------|---------|
| `BRIDGE_PROJECT` | 是 | — | 项目（房间）名——隔离的边界 |
| `BRIDGE_ROLE` | 是 | — | 该会话的角色（昵称） |
| `BRIDGE_ADMIN` | 否 | 关闭 | `1` 让该会话可以修改自动化设置 |
| `BRIDGE_ROOT` | 否 | `~/.claude/bridge` | 消息 / 配置的存储位置 |
| `BRIDGE_BLOCK_GIT` | 否 | `commit\|push\|reset` | block-git hook 要拒绝的 git 操作的正则 |
| `BRIDGE_AUTOSEND` | 否 | 关闭 | `1` 启用 Stop 自动发送 hook |
| `BRIDGE_SEND_TO` | 否 | `*` | 自动发送的默认收件人 |
| `BRIDGE_HOP` | 否 | `0` | 循环保护的跳数（由 spawn 驱动设置） |

### 可选：每一轮自动发送

默认关闭——更推荐有意为之的 `bridge_send`。要让一个会话的最后一条消息在每一轮自动广播出去，设置 `BRIDGE_AUTOSEND=1` 并把 Stop hook 加进 `settings.json`（`dist/hooks/send.js`）。用 `BRIDGE_SEND_TO` 覆盖目标。比有意发送更吵、更费 token。

### 工作原理（给好奇的人）

消息和配置都是 `BRIDGE_ROOT` 下面的普通文件：

```
~/.claude/bridge/
  spawner.config.json          自动化设置（实时编辑）
  <project>/
    <role>.inbox.jsonl         该角色消息的只追加（append-only）日志
    .cursors/<role>.cursor     该角色已经读了多少条消息
    .sessions/<role>.pane      tmux 面板 id，供 tmux 驱动找到它
```

`bridge_send` 把消息追加到收件人的收件箱里。接收 hook 从你的游标（cursor）位置往后读你的收件箱，把新的几行注入进来，并推进游标——所以你永远不会看到同一条消息两次。隔离不过就是那个按项目划分的文件夹。

### 测试

```bash
npm test             # MCP 总线端到端测试
npm run test:config  # 配置仪表盘 + admin 门控
npm run test:prompts # /mcp 提示词应用改动（受 admin 门控）
npm run test:spawner # spawn 驱动的乒乓往返 + 循环保护
npm run test:tmux    # tmux 驱动的乒乓往返 + 循环保护
npm run test:real    # 使用 `claude -p` 的真实双会话测试
```

### 许可证

MIT
