import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const localBin = join(packageRoot, "bin/grudge.mjs");
const BEGIN = "# >>> grudge propose hook >>>";
const END = "# <<< grudge propose hook <<<";
const VALID_TYPES = new Set(["pre-push", "post-commit"]);

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), stdout = console.log, stderr = console.error } = {}) {
  const [action, ...rest] = argv;
  if (!action || !["install", "uninstall"].includes(action)) {
    stderr("usage: grudge hooks install|uninstall [--type pre-push|post-commit] [--dir <git repo>]");
    return 2;
  }
  const type = option(rest, "--type") ?? "pre-push";
  if (!VALID_TYPES.has(type)) {
    stderr("--type must be pre-push or post-commit");
    return 2;
  }
  const repo = resolve(cwd, option(rest, "--dir") ?? ".");
  const gitDir = join(repo, ".git");
  if (!existsSync(gitDir)) {
    stderr(`not a git repo: ${repo}`);
    return 2;
  }
  return action === "install" ? installHook(repo, type, stdout) : uninstallHook(repo, type, stdout);
}

export function installHook(repo, type = "pre-push", stdout = console.log) {
  const hookDir = join(repo, ".git/hooks");
  const hookPath = join(hookDir, type);
  mkdirSync(hookDir, { recursive: true });
  const current = existsSync(hookPath) ? readFileSync(hookPath, "utf8") : "#!/bin/sh\n";
  if (current.includes(BEGIN) && current.includes(END)) {
    stdout(`grudge hook already installed: .git/hooks/${type}`);
  } else {
    const prefix = current.startsWith("#!") ? current.replace(/\s*$/u, "\n\n") : `#!/bin/sh\n${current ? `${current.replace(/\s*$/u, "\n\n")}` : ""}`;
    writeFileSync(hookPath, `${prefix}${hookBlock()}\n`);
    stdout(`installed grudge hook: .git/hooks/${type}`);
  }
  chmodSync(hookPath, 0o755);
  if (existsSync(join(repo, ".husky"))) {
    stdout(`husky detected: add or mirror the grudge block in .husky/${type} if Husky owns this hook path`);
  }
  return 0;
}

export function uninstallHook(repo, type = "pre-push", stdout = console.log) {
  const hookPath = join(repo, ".git/hooks", type);
  if (!existsSync(hookPath)) {
    stdout(`grudge hook not installed: .git/hooks/${type}`);
    return 0;
  }
  const current = readFileSync(hookPath, "utf8");
  const next = removeBlock(current);
  if (next === current) {
    stdout(`grudge hook block not found: .git/hooks/${type}`);
    return 0;
  }
  writeFileSync(hookPath, next.replace(/\n{3,}/g, "\n\n"));
  chmodSync(hookPath, 0o755);
  stdout(`removed grudge hook block: .git/hooks/${type}`);
  return 0;
}

function hookBlock() {
  return `${BEGIN}
# Report-only curation suggestions. Never block commit/push.
if command -v node >/dev/null 2>&1 && [ -f "${escapeShell(localBin)}" ]; then
  node "${escapeShell(localBin)}" propose || true
elif command -v grudge >/dev/null 2>&1; then
  grudge propose || true
elif command -v npx >/dev/null 2>&1; then
  npx --yes grudge propose || true
else
  echo "grudge: command not found; skipping report-only proposals"
fi
exit 0
${END}`;
}

function removeBlock(text) {
  const pattern = new RegExp(`${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}\\n?`, "g");
  return text.replace(pattern, "");
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index !== -1) return argv[index + 1];
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : undefined;
}
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escapeShell(value) { return value.replace(/"/g, "\\\""); }
