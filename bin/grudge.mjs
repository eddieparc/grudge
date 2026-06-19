#!/usr/bin/env node
import { mkdirSync, existsSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { GrudgeExit } from "../lib/common.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const COMMANDS = `grudge ${pkg.version}

Commands:
  grudge init [--tools <csv>] [--lessons-dir <path>] [--yes] [--hooks]
  grudge lint [path] [--dir <path>] [--json]
  grudge retrieve --area <area> [--limit n] [--json] [--dir <path>]
  grudge dedup <draft.md> [--json] [--dir <path>]
  grudge compact [--json] [--dir <path>]
  grudge propose [--json] [--dir <path>]
  grudge hooks install [--type pre-push|post-commit] [--dir <git repo>]
  grudge hooks uninstall [--type pre-push|post-commit] [--dir <git repo>]
  grudge --version
  grudge help`;

const [command, ...args] = process.argv.slice(2);

try {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(COMMANDS);
    process.exit(0);
  }
  if (command === "--version" || command === "version") {
    console.log(pkg.version);
    process.exit(0);
  }
  if (command === "init") process.exit(await init(args));
  if (["lint", "retrieve", "dedup", "compact"].includes(command)) {
    const mod = await import(`../lib/lessons-${command}.mjs`);
    process.exit(mod.main(args));
  }
  if (["propose", "hooks"].includes(command)) {
    const mod = await import(`../lib/${command}.mjs`);
    process.exit(mod.main(args));
  }
  console.error(`Unknown command: ${command}\n`);
  console.log(COMMANDS);
  process.exit(2);
} catch (error) {
  if (error instanceof GrudgeExit || Number.isInteger(error.exitCode)) process.exit(error.exitCode);
  console.error(error?.stack ?? String(error));
  process.exit(1);
}

function takeOption(argv, name) {
  const idx = argv.indexOf(name);
  if (idx !== -1) return argv[idx + 1];
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : undefined;
}

function parseTools(value) {
  return [...new Set((value ?? "").split(",").map((tool) => tool.trim()).filter(Boolean))]
    .filter((tool) => ["claude", "codex", "opencode", "pi", "gjc"].includes(tool));
}

async function init(argv) {
  const yes = argv.includes("--yes");
  const installHooks = argv.includes("--hooks");
  const lessonsDir = takeOption(argv, "--lessons-dir") ?? (existsSync(resolve("docs")) ? "docs/lessons" : "lessons");
  let tools = parseTools(takeOption(argv, "--tools"));
  if (tools.length === 0 && yes) tools = detectTools();
  if (tools.length === 0) tools = await promptTools();

  const installed = [];
  const skipped = [];
  const manual = [];

  mkdirSync(".agents/skills", { recursive: true });
  copySkill("fe-design-refine", ".agents/skills/fe-design-refine", installed, skipped);
  copySkill("lessons-extract", ".agents/skills/lessons-extract", installed, skipped);

  for (const tool of tools) {
    if (tool === "claude") {
      copySkill("fe-design-refine", ".claude/skills/fe-design-refine", installed, skipped);
      copySkill("lessons-extract", ".claude/skills/lessons-extract", installed, skipped);
    } else if (tool === "opencode") {
      const base = resolveHome("~/.config/opencode/skills");
      try {
        mkdirSync(base, { recursive: true });
        copySkill("fe-design-refine", join(base, "fe-design-refine"), installed, skipped);
        copySkill("lessons-extract", join(base, "lessons-extract"), installed, skipped);
      } catch {
        manual.push("🔧 opencode: copy assets/skills/* to ~/.config/opencode/skills/.");
      }
    } else if (tool === "codex") {
      manual.push("🔧 codex: copy assets/skills/* to ~/.codex/skills/ or your Codex skills directory.");
    } else if (tool === "pi") {
      ensurePiSettings(installed);
      installPiCaptureExtension(installed, skipped);
    } else if (tool === "gjc") {
      copySkill("fe-design-refine", "docs/skills/fe-design-refine", installed, skipped);
      copySkill("lessons-extract", "docs/skills/lessons-extract", installed, skipped);
    }
  }

  const lessonsIndex = join(lessonsDir, "_index.md");
  if (!existsSync(lessonsIndex)) {
    mkdirSync(dirname(lessonsIndex), { recursive: true });
    cpSync(join(root, "assets/lessons/_index.md"), lessonsIndex);
    installed.push(lessonsIndex);
  } else {
    skipped.push(lessonsIndex);
  }

  if (installHooks) {
    const hooks = await import("../lib/hooks.mjs");
    if (existsSync(resolve(".git"))) {
      hooks.installHook(resolve("."), "pre-push", (line) => installed.push(line));
    } else {
      manual.push("🔧 hooks: skipped because this directory is not a git repo.");
    }
  } else if (!yes) {
    const shouldInstall = await promptYesNo("Install periodic report-only grudge propose hook? (pre-push) [y/N]: ");
    if (shouldInstall) {
      const hooks = await import("../lib/hooks.mjs");
      if (existsSync(resolve(".git"))) {
        hooks.installHook(resolve("."), "pre-push", (line) => installed.push(line));
      } else {
        manual.push("🔧 hooks: skipped because this directory is not a git repo.");
      }
    }
  }

  console.log("grudge init complete");
  console.log(`installed: ${installed.length ? installed.join(", ") : "none"}`);
  if (skipped.length) console.log(`skipped existing: ${skipped.join(", ")}`);
  if (tools.includes("pi")) {
    console.log(
      "pi 자동 교훈 캡처 설치됨 — 편집 있는 세션 종료 시 백그라운드로 lessons/_inbox/에 교훈 제안. 끄기: GRUDGE_NO_CAPTURE=1. (세션당 1회 LLM 실행 비용)",
    );
  }
  console.log("next: grudge lint");
  console.log("next: /skill:fe-design-refine");
  for (const line of manual) console.log(line);
  return 0;
}

function detectTools() {
  const out = [];
  if (existsSync(".claude")) out.push("claude");
  if (existsSync(resolveHome("~/.config/opencode"))) out.push("opencode");
  if (existsSync(resolveHome("~/.codex"))) out.push("codex");
  if (existsSync(".pi") || existsSync(".agents")) out.push("pi");
  if (existsSync("docs")) out.push("gjc");
  return out.length ? out : ["pi"];
}

async function promptTools() {
  const rl = createInterface({ input, output });
  const answer = await rl.question("Install harness wiring for which tools? (claude,codex,opencode,pi,gjc): ");
  rl.close();
  const parsed = parseTools(answer);
  return parsed.length ? parsed : ["pi"];
}
async function promptYesNo(question) {
  const rl = createInterface({ input, output });
  const answer = await rl.question(question);
  rl.close();
  return /^y(?:es)?$/i.test(answer.trim());
}

function copySkill(name, dest, installed, skipped) {
  if (existsSync(dest)) {
    skipped.push(dest);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(root, "assets/skills", name), dest, { recursive: true });
  installed.push(dest);
}

function installPiCaptureExtension(installed, skipped) {
  const dest = ".pi/extensions/grudge-capture/index.ts";
  if (existsSync(dest)) {
    skipped.push(dest);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(root, "assets/pi/extensions/grudge-capture/index.ts"), dest);
  installed.push(dest);
}

function ensurePiSettings(installed) {
  mkdirSync(".pi", { recursive: true });
  const settingsPath = ".pi/settings.json";
  const current = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
  const skills = Array.isArray(current.skills) ? current.skills : [];
  if (!skills.includes(".agents/skills")) skills.push(".agents/skills");
  writeFileSync(settingsPath, `${JSON.stringify({ ...current, skills }, null, 2)}\n`);
  installed.push(settingsPath);
}

function resolveHome(p) {
  return p.startsWith("~/") ? join(process.env.HOME ?? "", p.slice(2)) : p;
}
