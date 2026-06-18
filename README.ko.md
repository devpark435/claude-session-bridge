<div align="center">

[![English](https://img.shields.io/badge/English-555?style=for-the-badge)](README.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-2ea44f?style=for-the-badge)](README.ko.md)
[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-555?style=for-the-badge)](README.zh.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-555?style=for-the-badge)](README.ja.md)

</div>

# claude-session-bridge-mcp

**두 개(또는 그 이상)의 Claude Code 세션이 서로 대화하게 해 주고 — 원한다면
스스로 협업하도록 만들어 주는 도구입니다.**

당신은 **백엔드**용으로 Claude Code 세션 하나를, **프런트엔드**용으로 또 다른
세션 하나를 엽니다. 보통 이 두 세션은 서로의 존재를 전혀 모릅니다 — 백엔드가
API를 바꾸면, 그 결과를 직접 복사해서 프런트엔드 세션에 붙여넣어야 하죠.

이 도구는 그 복사-붙여넣기를 없애 줍니다. 한 세션이 결과를 **보내면**, 같은 방에
있는 다른 세션들이 그것을 **자동으로 받습니다**. 선택형 자동 모드를 켜면, 작업을
끝낸 백엔드가 프런트엔드를 **깨워서** 반응하게 만들 수도 있습니다 — 사람 손이
필요 없는 핑퐁이죠 — 그러면서도 안전장치(자동 커밋 금지, 배포 차단, 루프 가드)는
당신이 완전히 통제하고, 모든 설정을 Claude 안에서 바꿀 수 있습니다.

> 처음이신가요? 위에서 아래로 끝까지 읽어 보세요 — 모든 명령어가 다 들어 있습니다.
> 내부 구조를 이해하지 않아도 사용할 수 있습니다.

---

## 목차

