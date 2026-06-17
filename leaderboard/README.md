# LAIBench Pro Public Leaderboard

The public leaderboard publishes methodology and aggregate metrics only.
Controlled pt-BR case JSON, answer keys, frozen predictions, raw model outputs
and corpus provenance are intentionally excluded from the public repository.

## Current controlled suite

The displayed pt-BR board is based on a validated 120-case controlled run.
Those cases include critical-safety and negative-control strata, but the
case-level material is not an open-download benchmark.

| # | System | Group | Clinical score | All-pass | Criteria | CRIT | QUAL | TERM | GUIDE | RAG |
| --: | --- | --- | --: | --: | --: | --: | --: | --: | --: | --: |
| 1 | Laudos.AI | production agent | 83.3% | 27.5% | 96.0% | 90.6% | 84.9% | 99.0% | 96.7% | 96.8% |

`Clinical score` is the weighted aggregate score. `All-pass` is stricter: a
case counts only when every criterion passes simultaneously. Critical failures
are hard gates: a deterministic or adversarial critical failure forces that case
to FAIL and cannot be averaged into PASS.

## Public files

- `site/data.js` contains aggregate leaderboard data used by the static site.
- `artifacts/laudos-ptbr-120-summary.md` contains the aggregate 120-case
  Laudos.AI summary.
- Case-level JSON, JSONL frozen predictions and private pt-BR fixtures are
  ignored and must stay outside public Git history.

## Reproduce

Authorized reviewers can reproduce controlled pt-BR runs inside the gated
benchmark environment. Public users can inspect the harness code and run only
synthetic/demo suites that ship without answer keys.
