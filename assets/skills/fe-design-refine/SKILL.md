---
name: fe-design-refine
title: FE 디자인 다듬기 (장부 메모리 루프)
description: 사용자의 "이거 어색함/맘에 안듦" 불만을 구조화해 GLM/Gemini 등 sub-agent로 fan-out하고, 디자인 시스템 SSOT를 지키며 깎은 뒤 검증까지 하고 돌아온다. 승인되면 인사이트를 lessons ledger (default docs/lessons or ./lessons) 장부로 회수해 다음 작업이 점점 똑똑해진다. 하네스 무관(opencode/GJC) 산문 루프.
triggers:
  - FE 다듬기
  - 화면 어색함
  - 디자인 불만
  - 페이지 정돈
  - 컴포넌트 조립 이상
  - design refine
parents:
  - lessons ledger (default docs/lessons or ./lessons)/_index.md
  - the repo audit-checklist/design-system checklist
  - docs/design-system/behavior-patterns.md
  - docs/design-system/flow-patterns.md
  - the repo AGENTS.md/UI package rules
---

# Skill — FE 디자인 다듬기 (장부 메모리 루프)

> 디자인 시스템은 잘 깎여 있는데 **부품을 잘못 조립**해 결과물이 어색한 상태를 정돈한다. 한 번에 끝내는 도구가 아니라, 불만 1건을 받아 깎고 검증하고 회수하는 **루프**다. 장부(`lessons ledger (default docs/lessons or ./lessons)`)를 메모리로 읽고 쓰며 매 사이클 똑똑해진다.

## 3층 모델 (이 스킬의 정체)

- **스킬 = 루프** (이 문서): 불만 접수 → 구조화 → fan-out → 검증 → 제시 → 승인 시 회수.
- **에이전트 = 손**: 실제 편집·판단은 sub-agent가 한다. 모델은 돌리는 하네스가 배정(예: 시각/레이아웃 판단은 Gemini, 대량 편집·codemod는 GLM).
- **장부 = 메모리**: `lessons ledger (default docs/lessons or ./lessons)` + `the repo audit-checklist/design-system checklist`. step0에서 읽고 마지막에 쓴다. **"똑똑해짐"은 스킬도 에이전트도 아니라 이 장부에서 나온다.**

## 비협상 규칙

1. **디자인 시스템 SSOT 우회 금지**. raw hex·한글 `tracking-wider`·primitive 직접 재구현·`<Card className="p-*">` 직박 등 `the repo AGENTS.md/UI package rules`가 금지한 패턴 0건. 우회가 보이면 className 패치가 아니라 **합성 SSOT atom 신설**(lesson 08 교훈).
2. **공유 atom/scaffold 변경은 순차**. v1은 **단일 executor**(병렬 X). 독립 라우트만 병렬 후보, 플라이휠 검증 후 도입.
3. **검증 없이 돌아오지 않는다**. 아래 검증 계층을 통과한 diff만 제시.
4. **회수는 사람 승인 후**. 레슨 기록·승격·supersede는 항상 사람 게이트. 하드삭제 금지.

## 하네스 무관 I/O 계약

이 스킬은 산문이다. 실제 모델 dispatch는 돌리는 하네스가 자기 방식으로 한다. 입력/출력/중지조건은 하네스 무관 고정:

- **입력(불만 구조화 결과)**: `route`, `component`, `UX축`(밀도·위계·정렬·여백·라이브성), `패턴코드`(behavior `B*` / flow `F*`), 의심 `atom·token 경계`.
- **출력(각 sub-agent가 반환)**: 변경 파일 목록, 검증 증거(typecheck/lsp/audit/tests/시각QA), before/after 스크린샷, 적용한/우회한 DS atom.
- **중지조건**: 한 번에 다 갈아엎기 금지(거버넌스 — 플로우 1개씩). 공유 atom 우회 발견 시 즉시 STOP.

### 하네스 어댑터 노트
- **opencode**: agent별 모델 배정(GLM/Gemini), Figma Dev Mode MCP로 디자인 토큰 직결. fan-out = opencode subagent.
- **GJC**: `task` 툴 sub-agent로 fan-out, 모델은 GJC가 배정.
- 두 하네스 모두 위 I/O 계약을 반환해야 한다. 스킬 본문은 특정 하네스에 의존하지 않는다.

## 표준 워크플로우

