---
name: lessons-extract
description: "세션 종료·주요 작업 완료 후 교훈·실수·재발 방지 요점을 추출해 프로젝트 lessons ledger 또는 handoff 문서에 누적. 비효율·반복 탐색·중복 위임·잘못된 가정·overtriggering 등 메타-패턴 식별."
---

# Lessons Extract — 교훈 누적

> 한 세션의 실수·비효율·재발 방지 패턴을 휘발시키지 않고 현재 레포가 제공하는 lessons ledger에 누적한다. AI 에이전트가 다음 세션에 검색 가능한 근거로 재사용한다.

## 언제 발동

- 사용자가 "교훈 정리", "lessons 추출", "회고", "handoff" 호출 시
- 큰 작업(100+ 메시지 세션, 다중 백그라운드 fire) 완료 직후
- 같은 실수 반복 발견 시 (사용자 질책 또는 자가 인식)
- 다음 세션을 위한 컨텍스트 누적이 필요할 때
- meta-audit 결과 🔴 항목 발견 시 — 재발 방지로 lessons 추가

## 추출 절차

### 1. 세션 메타 수집

- 사용 가능한 세션 도구로 메시지 수·기간·에이전트 종류를 확인한다.
- 큰 패턴이면 세션 읽기/검색 도구로 핵심 메시지와 실제 실패 지점을 추적한다.
- 현재 레포의 lessons 위치와 스키마를 먼저 확인한다. 기본 후보는 `docs/lessons/` 와 `docs/handoff/` 이지만, 레포가 다른 경로를 명시하면 그 경로를 따른다.

### 2. 4종 root-cause 분류

| 분류 | 정의 |
|---|---|
| **slop** | 과장·필러·환각·과잉 설명 — 사용자 가치에 기여 안 한 출력 |
| **gap** | 누락·검증 부재·핵심 회피 — 했어야 할 것 안 한 부분 |
| **inefficiency** | 반복 탐색·중복 위임·context 낭비·불필요한 백그라운드 |
| **misalignment** | 사용자 의도 오독·범위 일탈·소유권 침범·다른 세션 작업 되돌림 |

`classification` 은 root-cause 축이다. 제품 영역·기술 영역·문서 영역은 `domain` 또는 `area` 로 분리한다.

### 3. lesson 마크다운 작성 (단일 사실 = 단일 파일)

경로: 프로젝트 레포의 lessons 규약을 따른다. 기본 예시는 `docs/lessons/YYYY/NN-short-slug.md` 또는 `docs/handoff/YYYY-MM-DD-session-slug.md`.

현재 레포가 richer frontmatter를 지원하면 아래 스키마를 사용한다.

```markdown
---
date: YYYY-MM-DD
session: ses_xxxxx
classification: slop | gap | inefficiency | misalignment
severity: low | medium | high
status: active | mechanized | promoted | superseded
domain: optional-domain
area: [optional/area, other-area]
related_skills: [meta-audit, lessons-extract]
superseded_by: optional/path/to/parent.md
---

# [한 줄 제목 — 무엇을 잘못했나]

## TL;DR
1-3 문장. 다음 세션이 검색 결과에서 바로 판단할 수 있는 압축 요약.

## 무슨 일이 있었나
1-3 문장. 사실 위주, 변명 없이.

## 왜 일어났나
1-2 문장. 근본 원인.

## 재발 방지
- 액션 1 (구체적, 검증 가능; 파일 경로, grep 패턴, 명령, 체크리스트 링크 중 최소 하나 포함)
- 액션 2

## 관련 룰·스킬
- [관련 항목 링크]
```

필드 규칙:

- `date`: lesson 작성 또는 사건 확정일, `YYYY-MM-DD`.
- `classification`: 반드시 `slop | gap | inefficiency | misalignment` 중 하나.
- `severity`: 반드시 `low | medium | high` 중 하나.
- `status`: 신규 lesson은 기본 `active`. `mechanized`, `promoted`, `superseded` 는 사람이 승인한 전환일 때만 사용.
- `domain`: 선택 문자열. 예: `tooling`, `verification`, `design-system`, `typescript`, `process`.
- `area`: 선택 배열. 레포 경로, 패키지, 라우트, 스킬명, 시스템 영역처럼 retrieve 가능한 단위를 넣는다.
- `related_skills`: 선택 배열. 관련 스킬·프로세스만 기록한다.
- `superseded_by`: `status: superseded` 일 때만 사용하며 기존 parent lesson 경로를 가리킨다.

### 4. Critic 검증 (작성자 ≠ 검증자)

초안 작성자와 검증자는 분리한다. 다른 모델 또는 별도 reviewer가 다음 항목을 산문으로 검토하고, 통과하지 못하면 초안을 수정하거나 폐기한다.

