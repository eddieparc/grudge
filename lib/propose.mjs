import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { splitDirArg, resolveLessonsDir } from "./common.mjs";

const CLASSIFICATIONS = new Set(["slop", "gap", "inefficiency", "misalignment"]);
const HIGH_SIMILARITY = 0.58;
const ARCHIVE_AGE_DAYS = 120;

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), stdout = console.log } = {}) {
  const ROOT = cwd;
  const today = new Date().toISOString().slice(0, 10);
  const { args, dir: explicitDir } = splitDirArg(argv);
  const jsonStdout = args.includes("--json");
  const targetRoot = resolveLessonsDir(ROOT, explicitDir);
  const outDir = join(ROOT, "artifacts/grudge/propose");
  mkdirSync(outDir, { recursive: true });

  const lessons = loadLessons(ROOT, targetRoot);
  const activeLessons = lessons.filter((lesson) => lesson.status === "active");
  const compactProposals = compactClusters(activeLessons);
  const lintProposals = lintAdvisories(activeLessons);
  const duplicateProposals = duplicatePairs(activeLessons);
  const archiveProposals = archiveCandidates(activeLessons);

  const rawProposals = [
    ...compactProposals,
    ...lintProposals,
    ...duplicateProposals,
    ...archiveProposals,
  ];
  const proposalMap = new Map();
  for (const proposal of rawProposals) {
    const key = `${proposal.action}\u0000${proposal.kind}\u0000${proposal.lessons.map((lesson) => lesson.path).sort().join("|")}`;
    if (!proposalMap.has(key)) proposalMap.set(key, proposal);
  }
  const proposals = [...proposalMap.values()].sort((a, b) => actionOrder(a.action) - actionOrder(b.action) || b.lessons.length - a.lessons.length || a.id.localeCompare(b.id));

  const summary = {
    totalLessons: lessons.length,
    activeLessons: activeLessons.length,
    proposals: proposals.length,
    actions: {
      merge: proposals.filter((proposal) => proposal.action === "merge").length,
      mechanize: proposals.filter((proposal) => proposal.action === "mechanize").length,
      archive: proposals.filter((proposal) => proposal.action === "archive").length,
      keep: proposals.filter((proposal) => proposal.action === "keep").length,
    },
  };
  const report = {
    generatedAt: new Date().toISOString(),
    policy: "report-only; grudge propose never edits, merges, archives, supersedes, or mechanizes lessons without human approval",
    lessonsDir: relativeOrAbsolute(ROOT, targetRoot),
    summary,
    proposals,
  };

  const jsonPath = join(outDir, `${today}-proposals.json`);
  const mdPath = join(outDir, `${today}-proposals.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, renderMarkdown(today, report));

  if (jsonStdout) stdout(JSON.stringify(report, null, 2));
  else {
    stdout(JSON.stringify(summary, null, 2));
    stdout(`artifact: artifacts/grudge/propose/${today}-proposals.{json,md}`);
    stdout("grudge propose: PASS (report-only; no lesson files modified)");
  }
  return 0;
}

function loadLessons(root, targetRoot) {
  return walk(targetRoot)
    .filter((path) => !path.endsWith("/_index.md"))
    .filter((path) => !path.includes("/meta-audits/"))
    .map((abs) => {
      const text = readFileSync(abs, "utf8");
      const { data, body } = parseFrontmatter(text);
      const path = relativeOrAbsolute(root, abs);
      const title = asString(data.title) ?? body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(path, ".md");
      const lesson = {
        path,
        title,
        status: asString(data.status) ?? "active",
        classification: asString(data.classification) ?? "unknown",
        severity: asString(data.severity) ?? "unknown",
        date: asString(data.date),
        domain: asString(data.domain),
        area: asArray(data.area),
        superseded_by: asString(data.superseded_by),
        body,
        tldr: sectionBody(body, /TL;?DR|요약/i),
      };
      lesson.tokens = tokens([lesson.title, lesson.tldr, sectionBody(body, /무슨\s*일|발생한\s*일|왜\s*일어|근본\s*원인|재발\s*방지|회귀\s*방지|룰\s*\(재발\s*방지\)/)].join("\n"));
      return lesson;
    });
}

function compactClusters(activeLessons) {
  const byKey = new Map();
  for (const lesson of activeLessons) {
    const areas = lesson.area.length > 0 ? lesson.area : ["(unassigned)"];
    for (const area of areas) {
      const key = `${lesson.classification}\u0000${area}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(lesson);
    }
  }
  const proposals = [];
  for (const [key, items] of byKey) {
    if (items.length < 2) continue;
    const [classification, area] = key.split("\u0000");
    const common = commonTokens(items).slice(0, 10);
    const action = items.length >= 3 && common.length >= 2 ? "merge" : "keep";
    proposals.push({
      id: `compact-${slug(classification)}-${slug(area)}`,
      source: "compact",
      kind: "cluster",
      action,
      title: `${classification} lessons in ${area}`,
      rationale: action === "merge"
        ? "same area+classification recurs with shared keywords; human may author an aggregate parent and mark children superseded"
        : "same area+classification exists, but evidence is not strong enough for merge or mechanization",
      signals: { classification, area, commonKeywords: common, count: items.length },
      lessons: brief(items),
    });
  }
  return proposals;
}

