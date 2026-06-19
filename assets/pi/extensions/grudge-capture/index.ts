/**
 * grudge-capture — pi extension
 *
 * 세션이 "실제 작업(편집)"을 한 뒤 끝나면, 백그라운드로 헤드리스 pi를 띄워
 * 방금 세션을 검토하고 재발방지 교훈 초안을 lessons/_inbox/ 에 **제안**으로 남긴다.
 * (활성 장부에 직접 투입하지 않음 — 사람 검토 + grudge dedup/lint 게이트.)
 *
 * 원칙: 기계는 제안만, 사람이 승인. 자동 병합/승격/활성화 금지.
 * 비용: 의미 있는 세션(편집 발생) 종료당 1회 LLM 실행. 끄려면 GRUDGE_NO_CAPTURE=1.
 *
 * 재귀 가드: 백그라운드 캡처 자신은 GRUDGE_CAPTURE=1 + --no-extensions 로 돌아
 *           이 확장을 다시 로드하지 않는다.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const EDIT_TOOLS = new Set(["edit", "write", "multiedit", "apply_patch", "str_replace"]);
const TRIGGER_REASONS = new Set(["quit", "new", "resume"]);

const CAPTURE_PROMPT = [
  "이 세션(포크됨)을 검토해 재발 방지 가치가 있는 교훈만 추출한다.",
  "1. lessons-extract 스킬로 교훈 초안 작성. 일반론·당연한 소리·새로울 것 없으면 아무 파일도 만들지 마라.",
  "2. 각 초안은 lessons/_inbox/<YYYY-MM-DD>-<slug>.md 로 저장한다 (활성 장부에 직접 넣지 마라 — 사람 검토 대기).",
  "3. 저장 후 `npx grudge dedup lessons/_inbox/<file>` 와 `npx grudge lint lessons/_inbox` 로 게이트. blocking 중복이면 새 파일을 버리고 기존 교훈 보강 메모만 남겨라.",
  "4. 자동 병합/승격/활성화 금지 — 전부 제안만. 끝나면 한 줄 요약만 출력.",
].join("\n");

export default function grudgeCapture(pi: ExtensionAPI) {
  // 백그라운드 캡처 자신이거나 비활성화면 아무것도 안 함.
  if (process.env.GRUDGE_CAPTURE === "1" || process.env.GRUDGE_NO_CAPTURE === "1") return;

  let edited = false;

  pi.on("tool_execution_end", async (event: any) => {
    if (!event?.isError && EDIT_TOOLS.has(event?.toolName)) edited = true;
  });

  pi.on("session_shutdown", async (event: any, ctx: any) => {
    try {
      if (!TRIGGER_REASONS.has(event?.reason)) return; // reload/fork 등은 스킵
      if (!edited) return; // 편집 없던 세션은 캡처 안 함 (비용 가드)

      const sessionFile: string | undefined = ctx?.sessionManager?.getSessionFile?.();
      if (!sessionFile || !existsSync(sessionFile)) return;

      const cwd = process.cwd();
      const args = ["-p", "--no-extensions", "--fork", sessionFile];
      const skillDir = join(cwd, ".agents/skills/lessons-extract");
      if (existsSync(skillDir)) args.push("--skill", skillDir);
      args.push(CAPTURE_PROMPT);

      ctx?.ui?.notify?.("grudge: 백그라운드 교훈 캡처 시작 → lessons/_inbox/ 검토", "info");

      const child = spawn("pi", args, {
        cwd,
        detached: true,
        stdio: "ignore",
        env: { ...process.env, GRUDGE_CAPTURE: "1" },
      });
      child.unref();
    } catch {
      // best-effort: 세션 종료를 절대 막지 않는다.
    }
  });
}