- **일반화**: 단일 사건 묘사가 아니라 다음 세션이 재사용할 수 있는 패턴인가?
- **root cause**: `classification` 이 증상·도메인이 아니라 원인 축인가?
- **grep-able 재발 방지**: `재발 방지` 에 파일 경로, grep 패턴, 명령, 체크리스트 링크, 룰 anchor 중 하나 이상이 있는가?
- **중복 위험**: 기존 active lessons와 같은 사건이면 신규 파일 대신 기존 lesson 보강 또는 supersede 후보로 처리했는가?
- **area confidence**: `area` 가 실제 검색·주입에 도움이 되며 과도하게 넓거나 좁지 않은가?
- **traceability**: mechanized/promoted 주장에는 양방향 링크가 있는가?
- **스키마 유효성**: 현재 레포의 lint 스키마와 enum을 만족하는가?

### 5. 지점 전 3중 게이트

신규 lesson을 merge/landing 하기 전 반드시 세 게이트를 통과한다. 도구 이름은 레포별로 다를 수 있으나, 아래 의미를 만족해야 한다.

1. **lint gate**: frontmatter enum, required fields, 재발 방지 concrete signal, supersede/traceability 규칙을 검사한다. 예: `node scripts/lessons-lint.mjs`.
2. **dedup gate**: 신규 draft와 기존 active lessons를 비교한다. blocking band는 비제로 종료하며 "기존 보강 vs 신규 branch rationale" 결정을 요구한다. advisory band는 exit 0이어도 reviewer 확인이 필요하다. 예: `node scripts/lessons-dedup.mjs <draft.md>`.
3. **critic gate**: 작성자와 다른 검증자가 일반화/root-cause/grep-able/중복/area/traceability/schema를 산문 검토한다.

세 게이트 중 하나라도 실패하면 신규 lesson을 착지시키지 않는다.

### 6. 누적 정책

- **하나의 파일 = 하나의 교훈**. 묶지 마라. 단, 중복이면 새 파일보다 기존 lesson 보강 또는 승인된 supersede 흐름을 우선한다.
- **분기별 _index.md 갱신**: 레포가 index를 요구하면 사용자 또는 다음 세션이 훑을 수 있도록 갱신한다.
- **AGENTS.md 에는 등재만, 본문 누적 금지**: 레포 규약이 요구할 때 한 줄 링크로만 남긴다.
- **portable 유지**: 특정 레포명·조직명·모델명·하네스 전용 호출을 하드코딩하지 않는다. 현재 레포가 제공하는 스키마와 CLI를 발견해서 사용한다.

## 자동 트리거 후보 (제안)

- 사용자가 "UNACCEPTABLE", "다시", "왜 X 했어" 같은 질책 키워드 사용 시
- 백그라운드 에이전트가 false-clean 보고했을 때
- 같은 검색을 두 번 이상 fire 했을 때

## 금지

- ✗ 변명 누적: "어쩔 수 없었다", "사용자가 명확히 말 안 했다"
- ✗ 일반론: "더 신중해야 한다" — 구체적 액션만
- ✗ 본인 칭찬: "잘 해결됐다" — 사실만
- ✗ 다른 세션·다른 에이전트 책임 전가
- ✗ 민감 데이터 누설
- ✗ lint + dedup + critic 없이 신규 lesson 착지

## 출력 예

```markdown
---
date: 2026-05-22
session: ses_1b26dc594
classification: misalignment
severity: medium
status: active
domain: governance
area: [global-instructions]
related_skills: [meta-audit, lessons-extract]
---

# omo 시스템 프롬프트 수정 권고 — 영역 침범

## TL;DR
소유권이 다른 instruction 영역을 한 묶음으로 취급해 수정 권고를 냈다. 다음에는 권고 전 영역을 분리하고 소유권 밖 항목은 정보 제공으로 제한한다.

## 무슨 일이 있었나
회의 보고서에서 omo가 주입하는 시스템 프롬프트의 어조(MUST·NEVER 등) 톤다운을 권고했다. 사용자가 "omo 프롬프트는 전적으로 존중" 정정했다.

## 왜 일어났나
"글로벌 프롬프트"라는 모호한 표현으로 omo 영역과 사용자 instructions 를 구분하지 않고 한 묶음으로 다뤘다.

## 재발 방지
- 권고안 작성 전 영역 명시: owner/runtime/project/session 4분류
- 소유권 밖 영역은 "정보 제공만" 으로 격하, "권고 금지"
- 사용자 글로벌 설정 경로와 프로젝트 설정 경로를 별도 목록으로 확인

## 관련 룰·스킬
- meta-audit (출처·영역 분류)
```
