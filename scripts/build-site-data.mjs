#!/usr/bin/env node
// Build site/data.js from run artifacts.
//
// Leaderboard policy: product agents rank first; raw/free models and harness
// baseline fixtures are shown as separate comparison/calibration sections.
//
// Usage: node scripts/build-site-data.mjs --out site/data.js \
//          --board pt-BR runs/a.json runs/b.json \
//          --board en-US runs/c.json \
//          [--reliability pt-BR runs/reliability.json]

import { readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const boards = {};
const reliability = {};
let outPath = "site/data.js";

for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--out") {
    outPath = argv[++i];
  } else if (argv[i] === "--board") {
    const locale = argv[++i];
    const files = [];
    while (argv[i + 1] && !argv[i + 1].startsWith("--")) files.push(argv[++i]);
    boards[locale] = files;
  } else if (argv[i] === "--reliability") {
    const locale = argv[++i];
    reliability[locale] = argv[++i];
  }
}

function entryFromRun(run) {
  const s = run.summary;
  const m = run.manifest;
  const criterion = criterionStats(run);
  const allPassRate = s.allPassRate ?? criterion.allPassRate;
  const criterionPassRate = s.criterionPassRate ?? criterion.criterionPassRate;
  const clinicalScore = s.averageOverall ?? 0;
  const isFixture = (m.systemType || "") === "mini-agent" || /baseline|fixture|mock/i.test(m.entityName || "");
  const isModel = (m.systemType || "") === "raw-model" || (m.entityType || "") === "model" || (m.track || "") === "model";
  return {
    system: m.entityName || m.modelLabel || m.runName,
    kind: isFixture ? "Harness fixture" : isModel ? "Free/open model" : (m.systemType || "agent"),
    group: isFixture ? "calibration" : isModel ? "model" : "production",
    score: clinicalScore / 100,
    allPass: allPassRate / 100,
    criterionPass: criterionPassRate / 100,
    clinicalScore: clinicalScore / 100,
    strictPass: (s.strictPassRate ?? 0) / 100,
    dims: {
      CRIT: (s.averagePerDim.CRIT ?? null) === null ? null : s.averagePerDim.CRIT / 100,
      QUAL: (s.averagePerDim.QUAL ?? null) === null ? null : s.averagePerDim.QUAL / 100,
      TERM: (s.averagePerDim.TERM ?? null) === null ? null : s.averagePerDim.TERM / 100,
      GUIDE: (s.averagePerDim.GUIDE ?? null) === null ? null : s.averagePerDim.GUIDE / 100,
      RAG: (s.averagePerDim.RAG ?? null) === null ? null : s.averagePerDim.RAG / 100,
    },
    latencyMs: s.averageLatencyMs ?? null,
    track: m.track,
    suiteHash: m.suiteHash,
  };
}

function criterionStats(run) {
  const results = Array.isArray(run.results) ? run.results : [];
  let allPassCount = 0;
  let criteriaPassed = 0;
  let criteriaTotal = 0;

  for (const result of results) {
    const checks = Array.isArray(result.checks) ? result.checks : [];
    const passed = checks.filter((check) => check && check.passed === true).length;
    if (checks.length > 0 && passed === checks.length) allPassCount += 1;
    criteriaPassed += passed;
    criteriaTotal += checks.length;
  }

  return {
    allPassRate: results.length > 0 ? Math.round((allPassCount / results.length) * 1000) / 10 : 0,
    criterionPassRate: criteriaTotal > 0 ? Math.round((criteriaPassed / criteriaTotal) * 1000) / 10 : 0,
    allPassCount,
    criteriaPassed,
    criteriaTotal,
  };
}

const data = { generatedAt: null, locales: {} };

for (const [locale, files] of Object.entries(boards)) {
  const runs = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
  // Rank within group; production agents first, then free/open model
  // comparisons, then calibration fixtures.
  // Public score is the weighted clinical score. All-pass completion is an
  // intentionally harsh diagnostic, not the headline grade for the CSV suite.
  const all = runs.map(entryFromRun);
  const byGroup = (g) => all.filter((e) => e.group === g).sort((a, b) =>
    (b.clinicalScore - a.clinicalScore) ||
    (b.criterionPass - a.criterionPass) ||
    (b.allPass - a.allPass)
  );
  const entries = [...byGroup("production"), ...byGroup("model"), ...byGroup("calibration")];
  const first = runs[0];
  let rel = null;
  let relRuns = 0;
  if (reliability[locale]) {
    const r = JSON.parse(readFileSync(reliability[locale], "utf8"));
    // Headline reliability = critical-safe pass^k (the safety-critical metric).
    rel = r.passPowerKCriticalSafe ?? r.summary?.passPowerKCriticalSafe ?? null;
    if (rel != null && rel > 1) rel /= 100;
    relRuns = r.k ?? r.summary?.k ?? 0;
  }
  data.locales[locale] = {
    suite: first.manifest.suiteId,
    suiteHash: first.manifest.suiteHash,
    cases: first.results.length,
    track: first.manifest.track,
    scoring: first.manifest.scoreMode,
    entries,
    reliability: rel,
    reliabilityRuns: relRuns,
    note:
      "Controlled benchmark preview. Production agents are ranked separately from free/open model comparisons and calibration fixtures. The public board excludes case JSON, answer keys, frozen predictions and corpus provenance. " +
      "The pt-BR controlled suite is gated and must not be treated as an open-download benchmark. Score is weighted clinical fidelity score. Strict all-pass means zero-failure cases: every criterion in a case passes simultaneously, and any critical failure forces FAIL instead of being averaged into PASS. Runs are reproducible only inside the controlled adjudication environment. " +
      "<a href=\"#methods\">Methods</a>.",
  };
}

writeFileSync(outPath, "window.LAIBENCH_DATA = " + JSON.stringify(data, null, 1) + ";\n");
console.log(`Wrote ${outPath}`);
