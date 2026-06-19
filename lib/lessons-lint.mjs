import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { splitDirArg, resolveLessonsDir, exit } from "./common.mjs";
import { join, relative, resolve } from "node:path";

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), stdout = console.log, stderr = console.error } = {}) {
  
  const ROOT = cwd;
  const today = new Date().toISOString().slice(0, 10);
  const rawArgs = argv;
  const { args, dir: explicitDir } = splitDirArg(rawArgs);
  const targetRoot = resolveLessonsDir(ROOT, explicitDir);
  const jsonStdout = args.includes("--json");
  const targetArg = args.find((arg) => arg !== "--json");
  const effectiveTargetRoot = targetArg ? resolve(ROOT, targetArg) : targetRoot;
  const outDir = join(ROOT, "artifacts/grudge/lint");
  mkdirSync(outDir, { recursive: true });
  
  const read = (p) => readFileSync(p, "utf8");
  const rel = (p) => relative(ROOT, p).replaceAll("\\", "/");
  const walk = (dir, out = []) => {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p, out);
      else if (name.isFile() && name.name.endsWith(".md")) out.push(p);
    }
    return out;
  };
  
  const CLASSIFICATIONS = new Set(["slop", "gap", "inefficiency", "misalignment"]);
  const SEVERITIES = new Set(["low", "medium", "high"]);
  const STATUSES = new Set(["active", "mechanized", "promoted", "superseded"]);
  const TRACEABLE_STATUSES = new Set(["mechanized", "promoted"]);
  
  const stripQuotes = (value) => value.trim().replace(/^['"]|['"]$/g, "");
  const parseScalar = (raw) => {
    const value = raw.trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      const body = value.slice(1, -1).trim();
      if (!body) return [];
      return body.split(",").map((item) => stripQuotes(item.trim())).filter(Boolean);
    }
    return stripQuotes(value);
  };
  
  const parseFrontmatter = (text) => {
    if (!text.startsWith("---\n")) return { data: {}, body: text, hasFrontmatter: false };
    const end = text.indexOf("\n---", 4);
    if (end === -1) return { data: {}, body: text, hasFrontmatter: false };
    const block = text.slice(4, end);
    const body = text.slice(end + 4).replace(/^\n/, "");
    const data = {};
    let currentKey = null;
    for (const line of block.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const list = line.match(/^\s+-\s*(.+)$/);
      if (list && currentKey) {
        if (!Array.isArray(data[currentKey])) data[currentKey] = [];
        data[currentKey].push(stripQuotes(list[1]));
        continue;
      }
      const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
      if (!kv) {
        currentKey = null;
        continue;
      }
      currentKey = kv[1];
      const raw = kv[2] ?? "";
      data[currentKey] = raw.trim() === "" ? [] : parseScalar(raw);
    }
    return { data, body, hasFrontmatter: true };
  };
  
  const asArray = (value) => Array.isArray(value) ? value : undefined;
  const asString = (value) => typeof value === "string" ? value : undefined;
  const hasConcreteSignal = (text) => {
    if (!text.trim()) return false;
    return /`[^`]+`/.test(text)
      || /\[[^\]]+\]\([^\)]+\)/.test(text)
      || /(?:^|\s)(?:apps|packages|docs|scripts|supabase|artifacts)\/[\w./()[\]-]+/m.test(text)
      || /(?:^|\s)(?:node|pnpm|npm|bun|git|grep|rg|find|curl|psql|sqlite3|supabase|tsc|drizzle-kit)\s+[^\n]+/m.test(text)
      || /[A-Za-z0-9_$.-]+\.(?:ts|tsx|js|mjs|md|sql|json|toml|yaml|yml)\b/.test(text);
  };
  const sectionBody = (body, headingPattern) => {
    const lines = body.split(/\r?\n/);
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (/^##\s+/.test(lines[i]) && headingPattern.test(lines[i])) {
        start = i + 1;
        break;
      }
    }
    if (start === -1) return "";
    let end = lines.length;
    for (let i = start; i < lines.length; i += 1) {
      if (/^##\s+/.test(lines[i])) {
        end = i;
        break;
      }
    }
    return lines.slice(start, end).join("\n");
  };
  const extractAreaSuggestions = (body) => {
    const suggestions = new Set();
    for (const m of body.matchAll(/\b(?:apps|packages|docs|scripts|supabase)\/[\w./()[\]-]+/g)) {
      const parts = m[0].split("/");
      suggestions.add(parts.slice(0, Math.min(parts.length, 4)).join("/"));
    }
    for (const m of body.matchAll(/`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)`/g)) {
      if (!m[1].includes(".")) suggestions.add(m[1]);
    }
    for (const m of body.matchAll(/^#{1,3}\s+(.+)$/gm)) {
      const heading = m[1].replace(/[`*_]/g, "").trim();
      if (heading && heading.length <= 60) suggestions.add(heading);
    }
    return [...suggestions].slice(0, 12);
  };
  const traceLooksRelevant = (s) => /AGENTS\.md|audit-checklist|checklist|rule/i.test(s);
  const TRACE_REF_RE = /(?:apps|packages|docs|scripts|supabase)\/[\w./()[\]-]+\.(?:md|ts|tsx|js|mjs)/g;
  const checkTraceability = (file, body) => {
    const hasAnchor = /AGENTS\.md/.test(body)
      || /audit-checklist/i.test(body)
      || /\bchecklist\b/i.test(body)
      || /§\s*\S/.test(body)
      || /\[[^\]]+\]\([^)]*(?:checklist|rule|AGENTS)[^)]*\)/i.test(body);
    if (!hasAnchor) return "mechanized/promoted lesson body needs a checklist/rule/AGENTS anchor";
    const refs = new Set();
    for (const m of body.matchAll(TRACE_REF_RE)) if (traceLooksRelevant(m[0])) refs.add(m[0]);
    for (const m of body.matchAll(/\[[^\]]+\]\(([^)#]+)[^)]*\)/g)) if (traceLooksRelevant(m[1])) refs.add(m[1]);
    if (refs.size === 0) return "mechanized/promoted anchor must reference a resolvable checklist/rule file path";
    const lessonRel = file.path;
    const lessonBase = lessonRel.split("/").pop();
    let resolved = false;
    for (const ref of refs) {
      const abs = [resolve(ROOT, ref), resolve(file.abs, "..", ref)].find((p) => existsSync(p));
      if (!abs) continue;
      resolved = true;
      const targetText = read(abs);
      if (targetText.includes(lessonRel) || targetText.includes(lessonBase)) return null;
    }
    return resolved
      ? "mechanized/promoted target must cite the source lesson path (bidirectional backlink missing)"
      : "mechanized/promoted anchor target file not found";
  };
  
  const mdFiles = walk(effectiveTargetRoot)
    .map((p) => ({ abs: p, path: rel(p) }))
    .filter((f) => !f.path.endsWith("/_index.md"))
    .filter((f) => !f.path.includes("/meta-audits/"));
  
  const files = [];
  const compaction = new Map();
  for (const file of mdFiles) {
    const text = read(file.abs);
    const { data, body, hasFrontmatter } = parseFrontmatter(text);
    const errors = [];
    const advisories = [];
    const status = asString(data.status) ?? "active";
    const active = status === "active" || data.status === undefined;
  
    if (!hasFrontmatter) errors.push("missing frontmatter block");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asString(data.date) ?? "")) errors.push("date must be YYYY-MM-DD");
    if (!CLASSIFICATIONS.has(asString(data.classification) ?? "")) errors.push("classification must be one of slop, gap, inefficiency, misalignment");
    if (!SEVERITIES.has(asString(data.severity) ?? "")) errors.push("severity must be one of low, medium, high");
    if (!STATUSES.has(status)) errors.push("status must be one of active, mechanized, promoted, superseded");
    if (data.domain !== undefined && typeof data.domain !== "string") errors.push("domain must be a string when present");
    if (data.area !== undefined && !asArray(data.area)) errors.push("area must be an array when present");
    if (data.related_skills !== undefined && !asArray(data.related_skills)) errors.push("related_skills must be an array when present");
    if (data.superseded_by !== undefined && typeof data.superseded_by !== "string") errors.push("superseded_by must be a string when present");
  
    if (status === "superseded") {
      const target = asString(data.superseded_by);
      if (!target) errors.push("superseded lesson requires a superseded_by pointer");
      else if (![resolve(ROOT, target), resolve(file.abs, "..", target)].some((p) => existsSync(p))) {
        errors.push(`superseded_by target not found: ${target}`);
      }
    }
  
    if (active && !hasConcreteSignal(sectionBody(body, /재발\s*방지|회귀\s*방지|룰\s*\(재발\s*방지\)/))) {
      errors.push("active lesson recurrence-prevention section needs at least one concrete signal");
    }
    if (TRACEABLE_STATUSES.has(status)) {
      const traceErr = checkTraceability(file, body);
      if (traceErr) errors.push(traceErr);
    }
    if (file.path.includes("/archive/")) advisories.push("archive lesson is advisory-only");
  
    const area = asArray(data.area);
    const areaSuggestions = active && !area ? extractAreaSuggestions(body) : [];
    if (areaSuggestions.length > 0) advisories.push("area candidates available; confirm manually before recording");
    if (active && area && CLASSIFICATIONS.has(asString(data.classification) ?? "")) {
      for (const a of area) {
        const key = `${a}\u0000${data.classification}`;
        if (!compaction.has(key)) compaction.set(key, []);
        compaction.get(key).push(file.path);
      }
    }
    if (file.path.includes("/archive/") && errors.length > 0) {
      advisories.push(...errors.map((e) => `non-gating (archive): ${e}`));
      errors.length = 0;
    }
    files.push({ path: file.path, status, errors, advisories, areaSuggestions });
  }
  
  for (const [key, paths] of compaction) {
    if (paths.length < 3) continue;
    const [area, classification] = key.split("\u0000");
    for (const f of files) {
      if (paths.includes(f.path)) f.advisories.push(`compaction candidate: ${paths.length} active lessons share area=${area} classification=${classification}`);
    }
  }
  
  const summary = {
    total: files.length,
    active: files.filter((f) => f.status === "active").length,
    errors: files.reduce((sum, f) => sum + f.errors.length, 0),
    advisories: files.reduce((sum, f) => sum + f.advisories.length + f.areaSuggestions.length, 0),
  };
  const report = { summary, files };
  const jsonPath = join(outDir, `${today}-lessons-lint.json`);
  const mdPath = join(outDir, `${today}-lessons-lint.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const md = [
    "# lessons lint report",
    "",
    `- date: ${today}`,
    `- total: ${summary.total}`,
    `- active: ${summary.active}`,
    `- errors: ${summary.errors}`,
    `- advisories: ${summary.advisories}`,
    "",
    "## files",
    "",
    ...files.flatMap((f) => [
      `### ${f.path}`,
      `- status: ${f.status}`,
      `- errors: ${f.errors.length === 0 ? "none" : f.errors.join("; ")}`,
      `- advisories: ${f.advisories.length === 0 ? "none" : f.advisories.join("; ")}`,
      `- areaSuggestions: ${f.areaSuggestions.length === 0 ? "none" : f.areaSuggestions.map((s) => `\`${s}\``).join(", ")}`,
      "",
    ]),
  ].join("\n");
  writeFileSync(mdPath, md);
  
  if (jsonStdout) stdout(JSON.stringify(report, null, 2));
  else {
    stdout(JSON.stringify(summary, null, 2));
    stdout(`artifact: artifacts/grudge/lint/${today}-lessons-lint.{json,md}`);
  }
  if (summary.errors > 0) {
    if (!jsonStdout) stdout(`lessons lint: FAIL (active errors ${summary.errors})`);
    exit(1);
  }
  if (!jsonStdout) stdout("lessons lint: PASS (active lessons schema clean; advisory tracked separately)");
  
  return 0;
}
