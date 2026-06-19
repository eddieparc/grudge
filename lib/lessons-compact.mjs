import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { splitDirArg, resolveLessonsDir, exit } from "./common.mjs";
import { basename, join, relative, resolve } from "node:path";

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), stdout = console.log, stderr = console.error } = {}) {
  
  const ROOT = cwd;
  const today = new Date().toISOString().slice(0, 10);
  const rawArgs = argv;
  const { args, dir: explicitDir } = splitDirArg(rawArgs);
  const targetRoot = resolveLessonsDir(ROOT, explicitDir);
  const jsonStdout = args.includes("--json");
  
  const outDir = join(ROOT, "artifacts/grudge/compact");
  const aggregateReferencePath = relative(ROOT, join(targetRoot, "2026/06-design-mistakes-aggregated.md")).replaceAll("\\", "/");
  
  mkdirSync(outDir, { recursive: true });
  
  const read = (p) => readFileSync(p, "utf8");
  const rel = (p) => relative(ROOT, p).replaceAll("\\", "/");
  const walk = (dir, out = []) => {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p, out);
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(p);
    }
    return out;
  };
  
  const stripQuotes = (value) => value.trim().replace(/^["']|["']$/g, "");
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
  
  const asArray = (value) => Array.isArray(value) ? value : [];
  const asString = (value) => typeof value === "string" ? value : undefined;
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
  
  const STOP_WORDS = new Set([
    "그리고", "그러나", "하지만", "있는", "없는", "한다", "했다", "때문", "같은", "다른", "이후", "전에", "에서", "으로", "에게", "까지", "부터", "보다", "처럼", "마다", "으로만", "하지", "되지", "한다면", "해야", "되면", "없음", "있음",
    "the", "and", "for", "with", "from", "that", "this", "must", "should", "lesson", "lessons", "docs", "재발", "방지", "무슨", "일이", "있었나", "일어났나", "관련", "스킬",
  ]);
  const normalizeToken = (token) => token
    .toLowerCase()
    .normalize("NFKC")
    .replace(/^[^\p{L}\p{N}_/.-]+|[^\p{L}\p{N}_/.-]+$/gu, "")
    .replace(/(으로서|으로써|에게서|에서만|으로만|부터|까지|에게|에서|으로|로서|로써|처럼|보다|마다|만큼|조차|마저|이나|거나|라도|하고|이며|였고|이고|은|는|이|가|을|를|의|에|와|과|도|만|로)$/u, "");
  const keywordWeights = (lesson) => {
    const text = [
      lesson.title,
      sectionBody(lesson.body, /무슨\s*일|왜\s*일어|재발\s*방지|회귀\s*방지|룰\s*\(재발\s*방지\)/),
    ].filter(Boolean).join("\n");
    const counts = new Map();
    for (const raw of text.match(/[\p{L}\p{N}_/.-]{2,}/gu) ?? []) {
      const token = normalizeToken(raw);
      if (!token || token.length < 2 || STOP_WORDS.has(token) || /^\d+$/.test(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    for (const area of lesson.area) counts.set(area.toLowerCase(), (counts.get(area.toLowerCase()) ?? 0) + 3);
    if (lesson.domain) counts.set(lesson.domain.toLowerCase(), (counts.get(lesson.domain.toLowerCase()) ?? 0) + 2);
    return counts;
  };
  const topKeywords = (counts, limit = 14) => [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .slice(0, limit)
    .map(([token]) => token);
  const overlap = (items) => {
    if (items.length === 0) return [];
    const sets = items.map((item) => new Set(item.keywords));
    return [...sets[0]].filter((kw) => sets.every((set) => set.has(kw))).slice(0, 10);
  };
  const unionKeywords = (items) => [...new Set(items.flatMap((item) => item.keywords))].slice(0, 18);
  const hasTraceAnchor = (body) => /AGENTS\.md|audit-checklist|checklist|§\s*\S|\[[^\]]+\]\([^)]*(?:checklist|rule|AGENTS)[^)]*\)/i.test(body);
  const traceRefs = (body) => [...new Set([
    ...(body.match(/(?:apps|packages|docs|scripts|supabase)\/[\w./()[\]-]+\.(?:md|ts|tsx|js|mjs)/g) ?? []),
    ...[...body.matchAll(/\[[^\]]+\]\(([^)#]+)[^)]*\)/g)].map((m) => m[1]).filter((ref) => /AGENTS\.md|audit|checklist|rule/i.test(ref)),
  ])];
  const backlinkPresent = (lessonPath, refs) => refs.some((ref) => {
    const abs = [resolve(ROOT, ref), resolve(ROOT, lessonPath, "..", ref)].find((p) => existsSync(p));
    if (!abs) return false;
    const text = read(abs);
    return text.includes(lessonPath) || text.includes(basename(lessonPath));
  });
  
  const mdFiles = walk(targetRoot)
    .map((p) => ({ abs: p, path: rel(p) }))
    .filter((file) => !file.path.endsWith("/_index.md"))
    .filter((file) => !file.path.includes("/meta-audits/"));
  
  const lessons = mdFiles.map((file) => {
    const text = read(file.abs);
    const { data, body } = parseFrontmatter(text);
    const title = asString(data.title) ?? body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(file.path, ".md");
    const status = asString(data.status) ?? "active";
    const area = asArray(data.area);
    const lesson = {
      path: file.path,
      title,
      status,
      classification: asString(data.classification) ?? "unknown",
      severity: asString(data.severity) ?? "unknown",
      domain: asString(data.domain),
      area,
      superseded_by: asString(data.superseded_by),
      body,
    };
    lesson.keywords = topKeywords(keywordWeights(lesson));
    return lesson;
  });
  
  const reverseEdges = new Map();
  for (const lesson of lessons) {
    if (!lesson.superseded_by) continue;
    const target = lesson.superseded_by.replace(/^\.\//, "");
    if (!reverseEdges.has(target)) reverseEdges.set(target, []);
    reverseEdges.get(target).push(lesson.path);
  }
  const reverseSupersede = [...reverseEdges.entries()].map(([parent, children]) => ({ parent, children: children.sort() }));
  
  const activeLessons = lessons.filter((lesson) => lesson.status === "active");
  const byClassArea = new Map();
  for (const lesson of activeLessons) {
    const areas = lesson.area.length > 0 ? lesson.area : ["(unassigned)"];
    for (const area of areas) {
      const key = `${lesson.classification}\u0000${area}`;
      if (!byClassArea.has(key)) byClassArea.set(key, []);
      byClassArea.get(key).push(lesson);
    }
  }
  
  const recommend = (items, commonKeywords) => {
    const count = items.length;
    const traceReady = items.filter((item) => hasTraceAnchor(item.body)).length;
    const highSeverity = items.filter((item) => item.severity === "high").length;
    if (count >= 3 && commonKeywords.length >= 2) return "aggregate-parent+supersede-children";
    if (traceReady >= 1 && (count >= 3 || highSeverity >= 1)) return "promote-to-checklist-or-skill";
    return "keep-separate";
  };
  
  const clusters = [];
  for (const [key, items] of byClassArea) {
    if (items.length < 2) continue;
    const [classification, area] = key.split("\u0000");
    const commonKeywords = overlap(items);
    const keywordUnion = unionKeywords(items);
    const recommendation = recommend(items, commonKeywords);
    const traceabilityReadiness = items.map((item) => {
      const refs = traceRefs(item.body);
      return {
        path: item.path,
        sourceLessonAnchor: item.path,
        checklistOrRuleAnchors: refs,
        backlinkPresent: refs.length > 0 ? backlinkPresent(item.path, refs) : false,
        missingBacklinks: refs.length > 0 && !backlinkPresent(item.path, refs) ? refs : [],
      };
    });
    clusters.push({
      id: `cluster-${String(clusters.length + 1).padStart(2, "0")}`,
      classification,
      area,
      normalizedKeywords: commonKeywords.length > 0 ? commonKeywords : keywordUnion.slice(0, 8),
      keywordUnion,
      recommendation,
      aggregateReference: aggregateReferencePath,
      rationale: recommendation === "aggregate-parent+supersede-children"
        ? "three-or-more active lessons share classification, area, and keyword overlap; human may create an aggregate parent following the reference shape and mark children superseded"
        : recommendation === "promote-to-checklist-or-skill"
          ? "cluster has traceable rule/checklist signals or high severity; human may promote a recurring guard instead of merging lessons"
          : "cluster is small or low-overlap; keep separate unless curator finds a stronger shared parent",
      lessons: items.map((item) => ({
        path: item.path,
        title: item.title,
        severity: item.severity,
        domain: item.domain,
        keywords: item.keywords,
      })),
      proposedParentToChildren: recommendation === "aggregate-parent+supersede-children"
        ? { parent: "<human-created aggregate lesson path>", children: items.map((item) => item.path) }
        : null,
      traceabilityReadiness,
    });
  }
  clusters.sort((a, b) => b.lessons.length - a.lessons.length || a.classification.localeCompare(b.classification) || a.area.localeCompare(b.area));
  
  const summary = {
    totalLessons: lessons.length,
    activeLessons: activeLessons.length,
    clusters: clusters.length,
    recommendations: {
      "keep-separate": clusters.filter((cluster) => cluster.recommendation === "keep-separate").length,
      "promote-to-checklist-or-skill": clusters.filter((cluster) => cluster.recommendation === "promote-to-checklist-or-skill").length,
      "aggregate-parent+supersede-children": clusters.filter((cluster) => cluster.recommendation === "aggregate-parent+supersede-children").length,
    },
    reverseSupersedeParents: reverseSupersede.length,
    reverseSupersedeChildren: reverseSupersede.reduce((sum, edge) => sum + edge.children.length, 0),
  };
  const report = {
    summary,
    generatedAt: new Date().toISOString(),
    policy: "report-only; no lesson files are modified; promotion, merge, aggregate parent creation, and supersede edits require human approval",
    aggregateReference: {
      path: aggregateReferencePath,
      purpose: "shape reference for a human-authored aggregate parent lesson",
      exists: existsSync(resolve(ROOT, aggregateReferencePath)),
    },
    reverseSupersede,
    clusters,
  };
  
  const jsonPath = join(outDir, `${today}-lessons-compact.json`);
  const mdPath = join(outDir, `${today}-lessons-compact.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const md = [
    "# lessons compact report",
    "",
    `- date: ${today}`,
    `- policy: ${report.policy}`,
    `- aggregate reference: ${aggregateReferencePath} (${report.aggregateReference.exists ? "found" : "missing"})`,
    `- total lessons: ${summary.totalLessons}`,
    `- active lessons: ${summary.activeLessons}`,
    `- clusters: ${summary.clusters}`,
    `- recommendations: keep-separate=${summary.recommendations["keep-separate"]}, promote-to-checklist-or-skill=${summary.recommendations["promote-to-checklist-or-skill"]}, aggregate-parent+supersede-children=${summary.recommendations["aggregate-parent+supersede-children"]}`,
    `- reverse supersede: parents=${summary.reverseSupersedeParents}, children=${summary.reverseSupersedeChildren}`,
    "",
    "## reverse supersede edges",
    "",
    ...(reverseSupersede.length === 0 ? ["none", ""] : reverseSupersede.flatMap((edge) => [
      `### ${edge.parent}`,
      ...edge.children.map((child) => `- ${child}`),
      "",
    ])),
    "## clusters",
    "",
    ...(clusters.length === 0 ? ["none", ""] : clusters.flatMap((cluster) => [
      `### ${cluster.id}: ${cluster.classification} + ${cluster.area}`,
      `- recommendation: ${cluster.recommendation}`,
      `- normalized keywords: ${cluster.normalizedKeywords.map((kw) => `\`${kw}\``).join(", ") || "none"}`,
      `- rationale: ${cluster.rationale}`,
      `- aggregate reference: ${cluster.aggregateReference}`,
      ...(cluster.proposedParentToChildren ? [`- proposed parent: ${cluster.proposedParentToChildren.parent}`, ...cluster.proposedParentToChildren.children.map((child) => `  - child: ${child}`)] : []),
      "- lessons:",
      ...cluster.lessons.map((lesson) => `  - ${lesson.path} — ${lesson.title}`),
      "- traceability readiness:",
      ...cluster.traceabilityReadiness.map((trace) => `  - ${trace.path}: anchors=${trace.checklistOrRuleAnchors.length}, backlink=${trace.backlinkPresent ? "yes" : "no"}${trace.missingBacklinks.length > 0 ? `, missing=${trace.missingBacklinks.join(", ")}` : ""}`),
      "",
    ])),
  ].join("\n");
  writeFileSync(mdPath, md);
  
  if (jsonStdout) stdout(JSON.stringify(report, null, 2));
  else {
    stdout(JSON.stringify(summary, null, 2));
    stdout(`artifact: artifacts/grudge/compact/${today}-lessons-compact.{json,md}`);
    stdout("lessons compact: PASS (report-only; no lesson files modified)");
  }
  
  return 0;
}
