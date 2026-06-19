import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { splitDirArg, resolveLessonsDir, exit } from "./common.mjs";
import { join, relative } from "node:path";

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), stdout = console.log, stderr = console.error } = {}) {
  
  const ROOT = cwd;
  const today = new Date().toISOString().slice(0, 10);
  const outDir = join(ROOT, "artifacts/grudge/retrieve");
  mkdirSync(outDir, { recursive: true });
  
  const rawArgs = argv;
  const { args, dir: explicitDir } = splitDirArg(rawArgs);
  const targetRoot = resolveLessonsDir(ROOT, explicitDir);
  const requestedAreas = [];
  let limit = 10;
  let jsonStdout = false;
  
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") {
      jsonStdout = true;
    } else if (arg === "--area") {
      const value = args[i + 1];
      if (!value) fail("--area requires a value");
      requestedAreas.push(...splitAreas(value));
      i += 1;
    } else if (arg.startsWith("--area=")) {
      requestedAreas.push(...splitAreas(arg.slice("--area=".length)));
    } else if (arg === "--limit") {
      const value = Number.parseInt(args[i + 1] ?? "", 10);
      if (!Number.isFinite(value) || value < 1) fail("--limit requires a positive integer");
      limit = value;
      i += 1;
    } else if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.slice("--limit=".length), 10);
      if (!Number.isFinite(value) || value < 1) fail("--limit requires a positive integer");
      limit = value;
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  
  if (requestedAreas.length === 0) fail("at least one --area is required");
  
  const areaQueries = unique(requestedAreas.map(normalizeArea).filter(Boolean));
  const lessons = lessonFiles(targetRoot)
    .map(readLesson)
    .filter(Boolean);
  
  const statusCounters = lessons.reduce((acc, lesson) => {
    acc[lesson.status] = (acc[lesson.status] ?? 0) + 1;
    return acc;
  }, {});
  
  const ranked = lessons
    .filter((lesson) => lesson.status === "active")
    .map((lesson) => ({ lesson, score: scoreLesson(lesson, areaQueries) }))
    .filter((entry) => entry.score.matched)
    .sort(compareRanked)
    .slice(0, limit);
  
  const digest = {
    requestedAreas: areaQueries,
    injectedCount: ranked.length,
    generatedAt: new Date().toISOString(),
    statusCounters,
    lessons: ranked.map(({ lesson, score }) => ({
      path: lesson.path,
      title: lesson.title,
      classification: lesson.classification,
      severity: lesson.severity,
      area: lesson.area,
      date: lesson.date,
      score: score.total,
      match: score.match,
      summary: lesson.summary,
      recurrenceGuard: lesson.recurrenceGuard,
      relatedRuleLinks: lesson.relatedRuleLinks,
      traceabilityAnchors: lesson.traceabilityAnchors,
    })),
  };
  
  const logPath = join(outDir, `${today}-lessons-retrieve.json`);
  writeFileSync(logPath, JSON.stringify({
    requestedAreas: areaQueries,
    injectedCount: ranked.length,
    statusCounters,
    returnedPaths: ranked.map(({ lesson }) => lesson.path),
    lessons: ranked.map(({ lesson, score }) => ({ path: lesson.path, score: score.total })),
  }, null, 2));
  
  if (jsonStdout) {
    stdout(JSON.stringify(digest, null, 2));
  } else {
    stdout(formatDigest(digest));
  }
  
  function fail(message) {
    stderr(`lessons-retrieve: ${message}`);
    exit(2);
  }
  
  function splitAreas(value) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  
  function unique(items) {
    return [...new Set(items)];
  }
  
  function read(path) {
    return readFileSync(path, "utf8");
  }
  
  function rel(path) {
    return relative(ROOT, path).replaceAll("\\", "/");
  }
  
  function lessonFiles(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) lessonFiles(path, out);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        const r = rel(path);
        if (!r.endsWith("/_index.md") && !r.includes("/meta-audits/")) out.push(path);
      }
    }
    return out;
  }
  
  function stripQuotes(value) {
    return value.trim().replace(/^['"]|['"]$/g, "");
  }
  
  function parseScalar(raw) {
    const value = raw.trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      const body = value.slice(1, -1).trim();
      if (!body) return [];
      return body.split(",").map((item) => stripQuotes(item.trim())).filter(Boolean);
    }
    return stripQuotes(value);
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
      if (!kv) {
        currentKey = null;
        continue;
      }
      currentKey = kv[1];
      const raw = kv[2] ?? "";
      data[currentKey] = raw.trim() === "" ? [] : parseScalar(raw);
    }
    return { data, body };
  }
  
  function asArray(value) {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === "string" && value.trim()) return [value.trim()];
    return [];
  }
  
  function asString(value) {
    return typeof value === "string" ? value : "";
  }
  
  function readLesson(abs) {
    const text = read(abs);
    const { data, body } = parseFrontmatter(text);
    const path = rel(abs);
    const title = asString(data.title) || firstHeading(body) || titleFromPath(path);
    return {
      path,
      title,
      date: asString(data.date) || asString(data.revised),
      status: asString(data.status) || "active",
      classification: asString(data.classification),
      severity: asString(data.severity),
      area: asArray(data.area),
      body,
      summary: extractSummary(body),
      recurrenceGuard: firstNonEmptyLine(sectionBody(body, /재발\s*방지|회귀\s*방지|룰\s*\(재발\s*방지\)/)),
      relatedRuleLinks: extractRuleLinks(body),
      traceabilityAnchors: extractTraceabilityAnchors(data, body),
    };
  }
  
  function firstHeading(body) {
    return body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  }
  
  function titleFromPath(path) {
    return path.split("/").pop().replace(/\.md$/, "");
  }
  
  function sectionBody(body, headingPattern) {
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
  }
  
  function extractSummary(body) {
    const tldr = firstParagraph(sectionBody(body, /TL;DR|요약/));
    if (tldr) return tldr;
    return firstParagraph(body.replace(/^#.*$/gm, ""));
  }
  
  function firstParagraph(text) {
    return text.split(/\n\s*\n/)
      .map((part) => part.replace(/\n+/g, " ").trim())
      .find((part) => part && !part.startsWith("|") && !part.startsWith("---")) ?? "";
  }
  
  function firstNonEmptyLine(text) {
    return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  }
  
  function extractRuleLinks(body) {
    const links = [];
    for (const m of body.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
      const target = m[2];
      if (/AGENTS\.md|checklist|rule|design-system-audit/i.test(target) || /룰|규칙|checklist|AGENTS/i.test(m[1])) {
        links.push({ label: m[1], target });
      }
    }
    for (const m of body.matchAll(/(?:apps|packages|docs|scripts|supabase)\/[\w./()[\]-]+(?:AGENTS\.md|checklist[\w.-]*\.md|[\w.-]*rule[\w.-]*\.md)(?:#[\w.-]+)?/gi)) {
      links.push({ label: m[0], target: m[0] });
    }
    return uniqueBy(links, (link) => `${link.label}\u0000${link.target}`).slice(0, 8);
  }
  
  function extractTraceabilityAnchors(data, body) {
    const anchors = [];
    for (const parent of asArray(data.parents)) {
      if (/AGENTS\.md|checklist|rule/i.test(parent)) anchors.push(parent);
    }
    for (const link of extractRuleLinks(body)) anchors.push(link.target);
    return unique(anchors).slice(0, 8);
  }
  
  function uniqueBy(items, keyFn) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
      const key = keyFn(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }
  
  function normalizeArea(value) {
    return value.trim().replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase();
  }
  
  function tokenize(value) {
    return unique(normalizeArea(value)
      .split(/[^\p{L}\p{N}_$-]+/u)
      .flatMap((part) => part.split(/[-_]/))
      .map((part) => part.trim())
      .filter((part) => part.length >= 2));
  }
  function meaningfulTokens(value) {
    const rootAreaTokens = new Set(["apps", "app", "packages", "package", "docs", "doc", "scripts", "script", "supabase"]);
    return tokenize(value).filter((token) => !rootAreaTokens.has(token));
  }
  
  
  function pathPrefixes(value) {
    const parts = normalizeArea(value).split("/").filter(Boolean);
    const prefixes = [];
    for (let i = 1; i <= parts.length; i += 1) prefixes.push(parts.slice(0, i).join("/"));
    return prefixes;
  }
  
  function scoreLesson(lesson, queries) {
    const lessonAreas = lesson.area.map(normalizeArea);
    const titleTokens = tokenize(lesson.title);
    const pathTokens = tokenize(lesson.path);
    const lessonAreaTokens = lessonAreas.flatMap(tokenize);
    let exact = 0;
    let pathOverlap = 0;
    let titleOverlap = 0;
    const matches = [];
  
    for (const query of queries) {
      const queryTokens = tokenize(query);
      const queryMeaningfulTokens = meaningfulTokens(query);
      const prefixes = pathPrefixes(query);
      if (lessonAreas.some((area) => area === query)) {
        exact += 1;
        matches.push(`${query}:exact`);
      }
      const hasPathOverlap = lessonAreas.some((area) => prefixes.includes(area) || pathPrefixes(area).includes(query))
        || queryMeaningfulTokens.some((token) => lessonAreaTokens.includes(token) || pathTokens.includes(token));
      if (hasPathOverlap) {
        pathOverlap += 1;
        if (!matches.some((match) => match.startsWith(`${query}:exact`))) matches.push(`${query}:path-token`);
      }
      const hasTitleOverlap = queryTokens.some((token) => titleTokens.includes(token));
      if (hasTitleOverlap) {
        titleOverlap += 1;
        if (!matches.some((match) => match.startsWith(`${query}:`))) matches.push(`${query}:title-token`);
      }
    }
  
    const severity = severityWeight(lesson.severity);
    const recency = dateWeight(lesson.date);
    const total = (exact * 1000) + (pathOverlap * 100) + (titleOverlap * 20) + recency + severity;
    return { total, exact, pathOverlap, titleOverlap, recency, severity, matched: matches.length > 0, match: matches };
  }
  
  function severityWeight(severity) {
    return { high: 3, medium: 2, low: 1 }[severity] ?? 0;
  }
  
  function dateWeight(date) {
    const parsed = Date.parse(date);
    if (Number.isNaN(parsed)) return 0;
    return Math.floor(parsed / 86_400_000) / 100_000;
  }
  
  function compareRanked(a, b) {
    return b.score.total - a.score.total
      || b.score.exact - a.score.exact
      || b.score.pathOverlap - a.score.pathOverlap
      || b.score.titleOverlap - a.score.titleOverlap
      || Date.parse(b.lesson.date) - Date.parse(a.lesson.date)
      || severityWeight(b.lesson.severity) - severityWeight(a.lesson.severity)
      || a.lesson.path.localeCompare(b.lesson.path);
  }
  
  function formatDigest(digest) {
    const lines = [
      `lessons retrieve — ${digest.requestedAreas.join(", ")}`,
      `injected: ${digest.injectedCount}`,
      `status: ${Object.entries(digest.statusCounters).map(([k, v]) => `${k}=${v}`).join(", ")}`,
      "",
    ];
    for (const lesson of digest.lessons) {
      lines.push(`## ${lesson.title}`);
      lines.push(`- path: ${lesson.path}`);
      lines.push(`- classification: ${lesson.classification}`);
      lines.push(`- severity: ${lesson.severity}`);
      lines.push(`- area: ${lesson.area.length ? lesson.area.join(", ") : "none"}`);
      lines.push(`- score: ${lesson.score}`);
      if (lesson.summary) lines.push(`- summary: ${lesson.summary}`);
      if (lesson.recurrenceGuard) lines.push(`- recurrence guard: ${lesson.recurrenceGuard}`);
      if (lesson.relatedRuleLinks.length) {
        lines.push(`- related rules: ${lesson.relatedRuleLinks.map((link) => `${link.label} (${link.target})`).join("; ")}`);
      }
      if (lesson.traceabilityAnchors.length) lines.push(`- traceability: ${lesson.traceabilityAnchors.join("; ")}`);
      lines.push("");
    }
    return lines.join("\n").trimEnd();
  }
  
  return 0;
}
