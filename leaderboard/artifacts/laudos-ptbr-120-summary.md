# Laudos.AI 120-case pt-BR aggregate run

This public summary contains aggregate benchmark metrics only. Case JSON, answer keys,
frozen predictions, raw model outputs and controlled-suite provenance are not distributed
in the public repository.

| Metric | Value |
| --- | ---: |
| Cases | 120 |
| Clinical score | 83.3% |
| Strict PASS gate | 55.0% |
| All-pass completion | 27.5% |
| Criterion pass | 96.0% |
| Average latency | 17.0s |
| CRIT | 90.6% |
| QUAL | 84.9% |
| TERM | 99.0% |
| GUIDE | 96.7% |
| RAG | 96.8% |

Critical-gate policy: any deterministic or adversarial critical failure forces that
case to FAIL instead of being averaged into PASS.
