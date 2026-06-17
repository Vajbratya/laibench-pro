#!/usr/bin/env node
// Emit a frozen predictions JSONL file using each case referenceReport.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const casesPath = args.cases ?? "cases/private/synthetic-demo.pt-BR.json";
const outPath = args.out ?? "predictions/reference-pt-BR.jsonl";
const modelName = args.model ?? "reference-report";

const cases = JSON.parse(readFileSync(casesPath, "utf8"));
if (!Array.isArray(cases)) throw new Error(`Cases file must be an array: ${casesPath}`);

const lines = cases.map((benchCase) => {
  if (!benchCase.referenceReport) throw new Error(`Case ${benchCase.id} has no referenceReport.`);
  return JSON.stringify({
    instance_id: benchCase.id,
    model_name_or_path: modelName,
    model_output: benchCase.referenceReport,
    metadata: { source: "case.referenceReport", costUsd: 0 },
  });
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${lines.join("\n")}\n`);
console.log(`Wrote ${lines.length} reference predictions to ${outPath}`);