function lintAdvisories(activeLessons) {
  const byKey = new Map();
  for (const lesson of activeLessons) {
    if (!CLASSIFICATIONS.has(lesson.classification)) continue;
    const areas = lesson.area.length > 0 ? lesson.area : ["(unassigned)"];
    for (const area of areas) {
      const key = `${area}\u0000${lesson.classification}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(lesson);
    }
  }
  const proposals = [];
  for (const [key, items] of byKey) {
    if (items.length < 3) continue;
    const [area, classification] = key.split("\u0000");
    const grepSignals = items.flatMap((lesson) => grepableSignals(lesson.body)).slice(0, 12);
    proposals.push({
      id: `lint-${slug(area)}-${slug(classification)}`,
      source: "lint",
      kind: "recurrence-advisory",
      action: grepSignals.length > 0 ? "mechanize" : "merge",
      title: `${items.length} active ${classification} lessons share area ${area}`,
      rationale: grepSignals.length > 0
        ? "recurring prose prevention has grep-able paths/commands/tokens; human may promote to checklist or rule"
        : "recurring prose prevention should be curated before it grows further",
      signals: { area, classification, count: items.length, grepableSignals },
      lessons: brief(items),
    });
  }
  return proposals;
}

function duplicatePairs(activeLessons) {
  const proposals = [];
  for (let i = 0; i < activeLessons.length; i += 1) {
    for (let j = i + 1; j < activeLessons.length; j += 1) {
      const a = activeLessons[i];
      const b = activeLessons[j];
      const title = jaccard(tokens(a.title), tokens(b.title));
      const tl = jaccard(tokens(a.tldr), tokens(b.tldr));
      const combined = Math.max(title, tl, jaccard(a.tokens, b.tokens));
      if (combined < HIGH_SIMILARITY) continue;
      proposals.push({
        id: `dedup-${String(proposals.length + 1).padStart(3, "0")}`,
        source: "dedup",
        kind: "high-similarity-pair",
        action: "merge",
        title: `possible duplicate: ${a.title} / ${b.title}`,
        rationale: "title or TL;DR similarity is high; human should decide whether one lesson supersedes the other",
        signals: { titleScore: round(title), tldrScore: round(tl), combinedScore: round(combined), threshold: HIGH_SIMILARITY },
        lessons: brief([a, b]),
      });
    }
  }
  return proposals.sort((a, b) => b.signals.combinedScore - a.signals.combinedScore).slice(0, 30);
}

function archiveCandidates(activeLessons) {
  const now = Date.now();
  return activeLessons
    .filter((lesson) => lesson.severity === "low" && lesson.date && daysBetween(lesson.date, now) >= ARCHIVE_AGE_DAYS && grepableSignals(lesson.body).length === 0)
    .slice(0, 20)
    .map((lesson, index) => ({
      id: `archive-${String(index + 1).padStart(3, "0")}`,
      source: "curation",
      kind: "stale-low-value",
      action: "archive",
      title: `stale low-severity lesson: ${lesson.title}`,
      rationale: "low-severity active lesson is old and has no obvious mechanization signal; human may archive only after review",
      signals: { severity: lesson.severity, date: lesson.date, ageDays: daysBetween(lesson.date, now) },
      lessons: brief([lesson]),
    }));
}

function renderMarkdown(today, report) {
  return [
    "# grudge proposals",
    "",
    `- date: ${today}`,
    `- policy: ${report.policy}`,
    `- lessonsDir: ${report.lessonsDir}`,
    `- total lessons: ${report.summary.totalLessons}`,
    `- active lessons: ${report.summary.activeLessons}`,
    `- proposals: ${report.summary.proposals}`,
    `- actions: merge=${report.summary.actions.merge}, mechanize=${report.summary.actions.mechanize}, archive=${report.summary.actions.archive}, keep=${report.summary.actions.keep}`,
    "",
    "## proposals",
    "",
    ...(report.proposals.length === 0 ? ["none", ""] : report.proposals.flatMap((proposal) => [
      `### ${proposal.id}: ${proposal.title}`,
      `- action: ${proposal.action}`,
      `- source: ${proposal.source}`,
      `- kind: ${proposal.kind}`,
      `- rationale: ${proposal.rationale}`,
      `- signals: ${JSON.stringify(proposal.signals)}`,
      "- lessons:",
      ...proposal.lessons.map((lesson) => `  - ${lesson.path} — ${lesson.title}`),
      "",
    ])),
  ].join("\n");
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(path);
  }
  return out;
}

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: text };
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
    if (!kv) { currentKey = null; continue; }
    currentKey = kv[1];
    data[currentKey] = (kv[2] ?? "").trim() === "" ? [] : parseScalar(kv[2] ?? "");
  }
  return { data, body };
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    const body = value.slice(1, -1).trim();
    return body ? body.split(",").map((item) => stripQuotes(item.trim())).filter(Boolean) : [];
  }
  return stripQuotes(value);
}

