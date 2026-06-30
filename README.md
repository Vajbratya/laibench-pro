# LAIBench Pro

LAIBench Pro is a governance-oriented benchmark framework for AI-assisted radiology reporting — an optimized, hardened evolution of the public LAIBench harness.

**LAIBench Pro is a technical benchmark framework, not a medical device, not regulatory approval, and not clinical validation. It must not be used as the sole basis for clinical deployment decisions. All references below are to that technical scope.**

Website: [laibench.laudos.ai](https://laibench.vercel.app)
By: [Laudos.AI](https://laudos.ai)

**Repository visibility:** public-safe. Public release requires `npm run guard:public` plus manual privacy/legal review. The pt-BR controlled fixture suite is not an open-download benchmark and is not distributed in this repository.

## What's new in Pro

LAIBench Pro keeps the public CLI contract and run-artifact JSON schema backward compatible while substantially improving correctness, robustness, and discrimination.

**Correctness fixes (these change scores — `scoringVersion` is bumped accordingly):**

- **Modality classification.** `Radiografia`/`radiograph` now classify as XR (not CT) and `Ultrassonografia`/`ultrasound` as US, across full forms, abbreviations (TC, RM, USG, RX, CTA), and word-internal matches. The previous word-boundary regexes silently misclassified most exams as CT, applying the wrong anatomical-coverage matrix and title checks.
- **Report-language contract (`T-LANG`).** A report written in the wrong language for the suite locale (e.g. a Portuguese report on the en-US suite) is now flagged explicitly with evidence, instead of passing TERM at 100% while CRIT/QUAL emitted misleading "finding not found" failures.
- **Clause-scoped negation.** Negation is now evaluated per clause, so "Grade III splenic laceration, **without** active extravasation" keeps the laceration positive while recognizing the extravasation as negated. Pertinent negatives ("no intracranial hemorrhage", "sem desvio da linha média") are no longer counted as hallucinated critical findings.
- **Laterality (`R02`).** A negated contralateral statement ("left lobe **without** nodules") is no longer mis-detected as a laterality swap of a right-sided finding.
- **Gate integrity.** Safety- and contract-critical structural checks (contrast language in a non-contrast exam, banned phrases, findings-preservation, report language, no unfilled placeholders, ultrasound-has-no-technique-section) now reach the verdict gate even when an evaluator scores their dimension — previously they were dropped. The dimension score still comes from the evaluator, so there is no double-counting.
- **Detection-rate gating (`QG01`).** Missing only *minor* findings is a deduction, not a hard case failure; missing a *critical or major* finding still gates.
- **`gateReasons` hygiene.** "adversarial phase unavailable" is no longer pushed into `gateReasons`; judge absence is reported via `phaseStatus: "degraded"` instead.
- **Title abbreviation (`Q02`)** is a minor style deduction, not a critical gate — standard titles ("TC DE CRÂNIO", "CT ANGIOGRAPHY") are accepted.

**New quality signal:**

- **Impression synthesis (`QG06`).** The impression/conclusion — the most clinically-read section — must reflect the principal finding. A report that copies a normal sentence as its impression is penalized; genuine synthesis ("M1 occlusion" for "occlusion of the M1 segment") passes.

**Performance & robustness:**

- Suite-level concurrency (`--concurrency`), with sensible per-provider defaults and a global inter-request throttle (`--sleep-ms` / `LAIBENCH_INTER_REQ_SLEEP_MS`).
- Per-case generator exceptions are isolated as operational failures instead of rejecting the whole suite and discarding completed results.
- Shared `fetchWithRetry` with request timeouts, correct `Retry-After` handling, and jittered backoff; typed provider errors; hardened command-provider process handling.
- Precompiled per-locale regex caches and memoized suite loading.

**Controlled pt-BR suite:** the pt-BR benchmark now contains **120 gated cases** in the controlled adjudication environment. The current 120-case audit set includes modality, anatomy and complexity quotas, 54 critical-safety cases and 23 negative-control cases. Source material, case JSON, answer keys and frozen predictions must not be published in an open repository.

## Leaderboard

The public leaderboard ranks **production reporting agents** from aggregate controlled-suite runs. Harness calibration fixtures and raw/free model rows can be shown separately for context, but they are **not** ranked against production agents. LAIBench Pro evaluates reporting *systems* first; bare model results are diagnostic comparisons only.

The reference implementation evaluated here is the **Laudos.AI** radiology report agent. Product-agent runs require authorized private credentials and must be interpreted only for the exact suite hash and case count that were executed.

## What it evaluates

LAIBench Pro evaluates reporting behavior from provided text evidence: whether a system can convert an exam descriptor and concise findings into a faithful radiology report under the public contract. It is **not** primary image interpretation.

The framework makes failure modes visible: clinically relevant omissions, hallucinated or unsupported findings, factual contradictions, critical-finding preservation, structured-report compliance, privacy hygiene, and auditability.

## Scoring

Published clinical scores are finite **0-100** values at every layer: dimension scores, case overall, suite average, and leaderboard artifacts. Public leaderboard generation rejects manually edited or malformed run JSON with `NaN`, infinite, negative, or >100 scores. LLM judge JSON is validated on the 0-100 contract; legacy all-dimension 1-5 Likert output remains accepted through result-level rescaling for backward compatibility.

| Dimension | Weight | Purpose |
| --- | ---: | --- |
| CRIT | 30% | Critical finding preservation and unsafe-negation checks |
| QUAL | 25% | Clinical quality, finding preservation, hallucination resistance, impression synthesis |
| TERM | 20% | Locale, modality, section, report terminology, and report-language contract |
| GUIDE | 15% | Guideline and anatomical coverage expectations |
| RAG | 10% | Evidence fidelity, section order, laterality, levels, and measurements |

Critical-finding omissions, unsafe negations, contradictions, unsupported normalcy, wrong report language, and structural errors trigger failure gates — a high average score cannot hide them.

### Calibration controls

The public stratified page is a **reference-vs-null sanity check**. It verifies that the harness is not inverted by comparing public reference reports against a fixed unsafe null baseline. That check is useful, but it is not a claim that the null baseline measures realistic model degradation.

Dose-response controls are generated inside the controlled environment because they require answer-key material. Public releases may publish aggregate calibration summaries only, never case-level predictions or gold labels.

## Quickstart

```bash
npm ci
npm test
npm run typecheck
npm run smoke:mock
npm run smoke:leaderboard
```

Run the synthetic public en-US suite with a local command adapter:

```bash
npm run bench -- suite \
  --suite suites/lite-public.en-US.json \
  --provider command \
  --cmd "node examples/mock-agent.mjs" \
  --run-name mock-agent \
  --track agent \
  --out runs/mock-agent.json
```

The controlled pt-BR suite is aggregate-only in the public repository.

### Benchmark the Laudos.AI agent

```bash
export LAUDOSAI_API_KEY=<authorized-key>
npm run bench -- suite \
  --suite suites/lite-public.pt-BR.json \
  --provider command \
  --cmd "node examples/laudos-agent.mjs" \
  --run-name laudos-ai \
  --entity-name "Laudos.AI" --entity-type company --system-type product-agent \
  --track agent \
  --out runs/laudos-ai.json
```

The controlled pt-BR suite is not runnable from the public repository because it
does not ship case JSON. Authorized reviewers run this command inside the gated
benchmark environment.

The adapter never hardcodes the key; it reads `LAUDOSAI_API_KEY` from the environment.

### Reliability (pass^k)

```bash
npm run bench -- reliability \
  --inputs runs/run-1.json runs/run-2.json runs/run-3.json \
  --out runs/reliability.json \
  --markdown runs/reliability.md
```

### Frozen predictions

```bash
npm run bench -- eval-submission \
  --suite suites/lite-public.pt-BR.json \
  --predictions predictions/my-agent.jsonl \
  --run-name my-agent --track agent \
  --out runs/my-agent.json
```

Each JSONL line follows the prediction record schema (`instance_id`, `model_output`). See [docs/public-submissions.md](docs/public-submissions.md).

### Build the leaderboard site data

```bash
node scripts/build-site-data.mjs --out site/data.js \
  --board pt-BR runs/laudos-ai.json runs/baselines/mock-good-pt-BR.json \
  --reliability pt-BR runs/reliability.json
```

## Leaderboard governance

Leaderboard rows disclose benchmark version, suite hash, track, scaffold class, judged/frozen status, evaluated entity, validation status, cost, latency, and scoring mode. Incompatible runs are separated by track, scaffold, locale, and suite hash. Public artifacts must not include private prompts, product routes, credentials, private file paths, raw validation ID lists, private case content, hidden judge configuration, answer keys, or proprietary schemas beyond the public contract.

## Open vs controlled (read this before citing)

There are two distinct artifacts, and only one is open:

- **LAIBench (public).** The separate open benchmark is the 2,670-case public set. That is the downloadable, openly reproducible artifact.
- **LAIBench Pro gold (this repository's controlled suite).** The 120-case pt-BR controlled suite is **controlled and aggregate-only**. It is **not** an open-download benchmark. Case JSON, answer keys, frozen predictions and provenance are **not** distributed here and are not available for download. A reader cannot reconstruct or download the Pro gold suite from this repository.

Do not attach "open benchmark" language to the Pro gold suite. When LAIBench Pro numbers are cited, cite them as controlled, aggregate-only results locked to a specific suite hash and case count, evaluated by a first-party agent (see the leaderboard disclosure). The open-benchmark claim belongs only to the separate public LAIBench set.

**Case provenance.** The public demonstration cases under `cases/public/` are synthetic and input-only. The controlled pt-BR cases are synthetic and were authored and clinically reviewed by senior radiologists in Sao Paulo, SP, Brazil. Synthetic authorship and internal senior-radiologist review are a data-quality process, not an independent third-party validation. Independent external adjudication (vendor-versus-external inter-rater kappa) is tracked as future work and is not claimed here.

## Data Boundary

Public cases in this repository are synthetic input-only demos under `cases/public/`. The pt-BR controlled suite, answer keys, frozen predictions and provenance remain outside the public repository and must not be copied into public artifacts, paper supplements, or model-training datasets. See [DATA_ACCESS_POLICY.md](DATA_ACCESS_POLICY.md).

## License

LAIBench Pro is released under the MIT License. The MIT License applies to the public code, schemas, documentation, examples, synthetic demo cases, and tooling in this repository. It does not apply to the private clinical corpus, gated datasets, hidden test sets, answer keys, private scoring criteria, or protected evaluation artifacts that are not included here.
