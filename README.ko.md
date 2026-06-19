# grudge

[English](./README.md)

네 AI 코딩 에이전트가 자기 실수에 앙심을 품는다 — 같은 실수를 두 번 하지 않도록.

## grudge란?

grudge는 AI 코딩 에이전트를 위한 이식형 교훈 메모리 도구다. Claude Code, Codex, opencode, pi, gjc, 그리고 Agent Skills와 호환되는 다른 하네스가 과거 실수를 구조화된 교훈으로 기억하고, 다음 작업에 관련 교훈을 주입하고, 같은 실패를 반복하지 않게 만든다.

중심은 모델이 아니라 프로젝트다. 교훈은 모델의 흐릿한 기억이 아니라 저장소 안의 파일로 남는다. 그래서 코드베이스와 함께 이동하고, 리뷰할 수 있고, supersede로 교체할 수 있고, 압축할 수 있으며, 지원되는 어떤 에이전트도 다시 사용할 수 있다.

프로젝트에 교훈이 쌓일수록 에이전트는 그 프로젝트에 대해 기계적으로 더 똑똑해진다. 이름 짓기 함정, 마이그레이션 규칙, UX 실수, 리뷰에서 맞은 흔적, “이거 전에 한 번 깨먹었다”는 맥락이 필요한 순간에 다시 읽힌다.

## Why

모델은 이전 사고를 안정적으로 기억하지 못한다. 채팅 기록 어딘가에 정답이 있어도 새 세션이나 다른 코딩 하네스는 보통 빈손으로 시작한다.

grudge는 이 지루하지만 비싼 실패를 교훈 파일과 자동 주입 루프로 막는다. 실수를 승인된 교훈으로 남기고, 관련 교훈을 다시 꺼내고, 반복을 차단한다. 마법 같은 기억이 아니다. 교훈을 쓰고, 교훈을 찾고, 반복을 막는 작고 감사 가능한 피드백 루프다.

## Install / Quickstart

에이전트가 실수에서 배우게 만들 프로젝트에서 grudge를 실행한다:

```sh
npx grudge init
```

또는:

```sh
bunx grudge init
```

`npx`/`bunx`는 전역 설치 없이 실행하므로 PATH에 bare `grudge` 명령이 남지 않는다. bare `grudge`를 쓰려면 전역 설치한다:

```sh
npm i -g grudge   # 이후: grudge init, grudge lint, grudge propose, ...
```

`init`은 선택한 코딩 에이전트 하네스에 grudge 스킬 자산을 설치하고 lessons 장부를 만든다. 이후 에이전트는 새 교훈을 lint하고, area 기준으로 관련 교훈을 retrieve하고, 초안의 중복 여부를 dedup하고, 쌓인 교훈을 compact해서 더 촘촘한 승인된 메모리로 정리할 수 있다.

유용한 init 옵션:

```sh
npx grudge init --tools claude,codex,opencode,pi,gjc --lessons-dir .grudge/lessons --yes
```

## Commands

| Command | Purpose |
| --- | --- |
| `npx grudge init` / `bunx grudge init` | 스킬을 설치하고 lessons 장부를 만든다. Options: `--tools claude,codex,opencode,pi,gjc`, `--lessons-dir`, `--yes`, `--hooks`. |
| `npx grudge lint [path]` | lesson 파일을 schema gate로 검사한다. |
| `grudge retrieve --area <a> [--limit n] [--json]` | area에 맞는 승인된 교훈을 다시 읽고 필요하면 JSON으로 출력한다. |
| `grudge dedup <draft.md> [--json]` | 초안 lesson의 중복, 모호한 일반론, 이미 다룬 지침 여부를 검사한다. |
| `grudge compact [--json]` | 비대한 lesson 묶음, supersede 후보, 룰 승격 후보를 드러낸다. |
| `grudge propose [--json]` | compact 클러스터, lint 재발 advisory, 중복 위험 쌍을 한 번에 모아 merge/mechanize/archive/keep 제안을 report-only로 쓴다. |
| `grudge hooks install [--type pre-push|post-commit]` | `grudge propose`를 실행하고 항상 exit 0으로 끝나는 비차단 Git hook을 설치한다. |
| `grudge --version` | 설치된 grudge 버전을 출력한다. |
| `grudge help` | CLI help를 보여준다. |

## How it works

grudge는 세 층으로 움직인다:

1. **스킬 = 루프** — 실수를 포착하고, 교훈으로 구조화하고, 관련 교훈을 다시 꺼내고, 메모리 변경 전 사람 승인을 받는 재사용 워크플로다.
2. **에이전트 = 손** — 실제 코딩 작업을 수행하는 Claude Code, Codex, opencode, pi, gjc 또는 다른 하네스다.
3. **장부 = 메모리** — 프로젝트와 함께 커밋되는 구조화된 lesson 파일이다. “똑똑해짐”은 여기서 나온다.