function sectionBody(body, headingPattern) {
  const lines = body.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i]) && headingPattern.test(lines[i])) { start = i + 1; break; }
  }
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join("\n");
}

function grepableSignals(text) {
  return [...new Set([
    ...(text.match(/(?:apps|packages|docs|scripts|supabase|lib|bin|assets)\/[\w./()[\]-]+\.(?:md|ts|tsx|js|mjs|sql|json|yaml|yml)/g) ?? []),
    ...(text.match(/`[^`]*(?:grep|rg|node|pnpm|npm|git|checklist|AGENTS\.md)[^`]*`/gi) ?? []).map((s) => s.slice(1, -1)),
  ])];
}

function tokens(text) {
  const set = new Set();
  for (const raw of (text ?? "").normalize("NFKC").toLowerCase().split(/[\s/|,，·:;!?()[\]{}<>"'`*_~]+/u)) {
    const token = raw.replace(/^[^\p{L}\p{N}_/.-]+|[^\p{L}\p{N}_/.-]+$/gu, "").replace(/(으로서|으로써|에게서|에서는|에서만|부터|까지|에게|에서|으로|처럼|보다|마다|은|는|이|가|을|를|의|에|와|과|도|만|로)$/u, "");
    if (token.length >= 2 && !STOPWORDS.has(token) && !/^\d+$/.test(token)) set.add(token);
  }
  return set;
}

const STOPWORDS = new Set(["그리고", "그러나", "하지만", "관련", "이번", "해당", "있는", "없는", "해야", "하면", "레슨", "교훈", "요약", "문제", "작업", "검증", "lesson", "lessons", "active", "medium", "high", "low", "gap", "slop", "misalignment", "inefficiency", "the", "and", "for", "with", "from", "that", "this"]);

function commonTokens(items) {
  if (items.length === 0) return [];
  const first = items[0].tokens;
  return [...first].filter((token) => items.every((item) => item.tokens.has(token)));
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / new Set([...a, ...b]).size;
}
function brief(items) {
  return items.map((lesson) => ({ path: lesson.path, title: lesson.title, severity: lesson.severity, date: lesson.date, area: lesson.area, classification: lesson.classification }));
}
function asString(value) { return typeof value === "string" ? value : undefined; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function stripQuotes(value) { return value.trim().replace(/^["']|["']$/g, ""); }
function slug(value) { return String(value).toLowerCase().replace(/[^a-z0-9가-힣_.-]+/giu, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "unknown"; }
function actionOrder(action) { return { merge: 0, mechanize: 1, archive: 2, keep: 3 }[action] ?? 9; }
function relativeOrAbsolute(root, path) { return resolve(path).startsWith(resolve(root)) ? relative(root, path).replaceAll("\\", "/") : path; }
function round(value) { return Number(value.toFixed(3)); }
function daysBetween(date, now) { const ms = now - Date.parse(`${date}T00:00:00Z`); return Number.isFinite(ms) ? Math.floor(ms / 86400000) : 0; }
