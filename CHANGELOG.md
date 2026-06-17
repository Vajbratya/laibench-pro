# Changelog

## v3.1.0 — LAIBench Pro — judge-scale safety fix (affects scores)

CLI contract and run-artifact JSON schema remain backward compatible (no field
renamed or removed). This bump changes scores for one specific case, so it is a
minor version bump and `benchmarkVersion` moves to `3.1.0` on the lite-public
suites. The provenance `scoringHash` changes automatically because `scoring.ts`
changed.

### Fixed (correctness — affects scores)
- **Judge score-scale inflation (safety direction).** `combineScores` used a
  per-value rule (`value <= 5 ? value * 20`) to auto-detect a 0-5 Likert score
  versus a 0-100 score. The judge contract requests 0-100, so a genuinely
  catastrophic dimension (for example `CRIT = 3` out of 100) fell into the `<= 5`
  branch and was multiplied into a passing `60`, with a hard discontinuity at the
  5/6 boundary. That inflated the worst reports, which is the unsafe failure
  direction for a safety benchmark. Scale is now decided once at the RESULT
  level: a result is read as Likert only when EVERY emitted dimension score is
  `<= 5`. A low score sitting next to normal scores is now read as a genuine
  0-100 low score. The 0-5 Likert convention used by calibration fixtures is
  preserved (a result whose dimensions are all `<= 5` still scales by 20).
  Residual limit, documented inline: a fully catastrophic 0-100 result whose
  every dimension is `<= 5` is still treated as Likert because it cannot be
  distinguished without an explicit scale; conservative-min and the critical
  veto catch that case. Locked by boundary tests at 0/1/5/6/100 and a
  mixed-magnitude test proving `CRIT = 3` no longer inflates.

## Unreleased — 2026-06-15 — Private 120-case audit suite

- Expanded the gated pt-BR controlled suite from 49 to 120 private cases using a
  deterministic reconstructed-audit importer.
- Added modality/anatomy/complexity quotas covering CT, MRI, ultrasound,
  radiography and mammography strata.
- Current private suite composition: 54 critical-safety cases and 23
  negative-control cases. Public score claims still require a production-agent
  rerun on the exact 120-case suite hash.
- Updated the public site copy so API and leaderboard pages do not publish
  generic harness tutorials, private product endpoints, API keys, frozen
  predictions or unrelated model-integration recipes.

## v3.0.0 — 2026-06-10 — LAIBench Pro

Optimized, hardened, and expanded. CLI contract and run-artifact JSON schema
remain backward compatible (suites accept both `benchmarkName: "laibench"` and
`"laibench-pro"`); correctness fixes change scores, so this is a major bump.

### Fixed (correctness — affects scores)
- **Modality classification**: `radiografia`/`radiograph` → XR and
  `ultrassonografia`/`ultrasound` → US across full forms, abbreviations
  (TC/RM/USG/RX/CTA) and word-internal matches. The prior word-boundary regexes
  misclassified most exams as CT, applying the wrong coverage matrix/title checks.
- **Report-language contract (`T-LANG`)**: a report in the wrong language for the
  suite locale is flagged with evidence instead of silently passing TERM while
  CRIT/QUAL emit misleading "finding not found" failures.
- **Clause-scoped negation** (`isFindingNegated`/`hasNegationCue`): negation is
  evaluated per clause; pertinent negatives are no longer counted as hallucinated
  critical findings (false positives in the critical extractor removed).