핵심 메커니즘은 다섯 가지다:

1. **lint** — lesson frontmatter와 필수 본문 섹션을 검사하는 스키마 게이트.
2. **retrieve** — 해당 area 작업 전에 관련 교훈을 다시 읽어 주입하는 단계.
3. **dedup** — 중복 교훈과 쓸모없는 일반론을 막는 필터.
4. **compact** — 비대해진 교훈 묶음을 정리하고 룰 승격 후보를 드러내는 압축 단계.
5. **propose** — merge, mechanize, archive, keep 후보를 분류하는 한 번짜리 report-only 큐레이션 묶음. 교훈 supersede, mechanize, archive는 사람 승인 뒤에만 적용하며 grudge가 자동 적용하지 않는다.

`fe-design-refine` 스킬은 프론트엔드 작업을 위한 불만-메모리 루프다. 불만을 구조화하고, 집중된 critique로 fan-out하고, 수정 결과를 검증하고, 승인된 교훈을 회수해서 같은 디자인 실수가 계속 돌아오지 않게 한다.

## Periodic & background proposals

`grudge hooks install`은 기본 `pre-push` report-only Git hook을 추가해 주기적으로 `grudge propose`를 실행하고 제안을 출력하며 항상 exit 0으로 끝난다. 커밋이나 푸시를 막지 않는다.

grudge 스킬 사용 중 백그라운드 작업을 지원하는 하네스는 메인 작업을 막지 않고 sub-agent에서 `grudge propose`를 실행할 수 있다. 결과는 merge, mechanize, archive, keep 결정을 위한 사람용 큐레이션 큐다. 모든 제안은 사람이 승인하고 적용하기 전까지 advisory다.

## Auto-capture (pi)

`grudge init`이 pi 배선을 설치할 때 `grudge-capture` pi 확장도 `.pi/extensions/grudge-capture/index.ts`에 설치한다. 이 확장은 pi의 `session_shutdown` 훅을 듣고, 세션에서 edit/write 도구가 사용됐으면 백그라운드 pi 검토를 시작해 `lessons/_inbox/` 아래에 lesson 초안을 제안한다.

수동 설치는 `assets/pi/extensions/grudge-capture/index.ts`를 `.pi/extensions/grudge-capture/index.ts`로 복사하면 된다. 끄려면 `GRUDGE_NO_CAPTURE=1`을 설정한다.

Auto-capture는 제안만 한다. lesson을 활성화하거나 병합하거나 승인하지 않는다. 편집이 있었던 세션마다 백그라운드 LLM 실행이 1회 발생할 수 있으므로 실제 비용이 드는 편의 기능으로 다뤄야 한다.

```text
complaint / failure
        |
        v
structured lesson draft
        |
        v
lint + dedup + human approval
        |
        v
project lesson ledger
        |
        v
retrieve relevant lessons
        |
        v
agent avoids the repeat
        |
        +----> new scars become better lessons
```

## Supported coding agents

| Agent | Installed skills path |
| --- | --- |
| Claude Code | `.claude/skills` |
| Codex | `~/.codex/skills` |
| opencode | `~/.config/opencode/skills` |
| pi | `.agents/skills` and `.pi/settings.json` |
| gjc | `docs/skills` |

grudge는 Agent Skills 표준을 기반으로 한다. 같은 스킬 레이아웃과 호출 모델을 따르는 도구라면 대부분 호환되거나 얇은 installer adapter만 있으면 된다.

## The lesson format

lesson은 엄격한 frontmatter와 작은 필수 본문을 가진 Markdown 파일이다. 예시는 다음과 같다:

```md
---
date: 2026-06-19
classification: defect
severity: medium
status: active
domain: frontend
area: forms
superseded_by: null
---

## Problem
The agent reused a stale form pattern and broke validation feedback.

## Lesson
Before editing forms, retrieve the current form-pattern lessons and verify error states, disabled states, and success states against the design system.

## Evidence
- Review comment or bug report that exposed the repeated mistake.
- Test, screenshot, or transcript proving the corrected behavior.

## Retrieval cues
- frontend
- forms
- validation
- error states
```

## Status

grudge는 v0.1이다. 아직 초기 단계이고, CLI-first이며, 일부러 단순하게 만들고 있다. 현재 초점은 지원되는 코딩 에이전트 하네스 전반에서 안정적인 설치, lesson 검증, retrieve, 중복 감지, compact가 작동하게 하는 것이다.

GUI/TUI 대시보드는 로드맵에 있다. 더 큰 비전은 표면별 검증 계층이다. 안전한 곳에는 자동 텔레메트리, 판단이 필요한 곳에는 휴먼 게이트, 그리고 오래된 실수가 죽은 채로 남아 있는지 확인하는 스팟 회귀를 둔다.

## License

MIT
