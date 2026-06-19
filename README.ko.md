<div align="center">

[![English](https://img.shields.io/badge/English-555?style=for-the-badge)](README.md)
[![한국어](https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-2ea44f?style=for-the-badge)](README.ko.md)
[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-555?style=for-the-badge)](README.zh.md)
[![日本語](https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-555?style=for-the-badge)](README.ja.md)

</div>

# claude-session-bridge

**두 개(또는 그 이상)의 Claude Code 세션이 서로 대화하게 하고, 원한다면 스스로
협업까지 하도록 만드는 도구입니다.**

여러분은 **backend**용으로 Claude Code 세션 하나를 열고, **frontend**용으로
또 다른 세션을 엽니다. 보통 이 두 세션은 서로의 존재를 전혀 모릅니다 — backend가
API를 바꾸면, 그 결과를 손으로 복사해서 frontend 세션에 붙여넣어야 하죠.

이 도구는 그 복사-붙여넣기를 없애줍니다. 한 세션이 결과를 **보내면(send)**, 같은
방에 있는 다른 세션들이 그것을 **자동으로 받습니다(receive)**. 선택 사항인 자동
모드를 켜면, 작업을 끝낸 backend가 frontend를 **깨워서** 반응하게 만들 수도
있습니다 — 손 댈 필요 없는 핑퐁이죠. 그러면서도 안전장치(자동 커밋 금지, 배포
차단, 루프 가드)는 여러분이 완전히 통제하고, 모든 설정을 Claude 안에서 바꿀 수
있습니다.

> 처음 오셨나요? 위에서 아래로 읽으세요 — 모든 명령어가 다 들어 있습니다. 내부
> 구조를 이해하지 않아도 사용할 수 있습니다.

---

## 목차

- [어떻게 그려보면 좋을까](#어떻게-그려보면-좋을까)
- [필요한 것](#필요한-것)
- [설치 (한 번만)](#설치-한-번만)
- [두 세션 연결하기](#두-세션-연결하기)
  - [변수를 설정하는 두 가지 방법](#변수를-설정하는-두-가지-방법)
  - [tmux 사용하기](#tmux-사용하기)
- [메시지 보내고 받기](#메시지-보내고-받기)
- [역할은 그저 이름표일 뿐](#역할은-그저-이름표일-뿐)
- [여러 프로젝트를 동시에 돌리기](#여러-프로젝트를-동시에-돌리기)
- [자동 모드: 이벤트 스포너](#자동-모드-이벤트-스포너)
  - [두 가지 드라이버: tmux vs spawn](#두-가지-드라이버-tmux-vs-spawn)
  - [설정하고 실행하기](#설정하고-실행하기)
  - [안전장치](#안전장치)
  - [민감한 역할은 기본적으로 꺼져 있음](#민감한-역할은-기본적으로-꺼져-있음)
  - [절대 자동 커밋하지 않기 (그리고 허용하는 법)](#절대-자동-커밋하지-않기-그리고-허용하는-법)
  - [자동 배포는 조심하세요](#자동-배포는-조심하세요)
- [Claude 안에서 설정 바꾸기](#claude-안에서-설정-바꾸기)
- [레퍼런스](#레퍼런스)

---

## 어떻게 그려보면 좋을까

간단한 두 가지 개념만 알면 됩니다:

- **프로젝트 = 채팅방.** 같은 프로젝트 이름으로 시작한 세션들은 같은 방에 있고
  서로 대화할 수 있습니다. 프로젝트 이름이 다르면 = 다른 방, 격리됩니다.
- **역할 = 그 방에서 쓰는 닉네임.** `backend`, `frontend`, `infra` — 원하는
  이름 무엇이든 좋습니다. 메시지를 보낼 때 역할을 지정해서 보냅니다.

```
세션 1   프로젝트 "shop"  역할 "backend"  ┐
                                          ├─ 방 "shop" (서로 대화함)
세션 2   프로젝트 "shop"  역할 "frontend" ┘

세션 3   프로젝트 "blog"  역할 "backend"  ─── 방 "blog" (별개, 격리됨)
```

**"연결" 버튼 같은 건 없습니다.** 같은 프로젝트 이름으로 두 세션을 시작하는 것이
*곧* 연결입니다.

---

## 필요한 것

- **Node.js 18+** — `node --version`으로 확인하세요
- **Claude Code** (`claude` 명령어) — `claude --version`으로 확인하세요
- **tmux** — 권장합니다. 기본 자동 모드 드라이버가 이걸 통해 여러분의 실행 중인
  세션을 조종합니다. (버스만 쓰거나 `spawn` 드라이버만 쓴다면 필요 없습니다.)

---

## 설치 (한 번만)

이 작업은 **한 번만** 합니다. 그 이후로는 이 파일들을 다시 편집할 일이
없습니다 — 세션마다 바뀌는 것은 환경 변수 두 개뿐입니다(다음 섹션에서 설명).

**1. 코드를 받아서 빌드합니다.**

```bash
git clone <this-repo-url> claude-session-bridge-mcp
cd claude-session-bridge-mcp
npm install
npm run build
```

**2. 브리지를 등록합니다.** 이 명령은 **Claude Code 세션 안에서** 실행하세요
(그래야 해당 세션의 설정 디렉터리를 대상으로 동작합니다 — 아래 참고 사항을 보세요):

```bash
npm link                  # 선택 사항: `session-bridge`를 PATH에 등록
session-bridge install    # MCP 서버 + 훅을 등록
session-bridge doctor     # 무엇이, 어디에 설정되었는지 확인
```

`install`은 MCP 서버, **수신(receive)** 훅, 그리고 **block-git** 훅
(`git commit`/`push`/`reset`을 차단)을 여러분의 활성 settings.json에 병합합니다 —
멱등적으로(여러 번 실행해도 안전하게), 다른 설정은 건드리지 않고요. 세션이
스스로 커밋하기를 *원한다면* `--no-block-git`을 붙이세요. (`session-bridge`가
`PATH`에 없으면 `node /ABSOLUTE/PATH/dist/cli.js install`을 실행하세요.)

> **업무용 계정 / 여러 프로필.** Claude Code는 `CLAUDE_CONFIG_DIR` 환경 변수가
> 설정되어 있으면 `$CLAUDE_CONFIG_DIR/settings.json`을 읽고(별도의 업무용 로그인에서
> 흔합니다), 그렇지 않으면 `~/.claude/settings.json`을 읽습니다. 이것이 "설정을
> 편집했는데 아무것도 안 바뀌었다"의 1순위 원인입니다 — 엉뚱한 파일을 편집한
> 거죠. 특정 프로필의 **세션 안에서** `session-bridge install`을 실행하면 알아서
> 올바른 파일을 대상으로 동작합니다. 프로필마다 한 번씩 실행하세요. 활성 설정
> 디렉터리를 출력해 주는 `session-bridge doctor`로 확인하세요.

<details>
<summary>수동 settings.json (직접 손으로 편집하고 싶다면)</summary>

알맞은 settings.json에 다음을 추가하세요 (`/ABSOLUTE/PATH`를 바꿔주세요):

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

모든 훅은 브리지에 연결되지 않은 세션에서는 아무 동작도 하지 않고 안전하게
넘어가므로, 전역으로 설치해 두어도 괜찮습니다. 설정은 이게 전부입니다.

---

## 두 세션 연결하기

세션을 방에 넣으려면, **시작할 때** 값 두 개를 줍니다:

| 변수 | 의미 | 예시 |
|----------|---------|---------|
| `BRIDGE_PROJECT` | 방 이름 | `shop` |
| `BRIDGE_ROLE` | 이 세션의 닉네임 | `backend` |

```bash
# 터미널 1 — 프로젝트 "shop"의 backend
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend claude

# 터미널 2 — 프로젝트 "shop"의 frontend
BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude
```

둘 다 프로젝트 `shop`을 썼으니, 같은 방에 있고 서로 대화할 수 있습니다.

### 변수를 설정하는 두 가지 방법

하나만 고르세요 — **단, 둘을 섞지 마세요. 이게 초보자가 가장 많이 하는 실수입니다.**

**방법 A — 같은 줄에 쓰기 (가장 간단하고 권장):**

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude
```

변수는 그 한 번의 `claude`에만 적용됩니다. 뒤처리할 것도 없습니다.

**방법 B — 먼저 설정하고, 그다음 실행.** 줄을 나눠 쓸 때는 **반드시** `export`를
써야 합니다:

```bash
export BRIDGE_PROJECT=shop
export BRIDGE_ROLE=frontend
claude
```

> ⚠️ **함정:** `BRIDGE_PROJECT=shop`을 `export` **없이** 별도 줄에 쓰면 `claude`가
> **보지 못하는** 셸 변수가 설정됩니다 — 브리지가 조용히 연결되지 않습니다.
> `export`를 쓰거나(방법 B), 모든 걸 한 줄에 쓰세요(방법 A).

**팁 — 별칭(alias)을 만들어** 매번 타이핑하지 않게 하세요. `~/.zshrc`(또는
`~/.bashrc`)에:

```bash
alias shop-back='BRIDGE_PROJECT=shop BRIDGE_ROLE=backend claude'
alias shop-front='BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude'
```

### tmux 사용하기

tmux는 실행 방식을 전혀 바꾸지 않습니다 — 각 창(pane)은 별도의 터미널처럼 각자
자신의 셸입니다. 각 창에서 변수를 설정하고 `claude`를 실행하세요:

```
tmux
 ├ 창 1:  BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude
 ├ 창 2:  BRIDGE_PROJECT=shop BRIDGE_ROLE=frontend claude   ← 창 1과 같은 방
 └ 창 3:  BRIDGE_PROJECT=blog BRIDGE_ROLE=backend  claude   ← 다른 방
```

tmux가 가장 중요해지는 것은 **자동 모드**에서입니다: 기본 드라이버가 이 살아 있는
창들을 자동으로 깨웁니다([스포너](#자동-모드-이벤트-스포너) 참고). tmux 안에서
시작한 세션은 자기 창을 알아서 등록합니다 — 수동 설정이 필요 없습니다.

> 한 창에서 `export`(방법 B)를 쓴 다음, 나중에 그 **같은** 창에서 *다른*
> 프로젝트의 `claude`를 실행하면, 예전 `export`가 그대로 남아 있습니다. 의외의
> 일을 피하려면 tmux 안에서는 방법 A를 쓰세요.

---

## 메시지 보내고 받기

두 세션이 같은 방을 공유하면, 그냥 이렇게 동작합니다:

1. **backend** 세션에서, 공유할 만한 게 생겼을 때:
   > "새 `/users` 응답 형태를 frontend 세션에 보내줘."

   세션이 `bridge_send` 도구를 호출해서 메시지를 전달합니다.

2. **frontend** 세션에서, 다음에 무언가 입력하는 순간 그 메시지가 컨텍스트에
   **자동으로 추가됩니다** — 복사-붙여넣기 없이요.

이게 기본("버스") 모드입니다: **보내는 것은 의도적이고**(모델이 텍스트 더미가
아니라 진짜 결과를 공유), **받는 것은 다음 턴에 자동**입니다. 운전대는 여전히
여러분이 잡고 있습니다.

어느 세션에서든 명시적으로 말할 수도 있습니다: *"브리지에 새 메시지 있는지
확인해줘"*(`bridge_recv`) 또는 *"이걸 infra에 보내줘: 스테이징 준비됐어"*
(`bridge_send`).

> 한 세션이 작업을 끝냈는데 공유할 만한 게 없으면, 그냥 보내지 않습니다 —
> 버스에 아무것도 올라가지 않고 핑퐁도 자연스럽게 끝납니다. 한가한 세션이 방을
> 도배하지 않습니다.

---

## 역할은 그저 이름표일 뿐

역할은 **여러분이 원하는 어떤 문자열이든** 됩니다 — `backend`/`frontend`뿐만이
아닙니다. 방에 원하는 만큼 세션을 추가하세요:

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=web      claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=infra    claude
BRIDGE_PROJECT=shop BRIDGE_ROLE=qa       claude
```

보낼 때는 특정 역할을 지정하거나(`to: "infra"`) 나머지 모두에게 방송할 수
있습니다(`to: "*"`). `frontend`에게 보낸 메시지는 **오직** `frontend`에게만
전달됩니다 — `infra`/`qa`는 그 메시지를 아예 보지도 못하므로, 실수로 그에 따라
행동할 수가 없습니다. (오직 `to: "*"`만 모두에게 도달합니다.) 그래서 여러 단계로
이어지는 흐름이 자연스럽습니다:

> backend가 API를 끝냄 → **web**에게 알림 → web이 UI를 업데이트 → **infra**에게
> 알림 → infra가 재배포.

이 사슬이 **자동으로** 돌아갈지는 아래의 스포너에 달려 있습니다 — 그리고 배포에
대해서는 [자동 배포는 조심하세요](#자동-배포는-조심하세요)를 먼저 읽으세요.

---

## 여러 프로젝트를 동시에 돌리기

서로 다른 프로젝트 이름을 쓰세요. 서로의 메시지를 절대 보지 못합니다:

```bash
BRIDGE_PROJECT=shop BRIDGE_ROLE=backend  claude   # 방 "shop"
BRIDGE_PROJECT=blog BRIDGE_ROLE=frontend claude   # 방 "blog" — 격리됨
```

격리는 구조적입니다(메시지가 프로젝트별 폴더 아래에 저장됩니다). 그래서 `shop`과
`blog`는 서로 넘나들 수 없습니다.

---

## 자동 모드: 이벤트 스포너

위에서 설명한 모든 것은 **여러분**을 흐름 안에 두고 있습니다 — 세션은 여러분이
턴을 줄 때만 행동합니다. **이벤트 스포너**는 그 단계를 없애주는 선택 사항인
백그라운드 프로그램(데몬)입니다: 어떤 역할이 메시지를 받으면, 스포너가 그 역할을
**자동으로 깨워서** 그에 따라 행동하게 합니다. 그래서 양쪽이 사람의 개입 없이
핑퐁을 할 수 있습니다. 이건 별도의 터미널에서 실행하며, 직접 켜야 하고(opt-in)
끄기도 쉽습니다.

### 두 가지 드라이버: tmux vs spawn

**드라이버**는 역할을 *어떻게* 깨울지를 결정합니다:

| | **tmux** (기본) | **spawn** |
|---|---|---|
| 하는 일 | **이미 열려 있는 살아 있는 세션**에 입력함 (`tmux send-keys`) | 이벤트마다 **새로운 `claude -p`** 프로세스를 실행함 |
| 세션 | 같은 세션이 계속됨 (컨텍스트 유지) | 매번 새 세션 |
| 보이나요? | 예 — 창에서 직접 지켜봅니다 | 백그라운드 (로그만) |
| `claude -p`를 쓰나요? | **아니요** | 예 |
| tmux가 필요한가요? | 예 | 아니요 |

비유하자면: **tmux**는 이미 자기 책상에 앉아 있는 직원을 톡톡 두드리는 것이고,
**spawn**은 작업마다 새 임시 직원을 고용하는 것입니다.

tmux가 기본인 이유: 이미 여러분이 작업 중인 *열려 있는* 세션들을 조율하고,
그들의 컨텍스트를 유지하며, 지켜보거나 중간에 끼어들 수 있게 해주고,
**`claude -p`를 쓰지 않습니다**(그래서 헤드리스/SDK 과금 변경의 영향을 받지
않습니다). tmux를 못 돌리거나 격리된 일회성 실행을 원할 때 `spawn`을 쓰세요.

### 설정하고 실행하기

역할은 일단 설정이 되어야만 자동으로 깨워집니다 — 기본 상태에서는 스포너가 아무
일도 하지 않으므로, 역할별로 직접 켜야 합니다:

```bash
# tmux 드라이버: 역할의 세션을 tmux 안에서 열기만 하면 — 그 창이 자동 등록됩니다.
# spawn 드라이버: 역할의 코드가 어디 있는지 알려줍니다:
session-bridge spawner set shop backend cwd=/path/to/backend

session-bridge spawner on              # 전역으로 켜기
session-bridge spawner off shop        # ...또는 프로젝트별로
session-bridge spawner off shop web    # ...또는 역할 하나만
session-bridge spawner status          # 현재 설정 살펴보기
```

(`session-bridge`는 이 패키지와 함께 설치되는 CLI입니다. `PATH`에 없으면
`node /ABSOLUTE/PATH/dist/cli.js spawner ...`를 실행하세요.)

데몬을 별도의 터미널에서 실행하세요:

```bash
session-bridge spawner run             # 포그라운드; Ctrl-C로 중지
# 또는 백그라운드로:
nohup session-bridge spawner run > ~/.claude/bridge/spawner.log 2>&1 &
```

설정은 이벤트마다 다시 읽히므로, `on`/`off`나 다른 변경 사항이 **실시간으로**
적용됩니다 — 재시작이 필요 없습니다.

### 안전장치

| 장치 | 기본값 | 하는 일 |
|------|---------|--------------|
| `maxHops` (루프 가드) | 6 | 프로젝트별 사슬 카운터가 연속 자동 깨우기 횟수를 제한하고, 조용한 시간이 지나면 초기화됩니다. 폭주하는 핑퐁을 막아줍니다(두 드라이버 모두에서 작동). |
| `rateLimitPerMinute` | 12 | 역할당 분당 최대 자동 깨우기 횟수. |
| 민감한 역할 | `infra`, `qa` | 명시적으로 켜지 않는 한 절대 자동으로 깨워지지 않음 — 잘못 전달된 메시지가 배포를 일으킬 수 없습니다. |
| 자동 커밋 금지 | 켜짐 | `git commit`/`push`/`reset` 차단됨(아래 참고). |
| 단일 실행(single-flight) / 쿨다운 | — | 역할당 한 번에 하나의 실행만(spawn); 다시-깨우기 쿨다운(tmux). |
| 대상 필수 | — | 살아 있는 창이 없거나(tmux) cwd가 없는(spawn) 역할은 절대 깨워지지 않음. |

### 민감한 역할은 기본적으로 꺼져 있음

`infra`와 `qa`는 `defaultOffRoles`에 들어 있습니다 — 스포너는 **설정이 되어
있어도 이들을 자동으로 깨우지 않습니다.** 이름을 직접 지정해서 켜야 합니다.

**왜요?** 메시지를 *누구에게* 보낼지는 보내는 쪽이 정하는데, 보내는 쪽은 언어
모델입니다. 만약 방송(`to: "*"`)을 하거나 주소를 잘못 지정하면, `infra`/`qa`가
자기들 몫이 아닌 요청을 받을 수 있습니다 — 그리고 이 역할들은 가장 위험한 일
(배포, 릴리스, 파괴적인 테스트)을 합니다. 이들을 꺼두는 것은 모델이 주소를 제대로
지정하는지에 **의존하지 않는** 보증입니다: 잘못 전달된 메시지는 사람이 그 세션을
열 때까지 그냥 받은편지함에 머물러 있을 뿐입니다.

**켜기 (완전 자동화를 원한다면):**

```bash
session-bridge spawner on shop infra      # 명시적으로 켜기 (필수)
```

[자동 배포는 조심하세요](#자동-배포는-조심하세요)를 먼저 읽으세요. 목록을 바꾸려면
`<BRIDGE_ROOT>/spawner.config.json`의 `defaultOffRoles`를 편집하세요.

### 절대 자동 커밋하지 않기 (그리고 허용하는 법)

기본적으로 자동으로 구동되는 세션은 커밋할 수 없습니다. **두 겹의 층**이 이를
강제합니다:

1. **spawn 드라이버:** 세션이
   `--disallowed-tools "Bash(git commit:*)" "Bash(git push:*)" ...`로 실행됩니다.
   거부 규칙이 허용/우회 규칙을 이기므로, 모델은 물리적으로 커밋할 수 없습니다.
2. **tmux 드라이버(살아 있는 세션):** 그 플래그들이 적용되지 않으므로,
   **`block-git` PreToolUse 훅**을 설치하세요([설치](#설치-한-번만)). 이 훅은 턴이
   어떻게 시작되었든 상관없이 모든 세션에서 `git commit`/`push`/`reset`을
   거부합니다.

> `CLAUDE.md`에 적은 알림("커밋하지 마")은 있으면 좋지만 자율적인 루프에는
> **충분하지 않습니다** — 모델은 갈팡질팡할 수 있습니다. 훅/거부 규칙이 진짜
> 보증입니다.

**커밋/푸시 자동화를 원한다면** (어떤 분들은 원합니다), 이렇게 빠져나오세요:

- `block-git` 훅을 설치하지 말고, **그리고**
- spawn 드라이버의 경우 `denyTools`(`session-bridge spawner` 설정)에서 git 항목을
  제거하세요.
- 또는 `BRIDGE_BLOCK_GIT`(정규식; 예: 커밋은 허용하되 푸시는 여전히 차단)으로
  차단 범위를 좁히세요.

> ⚠️ 자동 `push`는 바깥으로 향하고 되돌리기 어렵습니다. 허용한다면 **기능 브랜치**로
> 푸시하고 `main`을 보호하세요(브랜치 보호). `main`으로 자동 푸시하지 마세요.

### 자동 배포는 조심하세요

⚠️ 커밋/푸시는 차단됩니다 — 하지만 **배포는 git이 아닙니다.** `kubectl apply`,
`vercel deploy`, `terraform apply`, SSH 배포 스크립트 — 이것들 중 어느 것도
기본적으로 차단되지 않으므로, 자율적인 `infra` 세션이 이를 실행할 수 있습니다.
배포는 바깥으로 향하고 되돌리기 어렵습니다. 사람이 없는 상태에서 하는 것은
위험합니다.

`infra`를 흐름에 넣고 싶다면, 하나를 고르세요:

1. **infra를 수동으로 유지** (기본값 — 꺼져 있습니다). 메시지는 대기열에 쌓이고,
   여러분이 세션을 열어 직접 배포합니다.
2. **배포 명령어를 차단** (`denyTools`나 block-git 정규식에 추가).
3. **안전한 단계만 자동화** — 스테이징/드라이런은 자동, 프로덕션은 수동.

---

## Claude 안에서 설정 바꾸기

JSON을 편집하거나 CLI 플래그를 외울 필요가 없습니다. MCP 서버는 모든 자동화
설정을 **Claude 세션 안에서** 읽고 바꿀 수 있게 해줍니다 — 대시보드처럼, 대화로
하거나 `/mcp`를 통해서요.

**안전: 관리자 전용.** 설정은 `BRIDGE_ADMIN=1`로 시작한 세션(여러분의 "control"
세션)에서만 *바꿀* 수 있습니다. 자동으로 구동되는 세션은 이걸 갖고 있지 않으므로,
폭주하는 루프가 자기 안전 설정을 스스로 뒤집을 수 없습니다. 설정을 읽는 것은 항상
허용됩니다.

```bash
# 여러분의 control / 대시보드 세션
BRIDGE_PROJECT=shop BRIDGE_ROLE=control BRIDGE_ADMIN=1 claude
```

**구동하는 두 가지 방법:**

**A. 그냥 말로 하기** (모델이 도구를 호출):

> "브리지 설정 보여줘." · "frontend를 auto로 설정해." · "maxHops 3, driver
> tmux." · "자동화 꺼."

**B. `/mcp` 프롬프트** (변경을 즉석에서 적용하는 슬래시 명령어):

```
/mcp__session-bridge__show-config       현재 설정 보기
/mcp__session-bridge__set-mode          프로젝트, 역할, auto|manual
/mcp__session-bridge__configure-role    cwd / model / tmuxTarget
/mcp__session-bridge__set-driver        tmux | spawn
/mcp__session-bridge__automation        on | off  (마스터 스위치)
/mcp__session-bridge__set-limits        maxHops / rateLimitPerMinute
```

하나를 골라 인수를 채우면, 곧바로 변경 사항을 기록합니다(관리자 세션만). 데몬이
이를 실시간으로 받아들입니다.

---

## 레퍼런스

### 도구 (세션이 호출 가능)

| 도구 | 관리자? | 용도 |
|------|--------|---------|
| `bridge_send(to, body)` | 아니요 | 한 역할에게, 또는 `"*"`로 모두에게 방송 |
| `bridge_recv()` | 아니요 | 읽지 않은 메시지를 가져와서 소비 |
| `bridge_peek()` | 아니요 | 소비하지 않고 읽지 않은 메시지 미리 보기 |
| `bridge_tail(limit?)` | 아니요 | 최근 메시지 살펴보기 |
| `bridge_roles()` | 아니요 | 프로젝트의 역할 목록 |
| `bridge_whoami()` | 아니요 | 이 세션의 프로젝트 + 역할 보기 |
| `bridge_config()` | 아니요 | 자동화 설정 보기 |
| `bridge_mode(project, role, auto\|manual)` | **예** | 역할의 모드 설정 |
| `bridge_set(project, role, {...})` | **예** | 역할 설정 (cwd/model/tmuxTarget/permissionMode) |
| `bridge_settings({...})` | **예** | 전역 옵션 (driver/maxHops/rate/…) |

### CLI

```bash
# 설정 (활성 설정 디렉터리를 대상으로: $CLAUDE_CONFIG_DIR 또는 ~/.claude)
session-bridge install [--no-block-git] [--config-dir <dir>]
session-bridge doctor

# 버스 살펴보기 (아무 역할이나 본인 신원으로 사용)
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
| `BRIDGE_ADMIN` | 아니요 | 꺼짐 | `1`이면 이 세션이 자동화 설정을 바꿀 수 있음 |
| `BRIDGE_ROOT` | 아니요 | `~/.claude/bridge` | 메시지/설정이 저장되는 곳 |
| `BRIDGE_BLOCK_GIT` | 아니요 | `commit\|push\|reset` | block-git 훅이 거부하는 git 작업의 정규식 |
| `BRIDGE_AUTOSEND` | 아니요 | 꺼짐 | `1`이면 Stop 자동 전송 훅을 활성화 |
| `BRIDGE_SEND_TO` | 아니요 | `*` | 자동 전송의 기본 수신자 |
| `BRIDGE_HOP` | 아니요 | `0` | 루프 가드 홉(spawn 드라이버가 설정) |

### 선택 사항: 매 턴마다 자동 전송

기본적으로 꺼져 있습니다 — 의도적인 `bridge_send`가 권장됩니다. 매 턴마다 세션의
마지막 메시지를 자동으로 방송하려면, `BRIDGE_AUTOSEND=1`을 설정하고
`settings.json`에 Stop 훅(`dist/hooks/send.js`)을 추가하세요. 대상은
`BRIDGE_SEND_TO`로 덮어쓸 수 있습니다. 의도적인 전송보다 더 시끄럽고 토큰도 더
많이 씁니다.

### 작동 원리 (궁금한 분들을 위해)

메시지와 설정은 `BRIDGE_ROOT` 아래의 평범한 파일들입니다:

```
~/.claude/bridge/
  spawner.config.json          자동화 설정 (실시간으로 편집됨)
  <project>/
    <role>.inbox.jsonl         그 역할에게 온 메시지의 추가 전용 로그
    .cursors/<role>.cursor     그 역할이 메시지를 몇 개나 읽었는지
    .sessions/<role>.pane      tmux 창 id, tmux 드라이버가 찾을 수 있도록
```

`bridge_send`는 수신자의 받은편지함에 내용을 덧붙입니다. 수신 훅은 여러분의
받은편지함을 커서 위치부터 앞으로 읽어서 새 줄들을 주입하고 커서를 전진시킵니다 —
그래서 같은 메시지를 두 번 보는 일이 없습니다. 격리는 그저 프로젝트별 폴더입니다.

### 테스트

```bash
npm test             # MCP 버스 종단 간(end-to-end)
npm run test:config  # 설정 대시보드 + 관리자 게이트
npm run test:prompts # /mcp 프롬프트가 변경을 적용 (관리자 전용)
npm run test:spawner # spawn 드라이버 핑퐁 + 루프 가드
npm run test:tmux    # tmux 드라이버 핑퐁 + 루프 가드
npm run test:real    # `claude -p`를 사용한 실제 두-세션 테스트
```

### 라이선스

MIT
