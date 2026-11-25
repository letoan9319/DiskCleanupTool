#!/usr/bin/env node
/**
 * DiskCleanupTool Automated Audit Aggregator & Rust Code Hygiene Scanner.
 *
 * Parses:
 *   1. `cargo audit --json` output
 *   2. `npm audit --json` output
 *   3. `cargo clippy --workspace --all-targets --message-format=json` NDJSON output
 *   4. Static Rust code hygiene scan across `crates/<crate>/src/**` and `src-tauri/src/**`
 *      (excluding test modules/functions) for risky `.unwrap()` calls and `FIXME`/`TODO` markers.
 *
 * Produces `audit-report.md` and `audit-summary.json`.
 * Supports `--dry-run` for clean local verification without mutating the repository.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const MAX_ITEMS_PER_SECTION = 50;

function parseArgs(argv) {
  const opts = {
    cargoAudit: "audit-tmp/cargo-audit.json",
    npmAudit: "audit-tmp/npm-audit.json",
    clippy: "audit-tmp/clippy.json",
    outMd: "audit-report.md",
    outJson: "audit-summary.json",
    outMdExplicit: false,
    outJsonExplicit: false,
    dryRun: false,
    rootDir: process.cwd(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--cargo-audit" && argv[i + 1]) {
      opts.cargoAudit = argv[++i];
    } else if (arg === "--npm-audit" && argv[i + 1]) {
      opts.npmAudit = argv[++i];
    } else if (arg === "--clippy" && argv[i + 1]) {
      opts.clippy = argv[++i];
    } else if (arg === "--out-md" && argv[i + 1]) {
      opts.outMd = argv[++i];
      opts.outMdExplicit = true;
    } else if (arg === "--out-json" && argv[i + 1]) {
      opts.outJson = argv[++i];
      opts.outJsonExplicit = true;
    } else if (arg === "--root" && argv[i + 1]) {
      opts.rootDir = path.resolve(argv[++i]);
    }
  }
  return opts;
}

function readTextIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  return raw.replace(/^\uFEFF/, "").trim();
}

function extractJsonObject(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parseCargoAudit(filePath) {
  const raw = readTextIfExists(filePath);
  if (raw === null) {
    return { status: "skipped", vulnerabilities: [], warnings: [], note: "Input file not provided" };
  }
  const data = extractJsonObject(raw);
  if (!data) {
    return { status: "error", vulnerabilities: [], warnings: [], note: "Unable to parse cargo audit JSON" };
  }

  const vulnerabilities = [];
  const vulnList = Array.isArray(data?.vulnerabilities?.list) ? data.vulnerabilities.list : [];
  for (const item of vulnList) {
    const adv = item.advisory || {};
    const pkg = item.package || {};
    vulnerabilities.push({
      id: adv.id || "UNKNOWN",
      package: pkg.name || adv.package || "unknown",
      version: pkg.version || "?",
      title: adv.title || "Vulnerability reported",
      url: adv.url || "",
      cvss: adv.cvss || null,
      patched: Array.isArray(item.versions?.patched) ? item.versions.patched : [],
    });
  }

  const warnings = [];
  const warningGroups = data?.warnings && typeof data.warnings === "object" ? data.warnings : {};
  for (const [kind, list] of Object.entries(warningGroups)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const pkg = item.package || {};
      const adv = item.advisory || {};
      warnings.push({
        kind: item.kind || kind,
        id: adv.id || kind.toUpperCase(),
        package: pkg.name || adv.package || "unknown",
        version: pkg.version || "?",
        title: adv.title || `${kind} crate warning`,
        url: adv.url || "",
      });
    }
  }

  vulnerabilities.sort((a, b) => `${a.id}:${a.package}`.localeCompare(`${b.id}:${b.package}`));
  warnings.sort((a, b) => `${a.kind}:${a.package}:${a.id}`.localeCompare(`${b.kind}:${b.package}:${b.id}`));

  return { status: "ok", vulnerabilities, warnings, note: null };
}

function parseNpmAudit(filePath) {
  const raw = readTextIfExists(filePath);
  if (raw === null) {
    return { status: "skipped", vulnerabilities: [], highCriticalCount: 0, note: "Input file not provided" };
  }
  const data = extractJsonObject(raw);
  if (!data) {
    return { status: "error", vulnerabilities: [], highCriticalCount: 0, note: "Unable to parse npm audit JSON" };
  }

  const severityOrder = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  const vulnerabilities = [];

  if (data.vulnerabilities && typeof data.vulnerabilities === "object") {
    for (const [name, info] of Object.entries(data.vulnerabilities)) {
      if (!info || typeof info !== "object") continue;
      const severity = String(info.severity || "info").toLowerCase();
      const viaTitles = [];
      const viaUrls = [];
      if (Array.isArray(info.via)) {
        for (const entry of info.via) {
          if (typeof entry === "string") {
            viaTitles.push(entry);
          } else if (entry && typeof entry === "object") {
            if (entry.title) viaTitles.push(entry.title);
            if (entry.url) viaUrls.push(entry.url);
          }
        }
      }
      vulnerabilities.push({
        package: info.name || name,
        severity,
        range: info.range || "*",
        isDirect: Boolean(info.isDirect),
        fixAvailable: Boolean(info.fixAvailable),
        summary: viaTitles.length > 0 ? [...new Set(viaTitles)].join("; ") : "Transitive advisory",
        url: viaUrls[0] || "",
      });
    }
  }

  vulnerabilities.sort((a, b) => {
    const sa = severityOrder[a.severity] ?? 99;
    const sb = severityOrder[b.severity] ?? 99;
    if (sa !== sb) return sa - sb;
    return a.package.localeCompare(b.package);
  });

  const highCriticalCount = vulnerabilities.filter(
    (v) => v.severity === "critical" || v.severity === "high"
  ).length;

  return { status: "ok", vulnerabilities, highCriticalCount, note: null };
}

function parseClippy(filePath, rootDir) {
  const raw = readTextIfExists(filePath);
  if (raw === null) {
    return { status: "skipped", errors: [], warnings: [], note: "Input file not provided" };
  }

  const errors = [];
  const warnings = [];
  const seen = new Set();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (obj.reason !== "compiler-message" || !obj.message) continue;
    const msg = obj.message;
    const level = msg.level;
    if (level !== "warning" && level !== "error") continue;

    const spans = Array.isArray(msg.spans) ? msg.spans : [];
    const primarySpan = spans.find((s) => s.is_primary) || spans[0];
    const code = msg.code?.code || null;

    // Skip summary messages such as "3 warnings emitted"
    if (!primarySpan && !code) continue;

    const rawFile = primarySpan?.file_name || "";
    const normFile = rawFile
      ? toPosix(path.isAbsolute(rawFile) ? path.relative(rootDir, rawFile) : rawFile)
      : "(unknown)";
    const lineStart = primarySpan?.line_start || 0;
    const text = String(msg.message || "").trim();
    const dedupKey = `${level}|${code || ""}|${normFile}|${lineStart}|${text}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const entry = {
      level,
      code: code || "rustc",
      file: normFile,
      line: lineStart,
      message: text,
    };

    if (level === "error") errors.push(entry);
    else warnings.push(entry);
  }

  const sortFn = (a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || a.code.localeCompare(b.code);
  errors.sort(sortFn);
  warnings.sort(sortFn);

  return { status: "ok", errors, warnings, note: null };
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function collectRustSourceFiles(rootDir) {
  const roots = [];
  const cratesDir = path.join(rootDir, "crates");
  if (fs.existsSync(cratesDir)) {
    for (const entry of fs.readdirSync(cratesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const srcDir = path.join(cratesDir, entry.name, "src");
        if (fs.existsSync(srcDir)) roots.push(srcDir);
      }
    }
  }
  const tauriSrc = path.join(rootDir, "src-tauri", "src");
  if (fs.existsSync(tauriSrc)) {
    roots.push(tauriSrc);
  }

  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "tests" || entry.name === "target") continue;
        walk(full);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".rs") &&
        entry.name !== "tests.rs" &&
        !entry.name.endsWith("_test.rs")
      ) {
        files.push(full);
      }
    }
  }

  for (const r of roots) walk(r);
  files.sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
  return files;
}

/**
 * Splits a Rust source line into code-only text (with strings & comments masked)
 * and comment-only text, tracking multi-line block comment nesting across lines.
 */
