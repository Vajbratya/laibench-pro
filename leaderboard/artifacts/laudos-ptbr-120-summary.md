# Laudos.AI 120-case pt-BR aggregate run

This public summary contains aggregate benchmark metrics only. Case JSON, answer keys,
frozen predictions, raw model outputs and controlled-suite provenance are not distributed
in the public repository.

| Metric | Value |
| --- | ---: |
| Cases | 120 |
| Clinical score | 90.0% |
| Strict PASS gate | 73.3% |
| All-pass completion | 49.2% |
| Criterion pass | 97.6% |
| Average latency | 17.0s |
| CRIT | 97.7% |
| QUAL | 88.1% |
| TERM | 100.0% |
| GUIDE | 96.7% |
| RAG | 98.3% |

Critical-gate policy: any deterministic or adversarial critical failure forces that
case to FAIL instead of being averaged into PASS.
