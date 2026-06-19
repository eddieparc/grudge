# grudge

[한국어](./README.ko.md)

Your AI coding agent holds a grudge against its own mistakes — so it never makes the same one twice.

## What is grudge?

grudge is a portable lesson-memory tool for AI coding agents. Claude Code, Codex, opencode, pi, gjc, and other Agent Skills-compatible harnesses can use it to remember past mistakes as structured lessons, inject the relevant lessons into future work, and avoid repeating the same failure.

It is project-first rather than model-first. Lessons live in your repository, not in a model's vague memory, so the knowledge moves with the codebase and can be reviewed, superseded, compacted, and reused by any supported agent.

As a project accumulates lessons, the agent gets mechanically smarter about that project: naming traps, migration rules, UX gotchas, review scars, and “we already broke this once” context are read back at the moment they matter.

## Why

Models do not reliably remember your previous incidents. Even when a chat transcript contains the answer, a new session or a different coding harness usually starts cold.

grudge fixes that boring but expensive failure mode by turning mistakes into approved lesson files and mechanically injecting the relevant ones before the agent repeats the same move. It is not magic memory. It is a small, auditable feedback loop: write the lesson, retrieve the lesson, prevent the repeat.

## Install / Quickstart

Run grudge in the project where you want the agent to learn from its mistakes:

```sh
npx grudge init
```

or:

```sh
bunx grudge init
```

`npx`/`bunx` run grudge without a global install, so there is no bare `grudge` command on your PATH. For a bare `grudge` command, install it globally:

```sh
npm i -g grudge   # then: grudge init, grudge lint, grudge propose, ...
```

`init` installs the grudge skill assets for the selected coding-agent harnesses and scaffolds the lessons ledger. After that, agents can lint new lessons, retrieve relevant lessons by area, check draft lessons for duplicates, and compact accumulated lessons into tighter approved memory.

Useful init options:

```sh
npx grudge init --tools claude,codex,opencode,pi,gjc --lessons-dir .grudge/lessons --yes
```

## Commands

| Command | Purpose |
| --- | --- |
| `npx grudge init` / `bunx grudge init` | Install skills and scaffold the lessons ledger. Options: `--tools claude,codex,opencode,pi,gjc`, `--lessons-dir`, `--yes`, `--hooks`. |
| `npx grudge lint [path]` | Validate lesson files against the lesson schema gate. |
| `grudge retrieve --area <a> [--limit n] [--json]` | Read back relevant approved lessons for an area and optionally emit JSON. |
| `grudge dedup <draft.md> [--json]` | Check a draft lesson for duplicates, vague generalities, and already-covered guidance. |
| `grudge compact [--json]` | Bundle bloated lesson sets, identify supersede candidates, and surface rule-promotion candidates. |
| `grudge propose [--json]` | Write one report-only curation proposal bundle: compact clusters, lint recurrence advisories, duplicate-risk pairs, and merge/mechanize/archive/keep suggestions. |
| `grudge hooks install [--type pre-push|post-commit]` | Install a non-blocking Git hook that runs `grudge propose` and always exits 0. |
| `grudge --version` | Print the installed grudge version. |
| `grudge help` | Show CLI help. |

## How it works

grudge has three layers:

1. **Skill = loop** — the reusable workflow that notices a mistake, turns it into a lesson, retrieves relevant lessons, and asks for approval before memory changes.
2. **Agent = hands** — Claude Code, Codex, opencode, pi, gjc, or another harness that performs the actual coding work.
3. **Ledger = memory** — structured lesson files committed with the project. This is where the “getting smarter” comes from.

It relies on five mechanisms:

1. **lint** — a schema gate for lesson frontmatter and required body sections.
2. **retrieve** — relevant lesson read-back injection before work in a matching area.
3. **dedup** — rejection of duplicate lessons and useless generic advice.
4. **compact** — consolidation of bloated lesson clusters and candidates for rule promotion.
5. **propose** — a one-shot, report-only curation bundle that classifies merge, mechanize, archive, and keep candidates. Lessons are superseded, mechanized, or archived only after human approval; grudge never auto-applies those changes.

The `fe-design-refine` skill is the complaint-to-memory loop for frontend work: turn dissatisfaction into structure, fan it out into focused critique, verify the fix, and recover the approved lesson so the same design mistake does not keep coming back.

## Periodic & background proposals

`grudge hooks install` adds a report-only Git hook, defaulting to `pre-push`, that periodically runs `grudge propose`, prints suggestions, and always exits 0. It never blocks commits or pushes.

When a grudge skill is in use, harnesses that support background work can run `grudge propose` in a sub-agent while the main task continues. The result is a human-facing curation queue for merge, mechanize, archive, or keep decisions. Every proposal remains advisory until a person approves and applies it.

## Auto-capture (pi)

When `grudge init` installs pi wiring, it also installs the `grudge-capture` pi extension at `.pi/extensions/grudge-capture/index.ts`. The extension listens for pi's `session_shutdown` hook; if the session used edit/write tools, it starts a background pi review and proposes lesson drafts under `lessons/_inbox/`.

Manual install is just copying `assets/pi/extensions/grudge-capture/index.ts` to `.pi/extensions/grudge-capture/index.ts`. Disable it with `GRUDGE_NO_CAPTURE=1`.

Auto-capture is proposal-only: it does not activate, merge, or approve lessons. Each edited session can trigger one background LLM run, so treat it as a convenience with real cost.

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

grudge is based on the Agent Skills standard. Tools that follow the same skill layout and invocation model should be compatible or require only a thin installer adapter.

## The lesson format

A lesson is a Markdown file with strict frontmatter and a small required body. Example:

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

grudge is v0.1: early, CLI-first, and intentionally boring. The current focus is reliable installation, lesson validation, retrieval, duplicate detection, and compaction across supported coding-agent harnesses.

GUI and TUI dashboards are on the roadmap. The broader vision is a verification layer per surface: automatic telemetry where it is safe, human gates where judgment matters, and spot regressions that prove old mistakes stay dead.

## License

MIT
