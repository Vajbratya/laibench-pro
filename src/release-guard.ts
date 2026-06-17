#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export type ReleaseMode = "private" | "public";

export type ReleaseFile = {
  path: string;
  content?: string;
};

export type ReleaseIssue = {
  path: string;
  rule: string;
  severity: "error" | "warn";
  message: string;
};

const RAW_DATA_EXT = /\.(?:csv|tsv|xlsx?|parquet|arrow|feather|sqlite3?|db|duckdb|dcm|dicom|nii(?:\.gz)?|mha)$/i;
const PRIVATE_PATH = /(?:^|\/)(?:data\/(?:raw|private|gated|hidden|official|source|corpus)|private-data|corpus|cases\/(?:private|hidden|gated|official))(?:\/|$)/i;
const PRIVATE_NAME = /(?:laudos_clean_?65k|65k|65K|train-00000-of-|test-00000-of-|merged.*\.csv)/;
const SECRET_PATTERN = /\b(?:sk_live|sk-lf|ghp|gho|supabase_service_role)_[A-Za-z0-9_-]{12,}\b/;
const CALENDAR_DATE = /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/;
const PUBLIC_DERIVED_MARKER = /(?:Merged CSV fixture|MERGED-PTBR-|public-merged-csv|merged-csv|CSV mesclado)/i;
const PUBLIC_ANSWER_KEY = /"(?:goldFindings|criticalFindings|referenceReport|guidelineExpectations|retrievalGold)"\s*:/;

function isCaseLevelArtifact(path: string): boolean {
  return /^(?:cases\/|leaderboard\/(?:artifacts|frozen)\/|runs\/)/.test(path)
    && /\.(?:json|jsonl|csv|tsv)$/i.test(path);
}

function normPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function auditReleaseFiles(files: ReleaseFile[], mode: ReleaseMode): ReleaseIssue[] {
  const issues: ReleaseIssue[] = [];

  for (const file of files) {
    const path = normPath(file.path);
    const content = file.content ?? "";

    if (RAW_DATA_EXT.test(path)) {
      issues.push({
        path,
        rule: "raw-data-extension",
        severity: "error",
        message: "Raw tabular/imaging data files must not be tracked in this repository.",
      });
    }

    if (PRIVATE_PATH.test(path)) {
      issues.push({
        path,
        rule: mode === "public" ? "private-path-public-release" : "private-path-tracked",
        severity: mode === "public" ? "error" : "warn",
        message: mode === "public"
          ? "Private/gated data paths cannot be present in a public release."
          : "Private/gated data path is tracked; this is allowed only while the repository remains private.",
      });
    }

    if (PRIVATE_NAME.test(path)) {
      issues.push({
        path,
        rule: "private-corpus-name",
        severity: "error",
        message: "Filename matches private corpus or merged-export naming patterns.",
      });
    }

    if (SECRET_PATTERN.test(content)) {
      issues.push({
        path,
        rule: "secret-pattern",
        severity: "error",
        message: "Potential live credential found in tracked content.",
      });
    }

    if (mode === "public") {
      if (isCaseLevelArtifact(path) && PUBLIC_DERIVED_MARKER.test(content)) {
        issues.push({
          path,
          rule: "public-derived-marker",
          severity: "error",
          message: "Merged-CSV/private-derived fixture marker found in a public-release scan.",
        });
      }
      if (/^cases\/public\//.test(path) && PUBLIC_ANSWER_KEY.test(content)) {
        issues.push({
          path,
          rule: "public-answer-key",
          severity: "error",
          message: "Public case files must not expose answer keys or reference reports.",
        });
      }
      if (/^(cases|leaderboard|site)\//.test(path) && CALENDAR_DATE.test(content)) {
        issues.push({
          path,
          rule: "calendar-date-public-artifact",
          severity: "error",
          message: "Calendar dates in public artifacts can enable linkage and require manual review/redaction.",
        });
      }
    }
  }

  return issues;
}

function listFilesystemFiles(root: string, dir = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "runs" || entry.name === "predictions") continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFilesystemFiles(root, abs));
    else if (entry.isFile()) files.push(relative(root, abs));
  }
  return files;
}

function listTrackedFiles(root: string): string[] {
  const result = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim().split(/\n+/);
  return listFilesystemFiles(root);
}

function loadReleaseFiles(root: string): ReleaseFile[] {
  return listTrackedFiles(root).map((path) => {
    const abs = resolve(root, path);
    if (!existsSync(abs) || !statSync(abs).isFile()) return { path };
    const size = statSync(abs).size;
    if (size > 2_000_000 || /\.(?:pdf|zip|png|jpg|jpeg|gif|webp|mp4|mov)$/i.test(path)) return { path };
    return { path, content: readFileSync(abs, "utf8") };
  });
}

function parseCli(argv: string[]): { root: string; mode: ReleaseMode } {
  let root = process.cwd();
  let mode: ReleaseMode = "private";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") {
      root = resolve(argv[i + 1] ?? root);
      i += 1;
    } else if (argv[i] === "--mode") {
      const raw = argv[i + 1];
      if (raw !== "private" && raw !== "public") throw new Error(`Invalid --mode: ${raw}`);
      mode = raw;
      i += 1;
    }
  }
  return { root, mode };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { root, mode } = parseCli(process.argv.slice(2));
  const issues = auditReleaseFiles(loadReleaseFiles(root), mode);
  const blocking = issues.filter((issue) => issue.severity === "error");
  for (const issue of issues) {
    const prefix = issue.severity === "error" ? "ERROR" : "WARN";
    console.error(`${prefix} ${issue.path} [${issue.rule}] ${issue.message}`);
  }
  if (blocking.length > 0) {
    console.error(`release-guard: ${blocking.length} blocking issue(s) for ${mode} mode.`);
    process.exit(1);
  }
  console.log(`release-guard: ok (${mode}, ${issues.length} warning(s)).`);
}
