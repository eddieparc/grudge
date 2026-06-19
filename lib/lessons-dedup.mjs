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
  const optionValue = (name) => {
    const index = args.indexOf(name);
    if (index !== -1) return args[index + 1];
    const prefix = `${name}=`;
    const inline = args.find((arg) => arg.startsWith(prefix));
    return inline ? inline.slice(prefix.length) : undefined;
  };
  const optionNamesWithValues = new Set(["--blocking", "--advisory"]);
  const draftArg = (() => {
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === "--json") continue;
      if (optionNamesWithValues.has(arg)) {
        i += 1;
        continue;
      }
      if (arg.startsWith("--blocking=") || arg.startsWith("--advisory=")) continue;
      if (!arg.startsWith("--")) return arg;
    }
    return undefined;
  })();
  const blockingThreshold = numberOption("--blocking", 0.6);
  const advisoryThreshold = numberOption("--advisory", 0.3);
  
  if (!draftArg) {
    stderr("usage: grudge dedup <draft.md> [--dir <path>] [--json] [--blocking 0.6] [--advisory 0.3]");
    exit(2);
  }
  if (advisoryThreshold >= blockingThreshold) {
    stderr("--advisory must be lower than --blocking");
    exit(2);
  }
  
  const outDir = join(ROOT, "artifacts/grudge/dedup");
  mkdirSync(outDir, { recursive: true });
  
  const draftPath = resolve(ROOT, draftArg);
  if (!existsSync(draftPath)) {
    stderr(`draft not found: ${draftArg}`);
    exit(2);
  }
  
  const read = (path) => readFileSync(path, "utf8");
  const rel = (path) => path.startsWith(ROOT) ? relative(ROOT, path).replaceAll("\\", "/") : path;
  const walk = (dir, out = []) => {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, out);
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(path);
    }
    return out;
  };
  
  function numberOption(name, fallback) {
    const value = Number(optionValue(name));
    return Number.isFinite(value) ? value : fallback;
  }
  
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
  
  const titleFrom = ({ data, body }, path) => {
    if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
    const h1 = body.match(/^#\s+(.+)$/m);
    if (h1) return h1[1].replace(/[`*_]/g, "").trim();
    return basename(path, ".md").replace(/^\d+-/, "").replaceAll("-", " ");
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
  const comparableText = (body) => [
    sectionBody(body, /TL;?DR|요약/i),
    sectionBody(body, /무슨\s*일|발생한\s*일|무엇/),
    sectionBody(body, /왜\s*일어|근본\s*원인|원인/),
    sectionBody(body, /재발\s*방지|회귀\s*방지|룰\s*\(재발\s*방지\)/),
  ].filter(Boolean).join("\n");
  
  const KOREAN_PARTICLES = /(으로서|으로써|에서는|에게서|한테서|부터|까지|처럼|보다|으로|에서|에게|한테|께서|께|은|는|이|가|을|를|와|과|도|만|로|에|의)$/;
  const STOPWORDS = new Set([
    "그리고", "그러나", "하지만", "또는", "또한", "이번", "해당", "관련", "기반", "통해", "대한", "위한", "있는", "없는", "해야", "하면", "문제", "작업", "검증", "에이전트", "디자인", "레슨", "lesson", "lessons", "status", "active", "medium", "high", "low", "gap", "slop", "misalignment", "inefficiency",
  ]);
  const normalizeToken = (raw) => {
    let token = raw.toLowerCase().normalize("NFKC")
      .replace(/^[^\p{L}\p{N}_/.-]+|[^\p{L}\p{N}_/.-]+$/gu, "")
      .replace(KOREAN_PARTICLES, "");
    if (/^[a-z0-9_.-]+$/i.test(token)) return token.length >= 3 ? token : "";
    token = token.replace(/[.,:;!?()[\]{}"'`*_~]/g, "");
    if (token.length < 2) return "";
    if (STOPWORDS.has(token)) return "";
    return token;
  };
  const tokens = (text) => {
    const set = new Set();
    for (const raw of text.replace(/([가-힣])([A-Za-z0-9])/g, "$1 $2").replace(/([A-Za-z0-9])([가-힣])/g, "$1 $2").split(/[\s/|,，·:;!?()[\]{}<>"'`*_~]+/u)) {
      const token = normalizeToken(raw);
      if (token) set.add(token);
    }
    return set;
  };
  const exactKey = (text) => [...tokens(text)].join(" ");
  const intersectionSize = (a, b) => {
    let count = 0;
    for (const item of a) if (b.has(item)) count += 1;
    return count;
  };
  const jaccard = (a, b) => {
    const intersection = intersectionSize(a, b);
    const union = new Set([...a, ...b]).size;
    return union === 0 ? 0 : intersection / union;
  };
  const containment = (a, b) => {
    const smaller = Math.min(a.size, b.size);
    if (smaller === 0) return 0;
    return intersectionSize(a, b) / smaller;
  };
  const titleScore = (aTitle, bTitle) => {
    const aKey = exactKey(aTitle);
    const bKey = exactKey(bTitle);
    if (aKey && aKey === bKey) return 1;
    const a = tokens(aTitle);
    const b = tokens(bTitle);
    if (Math.min(a.size, b.size) < 2) return 0;
    return jaccard(a, b);
  };
  const keywordScore = (aText, bText) => {
    const a = tokens(aText);
    const b = tokens(bText);
    if (Math.min(a.size, b.size) < 4) return 0;
    const contain = containment(a, b);
    const jac = jaccard(a, b);
    return Math.max(jac, contain * 0.75);
  };
  const bandFor = (score) => score >= blockingThreshold ? "blocking" : score >= advisoryThreshold ? "advisory" : "clear";
  
  const loadLesson = (path) => {
    const parsed = parseFrontmatter(read(path));
    return {
      path: rel(path),
      abs: path,
      frontmatter: parsed.data,
      body: parsed.body,
      title: titleFrom(parsed, path),
      comparableText: comparableText(parsed.body),
    };
  };
  
  const draft = loadLesson(draftPath);
  const lessonPaths = walk(targetRoot)
    .filter((path) => !path.endsWith("/_index.md"))
    .filter((path) => resolve(path) !== draftPath);
  const activeLessons = lessonPaths.map(loadLesson).filter((lesson) => (lesson.frontmatter.status ?? "active") === "active");
  
  const candidates = activeLessons.map((lesson) => {
    const ts = titleScore(draft.title, lesson.title);
    const ks = keywordScore(draft.comparableText, lesson.comparableText);
    const finalScore = Math.max(ts, ks, (ts * 0.55) + (ks * 0.45));
    const band = bandFor(finalScore);
    const overlap = [...tokens(draft.comparableText)].filter((token) => tokens(lesson.comparableText).has(token)).slice(0, 20);
    return {
      path: lesson.path,
      title: lesson.title,
      comparedFields: ["title", "TL;DR", "무슨 일이 있었나/발생한 일", "왜 일어났나/근본 원인", "재발 방지"],
      titleScore: Number(ts.toFixed(3)),
      keywordScore: Number(ks.toFixed(3)),
      finalScore: Number(finalScore.toFixed(3)),
      band,
      overlappingKeywords: overlap,
      rationale: band === "blocking"
        ? "blocking threshold met; reinforce the existing lesson unless a reviewer records why this is a genuinely new branch"
        : band === "advisory"
          ? "advisory threshold met; reviewer should check duplicate risk before landing"
          : "below advisory threshold",
    };
  }).sort((a, b) => b.finalScore - a.finalScore || b.titleScore - a.titleScore);
  
  const blocking = candidates.filter((candidate) => candidate.band === "blocking");
  const advisory = candidates.filter((candidate) => candidate.band === "advisory");
  const recommendation = blocking.length > 0
    ? "BLOCK: choose existing lesson reinforcement or document why a new lesson branch is required."
    : advisory.length > 0
      ? "ADVISORY: review similar lessons before landing this draft."
      : "PASS: no duplicate candidate reached the advisory band.";
  const summary = {
    draft: rel(draftPath),
    activeCompared: activeLessons.length,
    blockingCandidates: blocking.length,
    advisoryCandidates: advisory.length,
    thresholds: { advisory: advisoryThreshold, blocking: blockingThreshold },
    exitCode: blocking.length > 0 ? 1 : 0,
    recommendation,
  };
  const report = {
    summary,
    draft: { path: rel(draftPath), title: draft.title },
    candidates: candidates.filter((candidate) => candidate.band !== "clear").slice(0, 20),
    topClearCandidates: candidates.filter((candidate) => candidate.band === "clear").slice(0, 5),
  };
  
  const safeStem = basename(draftArg, ".md").replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 48) || "draft";
  const jsonPath = join(outDir, `${today}-lessons-dedup-${safeStem}.json`);
  const mdPath = join(outDir, `${today}-lessons-dedup-${safeStem}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const md = [
    "# lessons dedup report",
    "",
    `- date: ${today}`,
    `- draft: ${summary.draft}`,
    `- activeCompared: ${summary.activeCompared}`,
    `- thresholds: advisory=${advisoryThreshold}, blocking=${blockingThreshold}`,
    `- blockingCandidates: ${summary.blockingCandidates}`,
    `- advisoryCandidates: ${summary.advisoryCandidates}`,
    `- recommendation: ${recommendation}`,
    "",
    "## candidates",
    "",
    ...(report.candidates.length === 0 ? ["No blocking or advisory candidates.", ""] : report.candidates.flatMap((candidate) => [
      `### ${candidate.path}`,
      `- title: ${candidate.title}`,
      `- band: ${candidate.band}`,
      `- titleScore: ${candidate.titleScore}`,
      `- keywordScore: ${candidate.keywordScore}`,
      `- finalScore: ${candidate.finalScore}`,
      `- expectedAction: ${candidate.band === "blocking" ? "existing reinforcement vs new lesson branch decision required" : "review before landing"}`,
      `- rationale: ${candidate.rationale}`,
      `- overlappingKeywords: ${candidate.overlappingKeywords.length ? candidate.overlappingKeywords.join(", ") : "none"}`,
      "",
    ])),
  ].join("\n");
  writeFileSync(mdPath, md);
  
  if (jsonStdout) stdout(JSON.stringify(report, null, 2));
  else {
    stdout(JSON.stringify(summary, null, 2));
    stdout(`artifact: artifacts/grudge/dedup/${today}-lessons-dedup-${safeStem}.{json,md}`);
    if (blocking.length > 0) stdout("lessons dedup: BLOCK — choose existing lesson reinforcement vs new lesson branch rationale before landing.");
    else if (advisory.length > 0) stdout("lessons dedup: ADVISORY — similar lessons found; exit 0.");
    else stdout("lessons dedup: PASS — no duplicate candidate reached advisory band.");
  }
  exit(summary.exitCode);
  
  return 0;
}