function splitRustLine(line, blockCommentDepth) {
  let code = "";
  let comments = "";
  let i = 0;
  let inString = false;
  let depth = blockCommentDepth;

  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];

    if (depth > 0) {
      if (ch === "/" && next === "*") {
        depth += 1;
        comments += "/*";
        i += 2;
        continue;
      }
      if (ch === "*" && next === "/") {
        depth -= 1;
        comments += "*/";
        i += 2;
        continue;
      }
      comments += ch;
      i += 1;
      continue;
    }

    if (inString) {
      if (ch === "\\" && i + 1 < line.length) {
        code += "  ";
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      code += " ";
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      comments += line.slice(i);
      break;
    }

    if (ch === "/" && next === "*") {
      depth += 1;
      comments += "/*";
      i += 2;
      continue;
    }

    if (ch === '"') {
      inString = true;
      code += " ";
      i += 1;
      continue;
    }

    code += ch;
    i += 1;
  }

  return { code, comments, blockCommentDepth: depth };
}

function countBraces(code) {
  let open = 0;
  let close = 0;
  for (const ch of code) {
    if (ch === "{") open += 1;
    else if (ch === "}") close += 1;
  }
  return { open, close };
}

function scanRustHygiene(rootDir) {
  const files = collectRustSourceFiles(rootDir);
  const unwraps = [];
  const markers = [];

  for (const filePath of files) {
    const relPath = toPosix(path.relative(rootDir, filePath));
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

    let blockCommentDepth = 0;
    let braceDepth = 0;
    let pendingTestItem = false;
    let skipUntilBraceDepth = null;

    for (let idx = 0; idx < lines.length; idx += 1) {
      const lineNo = idx + 1;
      const rawLine = lines[idx];
      const { code, comments, blockCommentDepth: nextDepth } = splitRustLine(
        rawLine,
        blockCommentDepth
      );
      blockCommentDepth = nextDepth;

      const trimmedCode = code.trim();
      const { open, close } = countBraces(code);

      // Track #[cfg(test)] and #[test] regions to exclude test code
      if (skipUntilBraceDepth === null) {
        if (/^\#\[\s*cfg\s*\(\s*test\s*\)\s*\]/.test(trimmedCode) || /^\#\[\s*test\s*\]/.test(trimmedCode)) {
          pendingTestItem = true;
        }
      }

      const inTestBefore = skipUntilBraceDepth !== null;
      if (pendingTestItem && skipUntilBraceDepth === null) {
        if (open > 0) {
          skipUntilBraceDepth = braceDepth;
          pendingTestItem = false;
        } else if (trimmedCode.endsWith(";")) {
          // Single-line item like `#[cfg(test)] mod tests;`
          pendingTestItem = false;
        }
      }

      const isTestLine = inTestBefore || skipUntilBraceDepth !== null;
      braceDepth += open - close;

      if (skipUntilBraceDepth !== null && braceDepth <= skipUntilBraceDepth) {
        skipUntilBraceDepth = null;
      }

      if (isTestLine) continue;

      // 1. Check for risky `.unwrap()` in non-test production code
      if (
        /\.unwrap\s*\(\s*\)/.test(code) &&
        !/audit-ok|SAFETY:/i.test(comments)
      ) {
        unwraps.push({
          file: relPath,
          line: lineNo,
          snippet: rawLine.trim().slice(0, 140),
        });
      }

      // 2. Check for TODO / FIXME markers in comments
      const markerMatch = comments.match(/\b(FIXME|TODO)\b/i);
      if (markerMatch) {
        markers.push({
          tag: markerMatch[1].toUpperCase(),
          file: relPath,
          line: lineNo,
          snippet: rawLine.trim().slice(0, 140),
        });
      }
    }
  }

  return {
    status: "ok",
    scannedFiles: files.length,
    unwraps,
    markers,
  };
}