- [그림으로 이해하기](#그림으로-이해하기)
- [필요한 것들](#필요한-것들)
- [설치 (한 번만)](#설치-한-번만)
- [두 세션 연결하기](#두-세션-연결하기)
  - [변수를 설정하는 두 가지 방법](#변수를-설정하는-두-가지-방법)
  - [tmux 사용하기](#tmux-사용하기)
- [메시지 보내고 받기](#메시지-보내고-받기)
- [역할은 그냥 이름표일 뿐입니다](#역할은-그냥-이름표일-뿐입니다)
- [여러 프로젝트를 동시에 돌리기](#여러-프로젝트를-동시에-돌리기)
- [자동 모드: 이벤트 스포너](#자동-모드-이벤트-스포너)
  - [두 가지 드라이버: tmux vs spawn](#두-가지-드라이버-tmux-vs-spawn)
  - [설정하고 실행하기](#설정하고-실행하기)
  - [안전장치](#안전장치)
  - [민감한 역할은 기본적으로 꺼져 있습니다](#민감한-역할은-기본적으로-꺼져-있습니다)
  - [절대 자동 커밋하지 않기 (그리고 허용하는 방법)](#절대-자동-커밋하지-않기-그리고-허용하는-방법)
  - [자동 배포는 조심하세요](#자동-배포는-조심하세요)
- [Claude 안에서 설정 바꾸기](#claude-안에서-설정-바꾸기)
- [레퍼런스](#레퍼런스)

---

## 그림으로 이해하기

아주 단순한 두 가지 개념입니다:

- **프로젝트 = 채팅방.** 같은 프로젝트 이름으로 실행한 세션들은 같은 방에 있으며
  서로 대화할 수 있습니다. 프로젝트 이름이 다르면 = 다른 방이고, 서로 격리됩니다.
- **역할 = 그 방에서 쓰는 당신의 닉네임.** `backend`, `frontend`, `infra` — 원하는
  어떤 이름표든 됩니다. 메시지를 보낼 때 역할을 지정해서 보냅니다.

```
세션 1   프로젝트 "shop"  역할 "backend"  ┐
                                          ├─ 방 "shop" (서로 대화함)
세션 2   프로젝트 "shop"  역할 "frontend" ┘

세션 3   프로젝트 "blog"  역할 "backend"  ─── 방 "blog" (별개이고, 격리됨)
```

**"연결" 버튼 같은 건 없습니다.** 같은 프로젝트 이름으로 두 세션을 실행하는 것
*자체가* 연결입니다.

---

## 필요한 것들

- **Node.js 18+** — `node --version`으로 확인하세요
- **Claude Code** (`claude` 명령어) — `claude --version`으로 확인하세요
- **tmux** — 권장합니다. 기본 자동 모드 드라이버가 이것을 통해 당신의 실제 세션을
  움직입니다. (메시지 버스만 쓰거나 `spawn` 드라이버만 쓴다면 필요 없습니다.)

---

## 설치 (한 번만)

이 작업은 **딱 한 번만** 합니다. 이후로는 이 파일들을 다시 건드릴 일이 없습니다 —
세션마다 바뀌는 것은 환경 변수 두 개뿐입니다(바로 다음에 설명합니다).

**1. 코드를 받아서 빌드합니다.**

```bash
git clone <this-repo-url> claude-session-bridge-mcp
cd claude-session-bridge-mcp
npm install
npm run build
```

**2. 이 폴더의 절대 경로를 찾습니다** — 설정에 붙여넣을 것입니다:

```bash
pwd
# 예시: /Users/you/projects/claude-session-bridge-mcp
```

**3. Claude Code에 브리지를 등록합니다.** `~/.claude/settings.json`을 열고(없으면
새로 만듭니다) 아래 블록들을 추가하세요. `/ABSOLUTE/PATH`를 `pwd`가 출력한 경로로
바꾸세요.

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

- `mcpServers`는 세션이 메시지를 **보내고**(그리고 관리자 세션에서는 설정을
  바꾸는 데) 사용하는 도구들을 추가합니다.
- `UserPromptSubmit` 훅은 세션이 메시지를 **자동으로 받게** 만듭니다.
- `PreToolUse` 훅은 모든 세션에서 **`git commit`/`push`/`reset`을 차단**합니다
  (권장 — [절대 자동 커밋하지 않기](#절대-자동-커밋하지-않기-그리고-허용하는-방법) 참고).
  세션이 스스로 커밋하기를 *원한다면* 이 훅은 빼세요.

> `settings.json`에 이미 이 키들이 있다면, 거기에 병합하세요. 세 가지 훅 모두
> 브리지에 연결되지 않은 세션에서는 안전하게 아무 일도 하지 않으므로, 전역으로
> 설치해도 괜찮습니다.

이게 설정의 전부입니다.

---

## 두 세션 연결하기

세션을 방에 넣으려면, **실행할 때** 두 가지 값을 주면 됩니다:

| 변수 | 의미 | 예시 |
|----------|---------|---------|
| `BRIDGE_PROJECT` | 방 이름 | `shop` |
| `BRIDGE_ROLE` | 이 세션의 닉네임 | `backend` |

```bash
# 터미널 1 — 프로젝트 "shop"의 백엔드
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend claude

# 터미널 2 — 프로젝트 "shop"의 프런트엔드
BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude
```

둘 다 프로젝트 `shop`을 썼으므로, 같은 방에 있고 서로 대화할 수 있습니다.

### 변수를 설정하는 두 가지 방법

하나만 고르세요 — **다만 헷갈리지 마세요. 이게 초보자가 가장 많이 하는 실수입니다.**

**방법 A — 같은 줄에 쓰기 (가장 간단하고, 권장):**

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude
```

이 변수들은 그 한 번의 `claude`에만 적용됩니다. 따로 정리할 것이 없습니다.

**방법 B — 먼저 설정하고, 그다음 실행하기.** 줄을 나눌 때는 **반드시** `export`를
써야 합니다:

```bash
export BRIDGE_PROJECT=shop
export BRIDGE_ROLE=frontend
claude
```

> ⚠️ **함정:** `BRIDGE_PROJECT=shop`을 별도의 줄에 `export` **없이** 쓰면, `claude`가
> **보지 못하는** 셸 변수가 설정됩니다 — 브리지가 아무 말 없이 연결되지 않습니다.
> `export`를 쓰거나(방법 B), 모든 것을 한 줄에 쓰세요(방법 A).

**팁 — 별칭(alias)을 만들어** 매번 다시 입력하지 않도록 하세요. `~/.zshrc`(또는
`~/.bashrc`)에:

```bash
alias shop-back='BRIDGE_PROJECT=shop BRIDGE_ROLE=backend claude'
alias shop-front='BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude'
```

### tmux 사용하기

tmux는 실행 방식 자체를 전혀 바꾸지 않습니다 — 각 창(pane)은 별도의 터미널처럼
자기만의 셸을 가집니다. 각 창에서 변수를 설정하고 `claude`를 실행하세요:

```
tmux
 ├ 창 1:  BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude
 ├ 창 2:  BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude   ← 창 1과 같은 방
 └ 창 3:  BRIDGE_PROJECT=blog BRIDGE_ROLE=backend  claude   ← 다른 방
```

tmux는 **자동 모드**에서 가장 중요합니다: 기본 드라이버가 이 살아 있는 창들을
자동으로 깨웁니다([스포너](#자동-모드-이벤트-스포너) 참고). tmux 안에서 실행된
세션은 자신의 창을 스스로 등록합니다 — 따로 설정할 것이 없습니다.

> 한 창에서 `export`(방법 B)를 쓴 다음, 나중에 그 **같은** 창에서 *다른* 프로젝트의
> `claude`를 실행하면, 예전 `export`가 그대로 남아 있습니다. tmux 안에서는 뜻밖의
> 상황을 피하려면 방법 A를 권장합니다.

---

## 메시지 보내고 받기

두 세션이 같은 방을 공유하면, 별다른 설정 없이 그냥 동작합니다:

1. **백엔드** 세션에서, 공유할 만한 것이 생겼을 때:
   > "새 `/users` 응답 형태를 프런트엔드 세션에 보내 줘."

   그러면 `bridge_send` 도구를 호출해서 메시지를 전달합니다.

2. **프런트엔드** 세션에서는, 다음번에 무언가를 입력하는 순간 그 메시지가 컨텍스트에
   **자동으로 추가됩니다** — 복사-붙여넣기 없이요.

이것이 기본 모드("버스" 모드)입니다: **보내기는 의도적**이고(모델이 장황한 글이
아니라 진짜 결과를 공유합니다), **받기는 다음 차례에 자동**입니다. 운전대는 여전히
당신이 쥐고 있습니다.

어느 세션에서든 직접 지시할 수도 있습니다: *"브리지에 새 메시지가 있는지 확인해
줘"*(`bridge_recv`) 또는 *"infra에 이걸 보내 줘: 스테이징 준비됐어"*(`bridge_send`).

> 세션이 작업을 마쳤는데 공유할 만한 게 없으면, 그냥 보내지 않습니다 — 버스에 아무것도
> 올라가지 않고, 진행 중이던 핑퐁도 자연스럽게 끝납니다. 할 일 없는 세션이 방을
> 어지럽히지 않습니다.

---

## 역할은 그냥 이름표일 뿐입니다

역할은 `backend`/`frontend`뿐 아니라 **원하는 어떤 문자열이든** 됩니다. 방에 원하는
만큼 세션을 추가하세요:

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=web      claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=infra    claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=qa       claude
```

보낼 때는 특정 역할을 지정하거나(`to: "infra"`) 나머지 모두에게 방송할 수 있습니다
(`to: "*"`). `frontend`에게 보낸 메시지는 **오직** `frontend`에게만 전달됩니다 —
`infra`/`qa`는 그 메시지를 아예 보지도 못하므로, 실수로 그것에 반응할 일이 없습니다.
(`to: "*"`만이 모두에게 도달합니다.) 그래서 여러 단계로 이어지는 흐름이 자연스럽습니다:

> backend가 API를 끝냄 → **web**에게 알림 → web이 UI를 업데이트 → **infra**에게 알림
> → infra가 재배포.

이 사슬이 **자동으로** 굴러갈지는 아래의 스포너에 달려 있습니다 — 그리고 배포의
경우, 먼저 [자동 배포는 조심하세요](#자동-배포는-조심하세요)를 읽으세요.

---

## 여러 프로젝트를 동시에 돌리기

프로젝트 이름을 다르게 쓰세요. 서로의 메시지를 결코 보지 못합니다:

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude   # 방 "shop"
BRIDGE_PROJECT=blog BRIDGE_ROLE=frontend claude   # 방 "blog" — 격리됨
```

격리는 구조적입니다(메시지가 프로젝트별 폴더 안에 저장됩니다). 그래서 `shop`과
`blog`는 서로 넘나들 수 없습니다.

---

## 자동 모드: 이벤트 스포너

위에서 설명한 모든 것은 **당신**을 흐름 안에 두고 있습니다 — 세션은 당신이 차례를
줄 때만 움직입니다. **이벤트 스포너**는 그 단계를 없애 주는 선택형 백그라운드
프로그램(데몬)입니다: 어떤 역할이 메시지를 받으면, 스포너가 **그 역할을 자동으로
깨워서** 처리하게 합니다. 그래서 양쪽이 사람 없이도 핑퐁을 주고받을 수 있습니다.
이것은 별도의 터미널에서 실행하며, 켜고 끄기가 선택형이고 끄기도 쉽습니다.

### 두 가지 드라이버: tmux vs spawn

**드라이버**는 역할을 *어떻게* 깨울지를 결정합니다:

| | **tmux** (기본값) | **spawn** |
|---|---|---|
| 하는 일 | **이미 열려 있는 실제 세션**에 입력합니다 (`tmux send-keys`) | 이벤트마다 **새로운 `claude -p`** 프로세스를 실행합니다 |
| 세션 | 같은 세션이 이어집니다 (컨텍스트 유지) | 매번 새 세션 |
| 보이나요? | 예 — 창에서 직접 지켜봅니다 | 백그라운드 (로그만) |
| `claude -p`를 쓰나요? | **아니요** | 예 |
| tmux가 필요한가요? | 예 | 아니요 |

비유하자면: **tmux**는 이미 자기 자리에 앉아 있는 직원을 톡톡 두드리는 것이고,
**spawn**은 작업마다 새 임시직을 고용하는 것입니다.

tmux가 기본값인 이유: 당신이 이미 작업 중인 *열려 있는* 세션들을 지휘하고, 그
컨텍스트를 유지하며, 당신이 지켜보고 끼어들 수 있게 해 주고, **`claude -p`를 쓰지
않기 때문에**(헤드리스/SDK 과금 변경에 영향받지 않습니다) 그렇습니다. tmux를 돌릴
수 없거나 격리된 일회성 실행을 원한다면 `spawn`을 쓰세요.

### 설정하고 실행하기

역할은 설정해 준 다음에야 자동으로 깨워집니다 — 막 설치한 상태에서 스포너는 아무
일도 하지 않으므로, 역할별로 하나씩 켜 나가면 됩니다:

```bash
# tmux 드라이버: 그냥 tmux 안에서 그 역할의 세션을 열기만 하면 — 창이 자동 등록됩니다.
# spawn 드라이버: 그 역할의 코드가 어디 있는지 알려 주세요:
session-bridge spawner set shop backend cwd=/path/to/backend

session-bridge spawner on              # 전역으로 켜기
session-bridge spawner off shop        # ...또는 프로젝트 단위로
session-bridge spawner off shop web    # ...또는 역할 하나만
session-bridge spawner status          # 현재 설정 확인
```

(`session-bridge`는 이 패키지와 함께 설치되는 CLI입니다. `PATH`에 없으면
`node /ABSOLUTE/PATH/dist/cli.js spawner ...`로 실행하세요.)

데몬을 별도의 터미널에서 실행하세요:

```bash
session-bridge spawner run             # 포그라운드; Ctrl-C로 중지
# 또는 백그라운드로 돌리기:
nohup session-bridge spawner run > ~/.claude/bridge/spawner.log 2>&1 &
```

설정은 이벤트가 발생할 때마다 다시 읽히므로, `on`/`off`를 비롯한 변경 사항이 **실시간**으로
적용됩니다 — 재시작할 필요가 없습니다.

### 안전장치

| 장치 | 기본값 | 하는 일 |
|------|---------|--------------|
| `maxHops` (루프 가드) | 6 | 프로젝트별 사슬 카운터가 연속 자동 깨움 횟수를 제한하며, 조용한 간격 후에 초기화됩니다. 폭주하는 핑퐁을 억제합니다(두 드라이버 모두에 적용). |
| `rateLimitPerMinute` | 12 | 분당 역할별 최대 자동 깨움 횟수. |
| 민감한 역할 | `infra`, `qa` | 명시적으로 켜지 않는 한 절대 자동으로 깨워지지 않습니다 — 잘못 전달된 메시지가 배포를 일으킬 수 없습니다. |
| 자동 커밋 금지 | 켜짐 | `git commit`/`push`/`reset` 차단 (아래 참고). |
| 단일 실행 / 쿨다운 | — | 한 역할당 동시에 하나의 실행만(spawn); 재-자극 쿨다운(tmux). |
| 대상 필수 | — | 살아 있는 창이 없는 역할(tmux)이나 cwd가 없는 역할(spawn)은 결코 깨워지지 않습니다. |

### 민감한 역할은 기본적으로 꺼져 있습니다

`infra`와 `qa`는 `defaultOffRoles`에 들어 있는 상태로 출고됩니다 — 스포너는 **설정을
해 주더라도 이들을 자동으로 깨우지 않습니다.** 이름을 직접 지정해서 켜야 합니다.

**왜 그럴까요?** 메시지를 *누구에게* 보낼지는 보내는 쪽이 정하는데, 그 보내는 쪽은
언어 모델입니다. 만약 그것이 방송(`to: "*"`)을 하거나 주소를 잘못 지정하면,
`infra`/`qa`가 자기에게 보낸 게 아닌 요청을 받을 수도 있습니다 — 그리고 이 역할들은
가장 위험한 일(배포, 릴리스, 파괴적인 테스트)을 합니다. 이들을 꺼 두는 것은 모델이
주소를 올바르게 지정하는 것에 **의존하지 않는** 보장책입니다: 잘못 전달된 메시지는
사람이 그 세션을 열 때까지 그냥 받은 편지함에 가만히 있습니다.

**이들을 켜기 (완전 자동화를 원한다면):**

```bash
session-bridge spawner on shop infra      # 명시적으로 켜기 (필수)
```

먼저 [자동 배포는 조심하세요](#자동-배포는-조심하세요)를 읽으세요. 목록을 바꾸려면
`<BRIDGE_ROOT>/spawner.config.json`의 `defaultOffRoles`를 편집하세요.

### 절대 자동 커밋하지 않기 (그리고 허용하는 방법)

기본적으로, 자동으로 움직이는 세션은 커밋할 수 없습니다. **두 개의 층**이 이를
강제합니다:

1. **spawn 드라이버:** 세션이
   `--disallowed-tools "Bash(git commit:*)" "Bash(git push:*)" ...`와 함께
   실행됩니다. 거부(deny) 규칙이 허용/우회(allow/bypass)를 이기므로, 모델은 물리적으로
   커밋할 수 없습니다.
2. **tmux 드라이버 (실제 세션):** 위 플래그가 적용되지 않으므로, **`block-git`
   PreToolUse 훅**을 설치하세요([설치](#설치-한-번만) 참고). 이 훅은 차례가 어떻게
   촉발됐든 상관없이 모든 세션에서 `git commit`/`push`/`reset`을 거부합니다.

> `CLAUDE.md`에 적어 둔 알림("커밋하지 마")은 있으면 좋지만 자율 루프에는 **충분하지
> 않습니다** — 모델은 흐트러질 수 있습니다. 훅/거부 규칙이 진짜 보장책입니다.

**커밋/푸시 자동화를 원한다면**(원하는 사람도 있습니다), 다음처럼 빠져나오세요:

- `block-git` 훅을 설치하지 말고, **그리고**
- spawn 드라이버의 경우 `denyTools`(`session-bridge spawner` 설정)에서 git 항목을
  제거하세요.
- 또는 `BRIDGE_BLOCK_GIT`(정규식; 예를 들어 commit은 허용하되 push는 여전히 차단)으로
  차단 범위를 좁히세요.

> ⚠️ 자동 `push`는 바깥을 향하고 되돌리기 어렵습니다. 허용한다면 **피처 브랜치**로
> 푸시하고 `main`을 보호하세요(브랜치 보호). `main`에 자동 푸시하지 마세요.

### 자동 배포는 조심하세요

⚠️ 커밋/푸시는 차단되지만 — **배포는 git이 아닙니다.** `kubectl apply`,
`vercel deploy`, `terraform apply`, SSH 배포 스크립트 — 그 어느 것도 기본적으로
차단되지 않으므로, 자율적으로 움직이는 `infra` 세션이 이들을 실행할 수 있습니다.
배포는 바깥을 향하고 되돌리기 어려우며, 사람이 없는 채로 하는 것은 위험합니다.

`infra`를 흐름에 넣고 싶다면, 하나를 고르세요:

1. **infra를 수동으로 유지**(기본값 — 꺼져 있습니다). 메시지는 대기열에 쌓이고, 당신이
   세션을 열어 직접 배포합니다.
2. **배포 명령어를 차단**(`denyTools`나 block-git 정규식에 추가).
3. **안전한 단계만 자동화** — 스테이징/드라이런은 자동, 프로덕션은 수동.

---

## Claude 안에서 설정 바꾸기

JSON을 편집하거나 CLI 플래그를 외울 필요가 없습니다. MCP 서버를 통해 모든 자동화
설정을 **Claude 세션 안에서** 읽고 바꿀 수 있습니다 — 대시보드처럼, 대화로, 혹은
`/mcp`로요.

**안전: 관리자 전용 게이트.** 설정을 *바꾸는* 것은 `BRIDGE_ADMIN=1`로 실행된
세션(당신의 "control" 세션)에서만 가능합니다. 자동으로 움직이는 세션에는 이것이
없으므로, 폭주하는 루프가 자기 안전 설정을 스스로 뒤집을 수 없습니다. 설정을 읽는
것은 언제나 허용됩니다.

```bash
# 당신의 control / 대시보드 세션
BRIDGE_PROJECT=shop BRIDGE_ROLE=control BRIDGE_ADMIN=1 claude
```

**이것을 다루는 두 가지 방법:**

**A. 그냥 말로 하기** (모델이 도구를 호출합니다):

> "브리지 설정 보여 줘." · "frontend를 auto로 설정해 줘." · "maxHops 3, driver
> tmux." · "자동화 꺼 줘."

**B. `/mcp` 프롬프트** (그 자리에서 변경을 적용하는 슬래시 명령어):

```
/mcp__session-bridge__show-config       현재 설정 보기
/mcp__session-bridge__set-mode          project, role, auto|manual
/mcp__session-bridge__configure-role    cwd / model / tmuxTarget
/mcp__session-bridge__set-driver        tmux | spawn
/mcp__session-bridge__automation        on | off  (마스터 스위치)
/mcp__session-bridge__set-limits        maxHops / rateLimitPerMinute
```

하나를 고르고, 인자를 채우면, 즉시 변경 사항을 기록합니다(관리자 세션 한정).
데몬이 이것을 실시간으로 받아들입니다.

---

## 레퍼런스

### 도구 (세션이 호출할 수 있음)

| 도구 | 관리자? | 용도 |
|------|--------|---------|
| `bridge_send(to, body)` | 아니오 | 한 역할에게 보내기, 또는 `"*"`로 방송 |
| `bridge_recv()` | 아니오 | 읽지 않은 메시지 가져오고 소비하기 |
| `bridge_peek()` | 아니오 | 소비하지 않고 읽지 않은 메시지 미리보기 |
| `bridge_tail(limit?)` | 아니오 | 최근 메시지 확인 |
| `bridge_roles()` | 아니오 | 프로젝트의 역할 목록 |
| `bridge_whoami()` | 아니오 | 이 세션의 프로젝트 + 역할 보기 |
| `bridge_config()` | 아니오 | 자동화 설정 보기 |
| `bridge_mode(project, role, auto\|manual)` | **예** | 역할의 모드 설정 |
| `bridge_set(project, role, {...})` | **예** | 역할 구성(cwd/model/tmuxTarget/permissionMode) |
| `bridge_settings({...})` | **예** | 전역 설정값(driver/maxHops/rate/…) |

### CLI

```bash
# 버스 들여다보기 (아무 역할이나 신원으로 사용)
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge roles
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge send frontend "hello"
BRIDGE_PROJECT=shop BRIDGE_ROLE=cli session-bridge tail 20
session-bridge root            # 버스 저장 디렉터리

# 스포너
session-bridge spawner set <project> <role> cwd=<path> [model=<m>] [tmuxTarget=<t>]
session-bridge spawner on  [project] [role]
session-bridge spawner off [project] [role]
session-bridge spawner status
session-bridge spawner run [--replay]
```

### 환경 변수

| 변수 | 필수 | 기본값 | 의미 |
|-----|----------|---------|---------|
| `BRIDGE_PROJECT` | 예 | — | 프로젝트(방) 이름 — 격리 경계 |
| `BRIDGE_ROLE` | 예 | — | 이 세션의 역할(닉네임) |
| `BRIDGE_ADMIN` | 아니오 | 꺼짐 | `1`이면 이 세션이 자동화 설정을 바꿀 수 있음 |
| `BRIDGE_ROOT` | 아니오 | `~/.claude/bridge` | 메시지/설정이 저장되는 곳 |
| `BRIDGE_BLOCK_GIT` | 아니오 | `commit\|push\|reset` | block-git 훅이 거부하는 git 작업의 정규식 |
| `BRIDGE_AUTOSEND` | 아니오 | 꺼짐 | `1`이면 Stop 자동 보내기 훅 활성화 |
| `BRIDGE_SEND_TO` | 아니오 | `*` | 자동 보내기의 기본 수신자 |
| `BRIDGE_HOP` | 아니오 | `0` | 루프 가드 홉(spawn 드라이버가 설정함) |

### 선택: 매 차례마다 자동으로 보내기

기본적으로 꺼져 있습니다 — 의도적인 `bridge_send`가 더 권장됩니다. 세션의 마지막
메시지를 매 차례 자동으로 방송하려면, `BRIDGE_AUTOSEND=1`을 설정하고 Stop 훅을
`settings.json`에 추가하세요(`dist/hooks/send.js`). 대상은 `BRIDGE_SEND_TO`로
덮어쓰세요. 의도적으로 보내는 것보다 더 시끄럽고 토큰을 더 씁니다.

### 작동 원리 (궁금한 분들을 위해)

메시지와 설정은 `BRIDGE_ROOT` 아래에 있는 평범한 파일들입니다:

```
~/.claude/bridge/
  spawner.config.json          자동화 설정 (실시간으로 편집됨)
  <project>/
    <role>.inbox.jsonl         그 역할을 위한, 추가만 가능한 메시지 로그
    .cursors/<role>.cursor     그 역할이 메시지를 몇 개나 읽었는지
    .sessions/<role>.pane      tmux 창 id, tmux 드라이버가 그것을 찾기 위한 것
```

`bridge_send`는 수신자의 받은 편지함에 메시지를 덧붙입니다. 받기 훅은 당신의 커서
지점부터 앞으로 받은 편지함을 읽고, 새 줄들을 주입한 뒤, 커서를 전진시킵니다 — 그래서
같은 메시지를 두 번 보는 일이 없습니다. 격리는 그저 프로젝트별 폴더일 뿐입니다.

### 테스트

```bash
npm test             # MCP 버스 종단 간(end-to-end)
npm run test:config  # 설정 대시보드 + 관리자 게이트
npm run test:prompts # /mcp 프롬프트가 변경을 적용함 (관리자 게이트)
npm run test:spawner # spawn 드라이버 핑퐁 + 루프 가드
npm run test:tmux    # tmux 드라이버 핑퐁 + 루프 가드
npm run test:real    # `claude -p`를 사용한 실제 두 세션 테스트
```

### 라이선스

MIT