### step0 — 근거 로드 (recall 아니라 retrieval)
다음을 **기계적으로 주입**한다. "기억해서 참고"에 의존하지 않는다:
- `grudge retrieve --area <편집 대상 경로/패턴코드>` → 관련 active 레슨 digest. (예: `--area packages/ui` → SectionCard 패딩 교훈 자동 등장)
- `the repo audit-checklist/design-system checklist` 의 grep 게이트.
- `the repo AGENTS.md/UI package rules` 의 atom-first 계약·HARD RULE.
- 검색된 레슨 + 체크리스트에서 "이번 슬라이스의 제약 5줄"을 뽑아 fan-out 프롬프트에 hard constraint로 박는다.

### 1 — 불만 구조화 (deep-interview-lite)
"이거 맘에 안듦"을 위 I/O 계약 입력 4필드로 변환. 불만을 `B*`/`F*` 패턴코드로 매핑. 4필드면 충분 — 과형식화 금지.

### 2 — fan-out
- v1: **단일 executor**. 공유 atom이면 순차(한 에이전트가 SSOT atom 바꾸면 나머지가 그 결과 위에 조립).
- 독립 라우트면 병렬 후보(플라이휠 검증 후).
- step0 digest를 hard constraint로 전달.

### 3 — 검증 (눈이 아니라 기계)
- `pnpm --filter @the project/ui typecheck` + 변경 파일 `lsp diagnostics`
- 디자인 감사: `bash docs/scripts/audit-design-system.sh <경로>` **있으면 사용**, 없으면 `the repo audit-checklist/design-system checklist` 의 grep을 직접 0건 통과 확인. (이 스크립트는 체크리스트가 참조하나 미존재일 수 있음 — 폴백 명시)
- 해당 라우트 `__tests__/*` 녹색 유지 (예: `apps/web/app/(workspace)/people/__tests__/`)
- 시각 QA: 데스크톱/모바일 스크린샷, no horizontal scroll, 한글 가독성

### 4 — 제시
diff 요약 + before/after 스크린샷. 사용자 판단 대기.

### 5 — 승인 시 회수 (플라이휠)
사용자가 "괜찮다" 하면:
- `lessons-extract` 산문 워크플로우 호출(작성자≠검증자: critic은 다른 모델). 신규 레슨 착지 전 **lint + dedup + critic 3중 게이트**:
  - `grudge dedup <draft>` (2-밴드: blocking 중복 차단 / advisory)
  - `grudge lint` (스키마·재발신호·area 후보 제안)
- grep으로 만들 수 있는 교훈은 `the repo audit-checklist/design-system checklist` 룰로 **승격(mechanized)** — 그러면 다음엔 "참고"가 선택이 아니라 검증 실패가 된다. (사람 승인)
- 주기적으로 `grudge compact` 가 비대해진 레슨의 묶음/승격 후보를 제안(사람 승인, supersede).
- **(선택) 백그라운드 제안**: 하네스가 백그라운드 sub-agent를 지원하면, 메인 작업을 막지 않고 sub-agent로 `grudge propose`를 돌려 큐레이션 제안(병합/기계화/아카이브 후보)을 수집→사람에게 제시. 제안만, 자동 적용 금지. 하네스별: opencode/gjc=task·subagent, pi=background, 없으면 생략.

## 검증 계층 ("똑똑해짐"의 정의)
- **D (승격/supersede 카운터) + B (retrieve 주입 로그)** = 상시 자동 텔레메트리. `artifacts/grudge/` 리포트.
- **A (같은 류 불만 재발 없음)** = 매 세션 휴먼 게이트. 실제 결과 신호.
- **C (before/after 회귀)** = 스팟체크 전용(의심 시만). 매번 강제 X.

## 중지 조건
- 한 번에 다 갈아엎기 요구 → STOP, 플로우 1개씩으로 재협상.
- 공유 atom 우회 패턴 발견 → STOP, 합성 SSOT atom 신설 경로로.
- 디자인 시스템 토큰을 raw로 박으려는 충동 → STOP, atom/scaffold로.

## 산출물 계약
- 변경 diff + before/after 스크린샷
- 검증 증거(typecheck/lsp/audit/tests/시각QA)
- 승인 시: `lessons ledger (default docs/lessons or ./lessons)/2026/NN-*.md` 신규 레슨(lint+dedup+critic 통과) 또는 기존 보강, 필요 시 audit-checklist 룰 승격

## 관련
- 장부 라이프사이클: `lessons ledger (default docs/lessons or ./lessons)/_index.md`, `scripts/lessons-{lint,retrieve,dedup,compact}.mjs`
- 글로벌 writer: `~/.config/opencode/skills/lessons-extract.md` (critic 산문 스텝 + 풍부 스키마)
- 플라이휠 사례: `lessons ledger (default docs/lessons or ./lessons)/2026/08-sectioncard-ssot-card-cardsectionheader-bypass.md` (불만→root cause→SSOT atom→AGENTS.md 룰→grep 게이트)