function escapeMd(text) {
  return String(text || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function buildMarkdownReport(summary) {
  const { counts, findings, sources, commitSha, generatedAt, runUrl, fingerprint, totalFindings } =
    summary;

  const lines = [];
  lines.push(`<!-- audit-bot-fingerprint: ${fingerprint} -->`);
  lines.push(`# Automated Audit Report — DiskCleanupTool`);
  lines.push("");
  lines.push(
    totalFindings === 0
      ? "> **Status: PASS** — No security, lint, or code hygiene findings detected."
      : `> **Status: ${totalFindings} finding(s) detected** across automated security, lint, and Rust hygiene checks.`
  );
  lines.push("");
  lines.push("| Check | Status | Findings |");
  lines.push("| :--- | :---: | ---: |");
  lines.push(
    `| Cargo Audit (Vulnerabilities / Warnings) | \`${sources.cargoAudit}\` | ${counts.cargoAuditVulnerabilities} vuln / ${counts.cargoAuditWarnings} warn |`
  );
  lines.push(
    `| npm Audit | \`${sources.npmAudit}\` | ${counts.npmAuditTotal} (${counts.npmAuditHighCritical} high/critical) |`
  );
  lines.push(
    `| Cargo Clippy (Workspace) | \`${sources.clippy}\` | ${counts.clippyErrors} error / ${counts.clippyWarnings} warn |`
  );
  lines.push(
    `| Rust Hygiene (\`.unwrap()\` / \`TODO\`-\`FIXME\`) | \`${sources.hygiene}\` (${sources.scannedRustFiles} files) | ${counts.hygieneUnwrap} unwrap / ${counts.hygieneTodoFixme} marker |`
  );
  lines.push("");

  // Section 1: Cargo Audit
  const cargoCount = findings.cargoAuditVulnerabilities.length + findings.cargoAuditWarnings.length;
  if (cargoCount > 0) {
    lines.push(`<details open>`);
    lines.push(`<summary><strong>1. Cargo Audit (${cargoCount})</strong></summary>`);
    lines.push("");
    if (findings.cargoAuditVulnerabilities.length > 0) {
      lines.push("| Advisory | Crate | Version | Title | Patched |");
      lines.push("| :--- | :--- | :--- | :--- | :--- |");
      for (const v of findings.cargoAuditVulnerabilities.slice(0, MAX_ITEMS_PER_SECTION)) {
        const idLink = v.url ? `[${v.id}](${v.url})` : v.id;
        lines.push(
          `| ${idLink} | \`${escapeMd(v.package)}\` | \`${escapeMd(v.version)}\` | ${escapeMd(v.title)} | \`${escapeMd(v.patched.join(", ") || "none")}\` |`
        );
      }
      if (findings.cargoAuditVulnerabilities.length > MAX_ITEMS_PER_SECTION) {
        lines.push(
          `\n_...and ${findings.cargoAuditVulnerabilities.length - MAX_ITEMS_PER_SECTION} more vulnerability item(s)._`
        );
      }
      lines.push("");
    }
    if (findings.cargoAuditWarnings.length > 0) {
      lines.push("| Kind | Crate | Version | Advisory | Title |");
      lines.push("| :--- | :--- | :--- | :--- | :--- |");
      for (const w of findings.cargoAuditWarnings.slice(0, MAX_ITEMS_PER_SECTION)) {
        const idLink = w.url ? `[${w.id}](${w.url})` : w.id;
        lines.push(
          `| \`${escapeMd(w.kind)}\` | \`${escapeMd(w.package)}\` | \`${escapeMd(w.version)}\` | ${idLink} | ${escapeMd(w.title)} |`
        );
      }
      if (findings.cargoAuditWarnings.length > MAX_ITEMS_PER_SECTION) {
        lines.push(
          `\n_...and ${findings.cargoAuditWarnings.length - MAX_ITEMS_PER_SECTION} more warning(s)._`
        );
      }
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  // Section 2: npm Audit
  if (findings.npmAudit.length > 0) {
    lines.push(`<details open>`);
    lines.push(`<summary><strong>2. npm Audit (${findings.npmAudit.length})</strong></summary>`);
    lines.push("");
    lines.push("| Severity | Package | Direct | Fix Available | Details |");
    lines.push("| :--- | :--- | :---: | :---: | :--- |");
    for (const v of findings.npmAudit.slice(0, MAX_ITEMS_PER_SECTION)) {
      const detail = v.url ? `[${escapeMd(v.summary)}](${v.url})` : escapeMd(v.summary);
      lines.push(
        `| \`${v.severity}\` | \`${escapeMd(v.package)}\` | ${v.isDirect ? "Yes" : "No"} | ${v.fixAvailable ? "Yes" : "No"} | ${detail} |`
      );
    }
    if (findings.npmAudit.length > MAX_ITEMS_PER_SECTION) {
      lines.push(`\n_...and ${findings.npmAudit.length - MAX_ITEMS_PER_SECTION} more package(s)._`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  // Section 3: Cargo Clippy
  const clippyItems = [...findings.clippyErrors, ...findings.clippyWarnings];
  if (clippyItems.length > 0) {
    lines.push(`<details>`);
    lines.push(`<summary><strong>3. Cargo Clippy (${clippyItems.length})</strong></summary>`);
    lines.push("");
    lines.push("| Level | Code | Location | Message |");
    lines.push("| :--- | :--- | :--- | :--- |");
    for (const item of clippyItems.slice(0, MAX_ITEMS_PER_SECTION)) {
      lines.push(
        `| \`${item.level}\` | \`${escapeMd(item.code)}\` | \`${escapeMd(item.file)}:${item.line}\` | ${escapeMd(item.message)} |`
      );
    }
    if (clippyItems.length > MAX_ITEMS_PER_SECTION) {
      lines.push(`\n_...and ${clippyItems.length - MAX_ITEMS_PER_SECTION} more diagnostic(s)._`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  // Section 4: Rust Code Hygiene
  const hygieneCount = findings.hygieneUnwrap.length + findings.hygieneTodoFixme.length;
  if (hygieneCount > 0) {
    lines.push(`<details>`);
    lines.push(`<summary><strong>4. Rust Code Hygiene (${hygieneCount})</strong></summary>`);
    lines.push("");
    if (findings.hygieneUnwrap.length > 0) {
      lines.push(`#### Risky \`.unwrap()\` calls (${findings.hygieneUnwrap.length})`);
      lines.push("");
      lines.push("| Location | Snippet |");
      lines.push("| :--- | :--- |");
      for (const u of findings.hygieneUnwrap.slice(0, MAX_ITEMS_PER_SECTION)) {
        lines.push(`| \`${escapeMd(u.file)}:${u.line}\` | \`${escapeMd(u.snippet)}\` |`);
      }
      if (findings.hygieneUnwrap.length > MAX_ITEMS_PER_SECTION) {
        lines.push(
          `\n_...and ${findings.hygieneUnwrap.length - MAX_ITEMS_PER_SECTION} more \`.unwrap()\` call(s)._`
        );
      }
      lines.push("");
    }
    if (findings.hygieneTodoFixme.length > 0) {
      lines.push(`#### \`FIXME\` / \`TODO\` markers (${findings.hygieneTodoFixme.length})`);
      lines.push("");
      lines.push("| Tag | Location | Snippet |");
      lines.push("| :--- | :--- | :--- |");
      for (const m of findings.hygieneTodoFixme.slice(0, MAX_ITEMS_PER_SECTION)) {
        lines.push(`| \`${m.tag}\` | \`${escapeMd(m.file)}:${m.line}\` | \`${escapeMd(m.snippet)}\` |`);
      }
      if (findings.hygieneTodoFixme.length > MAX_ITEMS_PER_SECTION) {
        lines.push(
          `\n_...and ${findings.hygieneTodoFixme.length - MAX_ITEMS_PER_SECTION} more marker(s)._`
        );
      }
      lines.push("");
    }
    lines.push("</details>");
    lines.push("");
  }

  lines.push("---");
  const metaParts = [`Commit: \`${commitSha || "local"}\``, `Generated: \`${generatedAt}\``];
  if (runUrl) metaParts.push(`[Workflow Run](${runUrl})`);
  lines.push(`_${metaParts.join(" · ")}_`);
  lines.push("");

  return lines.join("\n");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const cargoAudit = parseCargoAudit(path.resolve(opts.rootDir, opts.cargoAudit));
  const npmAudit = parseNpmAudit(path.resolve(opts.rootDir, opts.npmAudit));
  const clippy = parseClippy(path.resolve(opts.rootDir, opts.clippy), opts.rootDir);
  const hygiene = scanRustHygiene(opts.rootDir);

  const counts = {
    cargoAuditVulnerabilities: cargoAudit.vulnerabilities.length,
    cargoAuditWarnings: cargoAudit.warnings.length,
    npmAuditTotal: npmAudit.vulnerabilities.length,
    npmAuditHighCritical: npmAudit.highCriticalCount,
    clippyErrors: clippy.errors.length,
    clippyWarnings: clippy.warnings.length,
    hygieneUnwrap: hygiene.unwraps.length,
    hygieneTodoFixme: hygiene.markers.length,
  };

  const totalFindings =
    counts.cargoAuditVulnerabilities +
    counts.cargoAuditWarnings +
    counts.npmAuditTotal +
    counts.clippyErrors +
    counts.clippyWarnings +
    counts.hygieneUnwrap +
    counts.hygieneTodoFixme;

  const findings = {
    cargoAuditVulnerabilities: cargoAudit.vulnerabilities,
    cargoAuditWarnings: cargoAudit.warnings,
    npmAudit: npmAudit.vulnerabilities,
    clippyErrors: clippy.errors,
    clippyWarnings: clippy.warnings,
    hygieneUnwrap: hygiene.unwraps,
    hygieneTodoFixme: hygiene.markers,
  };

  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(findings))
    .digest("hex")
    .slice(0, 16);

  const serverUrl = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const runUrl = serverUrl && repo && runId ? `${serverUrl}/${repo}/actions/runs/${runId}` : null;

  const summary = {
    generatedAt: new Date().toISOString(),
    commitSha: process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 12) : "local",
    runUrl,
    fingerprint,
    totalFindings,
    counts,
    sources: {
      cargoAudit: cargoAudit.status,
      npmAudit: npmAudit.status,
      clippy: clippy.status,
      hygiene: hygiene.status,
      scannedRustFiles: hygiene.scannedFiles,
    },
    findings,
  };

  const reportMd = buildMarkdownReport(summary);

  if (opts.dryRun) {
    if (opts.outMdExplicit) {
      fs.writeFileSync(path.resolve(opts.rootDir, opts.outMd), reportMd, "utf8");
    }
    if (opts.outJsonExplicit) {
      fs.writeFileSync(
        path.resolve(opts.rootDir, opts.outJson),
        `${JSON.stringify(summary, null, 2)}\n`,
        "utf8"
      );
    }
    console.log("[audit-bot] Dry-run completed cleanly.");
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          fingerprint: summary.fingerprint,
          totalFindings: summary.totalFindings,
          sources: summary.sources,
          counts: summary.counts,
          reportBytes: Buffer.byteLength(reportMd, "utf8"),
        },
        null,
        2
      )
    );
    return;
  }

  fs.writeFileSync(path.resolve(opts.rootDir, opts.outMd), reportMd, "utf8");
  fs.writeFileSync(
    path.resolve(opts.rootDir, opts.outJson),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  );
  console.log(
    `[audit-bot] Wrote ${opts.outMd} and ${opts.outJson} (${totalFindings} total finding(s), fingerprint ${fingerprint}).`
  );
}

main();