- **Laterality (`R02`)**: negated contralateral statements ("left lobe without
  nodules") are no longer mis-detected as laterality swaps.
- **Gate integrity**: a curated allowlist of safety/contract-critical structural
  checks (C01 contrast, C03* banned phrases, C04 foreign HTML, C07 preservation,
  C08 boilerplate, T-LANG, Q07 placeholders, Q09 ultrasound-technique) now reach
  the verdict gate even when an evaluator scores their dimension; the dimension
  score still comes from the evaluator (no double-counting).
- **`QG01`**: missing only minor findings is a deduction, not a hard gate.
- **`gateReasons`**: no longer polluted with "adversarial phase unavailable"
  (reported via `phaseStatus: "degraded"`).
- **`Q02`** title abbreviation downgraded from critical gate to minor deduction.
- **en-US `lymphadenopathy`** removed from forbidden terms (it is the standard
  English term; the rule was a pt-BR carry-over).

### Added
- **Impression synthesis (`QG06`)**: the impression must reflect the principal
  finding; copying a normal sentence as the impression is penalized.
- **8 new hard synthetic cases per locale** (12 total): CTA stroke, mammography
  BI-RADS, CTA pulmonary embolism, splenic trauma, Fleischner nodule, knee MRI,
  thyroid TI-RADS, subtle subdural.
- Suite-level concurrency, global throttle, generator-exception isolation,
  shared `fetchWithRetry` with timeouts/jitter, typed provider errors, regex
  caches, memoized suite loading.
- `examples/laudos-agent.mjs` (Laudos.AI quick-laudo adapter),
  `scripts/run-to-predictions.mjs`, `scripts/build-site-data.mjs`.
- Regression tests: `classify.test.ts`, `negation.test.ts` (249 tests total).

## v2.0.0 — 2026-05-09 — Reference-grade validation (iter2)

Iter2 hardens iter1 against the bugs surfaced in self-review. Score moved from
7.4 → ~9 by closing every issue I raised against my own work.

### Fixed
- **Determinism**: `measurement_scramble` and `critical_invent` now use a seeded
  splitmix32 PRNG keyed on (caseId, kind) instead of `Math.random()`. Reruns
  produce identical perturbations.
- **Dead code in `krippendorffAlphaInterval`**: removed redundant accumulator,
  cleaned the Hayes & Krippendorff (2007) implementation.
- **`DEFAULT_SCORING_FILES` correctness**: removed stale `evaluators/term.ts`
  reference, added `classify.ts`. `buildProvenanceManifest` now FAILS LOUD when
  a listed file is missing instead of silently skipping it.
- **`scanContamination` evasion**: now whitespace-insensitive (lowercase +
  strip whitespace) and also scans `sanitizedHtml`. Trivial canary splits
  (`abc def` for token `abcdef`) no longer evade detection.
- **`critical_drop` partial drop**: now removes EVERY declared critical finding
  from the report, not just the first.
- **`structure_break` weakness**: also strips section labels (Técnica, Achados,
  Conclusão, Technique, Findings, Impression).
- **CLI parser one-value bug**: `--inputs A B C` now consumes all three values
  instead of only `A`. Repeated `--flag X --flag Y` form still works.
- **Sparse terminology rules**: `TERM_CORRUPT_PT` 6 → 32 rules,
  `TERM_CORRUPT_EN` 6 → 32 rules, covering attenuation, density, contrast,
  enhancement, vascular, lymph, opacity, consolidation, atelectasis, etc.
- **Negation patterns**: PT-BR 4 → 6 (added `ausente`, `negativ(o|a) para`),
  en-US 3 → 6 (added `absent`, `negative for`, `without`).
- **Laterality flip gender preservation**: `direita ↔ esquerda` now preserves
  feminine/masculine suffix correctly.

### Added (iter2)
- **`src/report.ts`**: consolidated `buildConsolidatedReport` +
  `reportToMarkdown`. Pulls primary (n + mean + 95% CI + per-dim), contamination
  scan, calibration verdict, paired discrimination vs baseline, perturbation
  catch rate, and provenance hash chain into one publishable artifact.
- **`report` CLI command**: `--run X --baseline Y --calibration A B
  --perturb-report P --provenance V --out json --markdown md`.
- **`perturb-run` CLI command**: one-shot pipeline (build matrix → submit as
  predictions per kind → score → emit per-kind catch rates + verdict).
- **`buildPerturbationDataset(cases, options)`**: programmatic helper to build
  the (cases × kinds) prediction set without the CLI.
- **Multi-baseline mocks**: `examples/mock-good.mjs`, `mock-medium.mjs`,
  `mock-bad.mjs` (deterministic, FNV-seeded). Smoke scripts:
  `smoke:good`, `smoke:medium`, `smoke:bad`, `smoke:baselines`,
  `smoke:discriminate`, `smoke:perturb`, `smoke:full-leaderboard`.
- **Integration tests**: `src/perturb-eval.integration.test.ts` simulates the
  full perturb-run pipeline (per-kind sub-runs → catch summary). 5 new tests.
- **`src/report.test.ts`**: validates `buildConsolidatedReport` and
  `reportToMarkdown` against synthetic runs. 3 new tests.
- **`.github/workflows/ci.yml`**: matrix Node 20 + 22, runs typecheck, full
  test suite, plus 6 smoke commands (mock suite, leaderboard, bootstrap,
  contamination, provenance, perturb-run). Uploads `runs/` as artifact.
- **`docs/MIGRATION.md`**: v1 → v2 migration guide with one-liner upgrade
  diff and opt-in feature snippets.
- **Per-kind catch-rate reference**: a smoke run on `lite-public.pt-BR`
  (40 perturbations across 5 cases) shows 100% catch on laterality_flip,
  measurement_scramble, terminology_corrupt, and structure_break under
  deterministic-only scoring, and 0% on negation/critical kinds (judge
  required). Methodology in `docs/laibench-leaderboard-methods.md`. (The
  bundled preprint is the separate "Beyond Templates" conceptual companion
  paper, which does not describe the benchmark; a dedicated LAIBench methods
  paper is forthcoming.)

### Test count: 214 (was 169 in iter1, 105 in v1).

## v2.0.0-iter1 — 2026-05-09 — Reference-grade validation (validation layers)

Promoted from "good benchmark" to "reference area benchmark" by adding the four
validation layers a reviewer needs to trust a leaderboard.

### Added

- **`src/kappa.ts`** — Cohen's κ (two raters, nominal), Fleiss' κ (N raters,
  nominal), Krippendorff's α (N raters, interval, NaN-tolerant), paired
  bootstrap test for two paired numeric series. Landis–Koch and content-analysis
  interpretation labels.
- **`src/discriminate.ts`** — `discriminate(runA, runB)` returns overall mean
  difference with 95% bootstrap CI and p-value, per-dim breakdown, per-modality
  and per-difficulty stratified deltas (n ≥ 5), stratum-collapse warnings, and
  a verdict ∈ {discriminates, weak, fails}. `summarizeReferenceProbe` for the
  gold-as-output sanity check.
- **`src/calibrate.ts`** — `calibrateJudges(runs)` computes test-retest α (same
  judge, multiple runs), cross-judge κ (verdict) + α (overall), and det↔judge
  Spearman ρ. `scanContamination(run)` flags canary-token leakage and
  judge-flagged contamination signals.
- **`src/perturb.ts`** — Eight adversarial perturbation classes (laterality
  flip, negation drop/insert, measurement scramble, critical drop/invent,
  terminology corrupt, structure break) with declared expected dim + severity.
  `applyPerturbation`, `buildPerturbationMatrix`, `summarizeRobustness`.
- **`src/perturb-eval.ts`** — Catch-rule logic (`isPerturbationCaught`) with
  three-way trigger (det check fail / judge critical / dim score floor) and
  severity-indexed thresholds (60 / 80 / 90 for critical / major / minor).
- **`src/provenance.ts`** — Reproducibility hash chain: `caseHash → suiteHash →
  scoringHash → runHash → leaderboardHash` (SHA-256, order-independent at
  suite/leaderboard layer). `buildProvenanceManifest` emits a top-level
  manifest covering all suites and pinned scoring code at publication time.
- **CLI commands**: `discriminate`, `calibrate`, `contamination`,
  `perturb-matrix`, `bootstrap`, `provenance`.
- **64 new tests** across `src/kappa.test.ts`, `src/discriminate.test.ts`,
  `src/calibrate.test.ts`, `src/perturb.test.ts`, `src/perturb-eval.test.ts`,
  `src/provenance.test.ts`. 169 total, all passing.
- **Validation methodology** documented in
  `docs/laibench-leaderboard-methods.md` (reference-grade validation
  infrastructure, reproducibility, threats to validity, versioning), relying on
  the agreement/CI statistics Cohen, Fleiss, Krippendorff, Hayes & Krippendorff,
  Landis & Koch, Efron & Tibshirani, McNemar, and Bachour. (The bundled
  "Beyond Templates" preprint is a separate conceptual companion and does not
  describe the benchmark; a dedicated LAIBench methods paper is forthcoming.)

### Changed

- `package.json` version bumped to `2.0.0`.
- All suite manifests bumped `benchmarkVersion` to `"2.0.0"`.
- Description: now "Reference benchmark for radiology report generation".
- `README.md` rewritten around the v2 reference-validation story.

### Backwards compatibility

- Every v1 case file remains valid. v1 runs replay against v2 scoring without
  schema changes.
- v1 CLI commands unchanged.

## v1.0.0 — 2026-04 — First public release

- 62 reference cases (49 pt-BR + 13 en-US) + 2,670 corpus cases + 96 complex
  supplement + 4 challenge suites, extracted from controlled non-distributed source material.
- Five-dimension scoring (CRIT, QUAL, TERM, GUIDE, RAG) on 0–100% scale with
  conservative `min(det, adv)` combination.
- Five dedicated evaluators (severity-weighted finding matching, negation-aware
  critical detection, modular guideline engines for 7 classification systems,
  IR metrics, locale-specific terminology).
- Locale-pluggable evaluation for pt-BR and en-US.
- Three configurable policy profiles (strict / research / leaderboard).
- Three provider backends (openrouter, openai-compatible, command) with
  retry/backoff and SIGINT-safe partial saves.
- Submission validation, eligibility gates, per-difficulty stratified
  leaderboards.
- Bootstrap CI, McNemar's test, Cohen's h. 105 tests.
