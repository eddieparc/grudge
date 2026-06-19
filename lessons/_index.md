---
title: "Lessons ledger"
category: "agent-memory"
version: "v0.1"
revised: "2026-05-22"
status: "confirmed"
parents:
  - AGENTS.md (repo rules, when present)
  - lessons-extract skill
---

# lessons ledger — portable grudge memory

> 한 세션·한 작업에서 얻은 실수·비효율·재발 방지 패턴을 휘발시키지 않고 마크다운으로 누적한다. AI 에이전트와 사람이 다음 작업에 학습한다.

---

## 구조

```
docs/lessons or ./lessons or ./lessons/
├── _index.md                          이 파일 (인덱스)
├── YYYY/                              연도별
│   └── NN-short-slug.md               단일 교훈 = 단일 파일
└── meta-audits/                       메타-감사 결과 누적 (옵션)
    └── YYYY-MM-DD-session-slug.md
```

명명 규약:
- `NN` 은 해당 연도 내 일련번호(01, 02, ...)
- `short-slug` 은 영문 kebab-case, 5단어 이하
- 한 파일 = 한 교훈. 묶지 마라.

---

## 단일 lesson 템플릿

```markdown
---
date: YYYY-MM-DD
session: ses_xxxxx
classification: slop | gap | inefficiency | misalignment
severity: low | medium | high
status: active
domain: governance | type-safety | verification | process | tooling | design-system | ...
area: [packages/ui, apps/web]
related_skills: [...]
superseded_by: docs/lessons or ./lessons or ./lessons/YYYY/NN-replacement.md
---

# [한 줄 제목 — 무엇을 잘못했나]

## 무슨 일이 있었나
1-3 문장. 사실 위주, 변명 없이.

## 왜 일어났나
1-2 문장. 근본 원인.

## 재발 방지
- 액션 1: `path/to/file.ts`·명령·링크·코드폰트처럼 검증 가능한 신호 포함
- 액션 2

## 관련 룰·스킬
- [링크]
```

`classification`은 root-cause 타입만 기록한다. 토픽 축은 `domain`으로 분리한다. `area`는 lint가 후보를 제안하고 사람이 확정하는 하이브리드 필드다.

---

## 누적 정책

- **단일 사실 = 단일 파일**. 묶음 금지.
- **변명·일반론 금지** — 구체 액션만.
- **사용자 질책 키워드(UNACCEPTABLE, 다시, 왜 X 했어 등) 발견 시 자동 트리거 검토**.
- **민감 데이터 누설 금지** — the repository privacy/security rules; never leak sensitive data.
- **instruction ownership or scope violations use misalignment classification**.
- **classification은 4종만** — `slop`(부주의/저품질), `gap`(규칙·테스트·도구 부재), `inefficiency`(비효율·반복 비용), `misalignment`(의사결정·정책·협업 불일치). 제품·도구·디자인 같은 토픽은 `domain`에 둔다.
- **status 라이프사이클**:
  - `active`: 아직 사람이 주의해야 하는 교훈. 기본값.
  - `mechanized`: lint/checklist/rule로 기계화됨. 본문에 해당 경로·링크 앵커를 유지한다.
  - `promoted`: 상위 정책·AGENTS·운영 룰로 승격됨. 승격 대상 링크를 유지한다.
  - `superseded`: 새 교훈으로 대체됨. `superseded_by`를 기록한다.
- **하드삭제 금지** — 오래된 lesson도 archive 또는 `superseded`로 추적한다. 삭제 대신 대체 링크를 남긴다.
- **area는 optional** — lint의 area 후보 제안은 자동 기록하지 않는다. 사람이 반복 패턴·compaction 필요성을 보고 확정한다.

## legacy classification 매핑

| legacy | canonical classification | domain |
|---|---|---|
| rule-revision | misalignment | governance |
| type-safety | gap | type-safety |
| verification-gap | gap | verification |
| process | misalignment | process |
| tooling-defect | gap | tooling |
| design-debt | gap | design-system |
| tooling-rescue | inefficiency | tooling |

---

## 분기별 갱신

분기 종료 시:
1. 이 `_index.md` 의 "최근 교훈" 표 갱신
2. 분기 회고 작성 → `docs/lessons or ./lessons or ./lessons/quarterly/YYYY-QN.md` (옵션)
3. 같은 분류·같은 원인 반복 발견 시 → AGENTS.md 또는 적합 스킬로 룰 승격 검토 (사용자 결정)

---

## 최근 교훈

| 날짜 | 분류 | 제목 | 심각도 | 파일 |
|---|---|---|---|---|
| 2026-06-11 | inefficiency | 에이전트 산출물은 원시 보관 대신 문서로 승격 | medium | `2026/13-agent-artifact-promotion-policy.md` |
| 2026-05-22 | misalignment | Instruction ownership violation | medium | `2026/01-omo-domain-violation.md` (예정) |

---

## 관련

- 운영원칙 04 ([`AGENTS.md or project operating principles`](../foundations/04.-운영원칙.md))
- 핸드오프 디렉토리 ([`docs/handoff/ or project handoff directory`](../handoff/))
- 회고 자동화 후보: `lessons-extract` 스킬
- 메타-감사: `meta-audit` 스킬
