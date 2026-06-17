window.LAIBENCH_DATA = {
 "generatedAt": null,
 "locales": {
  "pt-BR": {
   "suite": "lite-public.pt-BR",
   "suiteHash": "b7f412e25a71352072d525c9bee9d7630818eb09996d172e9c2664224d7b2217",
   "cases": 120,
   "track": "agent",
   "scoring": "conservative-min",
   "entries": [
    {
     "system": "Laudos.AI",
     "kind": "product-agent",
     "group": "production",
     "score": 0.833,
     "allPass": 0.275,
     "criterionPass": 0.96,
     "clinicalScore": 0.833,
     "strictPass": 0.55,
     "dims": {
      "CRIT": 0.9059999999999999,
      "QUAL": 0.8490000000000001,
      "TERM": 0.99,
      "GUIDE": 0.9670000000000001,
      "RAG": 0.968
     },
     "latencyMs": 16991.1,
     "track": "agent",
     "suiteHash": "b7f412e25a71352072d525c9bee9d7630818eb09996d172e9c2664224d7b2217"
    }
   ],
   "reliability": null,
   "reliabilityRuns": 0,
   "note": "Controlled benchmark preview. Production agents are ranked separately from free/open model comparisons and calibration fixtures. The public board excludes case JSON, answer keys, frozen predictions and corpus provenance. The pt-BR controlled suite is gated and must not be treated as an open-download benchmark. Score is weighted clinical fidelity score. Strict all-pass means zero-failure cases: every criterion in a case passes simultaneously, and any critical failure forces FAIL instead of being averaged into PASS. Runs are reproducible only inside the controlled adjudication environment. <a href=\"#methods\">Methods</a>."
  }
 }
};
