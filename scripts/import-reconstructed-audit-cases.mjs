#!/usr/bin/env node
// Build a private pt-BR controlled suite from the reconstructed audit CSV.
//
// This importer is for the private audit CSV only. It does not copy the source
// CSV into the repository or the public site. The output is a gated case JSON
// with deterministic quotas across modality, anatomy, and complexity strata.

import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT_LIMIT = 120;

const STRATUM_QUOTAS = new Map([
  ["CT/chest/normal", 3],
  ["CT/chest/simple", 8],
  ["CT/chest/complex", 9],
  ["CT/abdomen/normal", 3],
  ["CT/abdomen/simple", 8],
  ["CT/abdomen/complex", 9],
  ["MRI/brain/normal", 4],
  ["MRI/brain/simple", 5],
  ["MRI/brain/complex", 11],
  ["X-ray/chest/normal", 5],
  ["X-ray/chest/simple", 8],
  ["X-ray/chest/complex", 7],
  ["Ultrasound/abdomen/normal", 5],
  ["Ultrasound/abdomen/simple", 4],
  ["Ultrasound/abdomen/complex", 6],
  ["Ultrasound/thyroid/normal", 4],
  ["Ultrasound/thyroid/simple", 4],
  ["Ultrasound/thyroid/complex", 2],
  ["Mammography/breast/normal", 4],
  ["Mammography/breast/simple", 6],
  ["Mammography/breast/complex", 5],
]);

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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") {
          field += "\"";
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === "\"" && field.length === 0) {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function norm(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function bool(value) {
  return String(value ?? "").toLowerCase() === "true";
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function modalityCode(value) {
  const n = norm(value);
  if (n === "ct") return "CT";
  if (n === "mri") return "MRI";
  if (n === "ultrasound") return "US";
  if (n === "x-ray") return "XR";
  if (n === "mammography") return "MG";
  return "CT";
}

function regionCode(value) {
  const n = norm(value);
  if (n === "brain") return "head";
  if (["chest", "abdomen", "spine", "urinary", "pelvis", "breast", "thyroid", "neck"].includes(n)) return n;
  return "unknown";
}

function modalityLabel(value) {
  const labels = {
    CT: "Tomografia computadorizada",
    MRI: "Ressonancia magnetica",
    "X-ray": "Radiografia",
    Ultrasound: "Ultrassonografia",
    Mammography: "Mamografia",
  };
  return labels[value] ?? value;
}

function isSectionHeader(line, rx) {
  return rx.test(norm(line).replace(/[:.]+$/, ""));
}

function splitReport(reportText) {
  const raw = String(reportText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const title = raw[0] ?? "";
  const lines = raw.slice(1);

  const conclusionIndex = lines.findIndex((line) =>
    isSectionHeader(line, /^(conclusao|impressao|impressao diagnostica|diagnostico|comentarios)$/)
  );
  const analysisIndex = lines.findIndex((line) =>
    isSectionHeader(line, /^(analise|achados|descricao|resultado)$/)
  );
  const methodIndex = lines.findIndex((line) =>
    isSectionHeader(line, /^(metodo|metodologia|tecnica|protocolo)$/)
  );

  let start = 0;
  if (analysisIndex >= 0) {
    start = analysisIndex + 1;
  } else if (methodIndex === 0) {
    start = 1;
  }

  const end = conclusionIndex >= 0 ? conclusionIndex : lines.length;
  const findings = lines
    .slice(start, end)
    .filter((line) => !isSectionHeader(line, /^(metodo|metodologia|tecnica|protocolo|analise|achados|descricao|resultado)$/))
    .join("\n")
    .trim();
  const impression = conclusionIndex >= 0 ? lines.slice(conclusionIndex + 1).join("\n").trim() : "";
  return { title, findings, impression };
}

function splitSentences(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.;])\s+|\n+/)
    .map((sentence) => sentence.replace(/[.;]\s*$/, "").trim())
    .filter((sentence) => sentence.length >= 12)
    .slice(0, 5);
}

function isNegated(sentence) {
  return /\b(sem|nao ha|nao se observa|ausencia de|ausente|nao se caracteri[sz]a)\b/i.test(norm(sentence));
}

function severityFor(sentence, forceCritical) {
  const n = norm(sentence);
  if (
    (forceCritical && !isNegated(sentence)) ||
    /\b(abscesso|perfuracao|trombose|oclusao|isquemia|hemorragia|aneurisma|disseccao|neoplas|tumor|carcinoma|metast|colangite|coledocolitiase|hidronefrose|fistul|colecao|colecoes|pneumotorax|embolia|infarto|rotura|processo expansivo|fratura|lesao suspeita|bi-?rads 4|bi-?rads 5)\b/.test(n)
  ) {
    return "critical";
  }
  if (/\b(lesao|nodulo|massa|calculo|dilatacao|estenose|edema|derrame|inflamator|cisto|hernia|artrose|tendin|bursite|ruptura|colelit|linfonod|espessamento|laceracao|expansiv)\b/.test(n)) {
    return "major";
  }
  return "minor";
}

function lateralityFor(sentence) {
  const n = norm(sentence);
  if (/\bbilater/.test(n)) return "bilateral";
  if (/\besquerd[ao]s?\b/.test(n)) return "left";
  if (/\bdireit[ao]s?\b/.test(n)) return "right";
  return undefined;
}

function measurementsFor(sentence) {
  return Array.from(sentence.matchAll(/\b\d+(?:[,.]\d+)?(?:\s*x\s*\d+(?:[,.]\d+)?){0,2}\s*(?:mm|cm|ml|mL|cc)\b/g)).map((m) => m[0]);
}

function guidelineExpectationsFromText(text) {
  const expectations = [];
  const hasRecommendation = /recomenda[çc][aã]o|sugere-se|bi[oó]psia|pun[çc][aã]o|controle|seguimento|tratamento|magnifica[çc][aã]o|correla[çc][aã]o/i.test(text);

  const birads = /(?:acr\s+)?bi-?rads(?:\s*®|\s*\u00ae)?\s*[:\s]?\s*(\d[a-c]?)/i.exec(text);
  if (birads) {
    expectations.push({
      guidelineId: "birads",
      expectedClassification: `BI-RADS ${birads[1].toUpperCase()}`,
      ...(hasRecommendation ? { recommendationRequired: true } : {}),
    });
  }

  const tirads = /(?:acr\s+)?ti-?rads\s*[:\s]?\s*(\d)/i.exec(text);
  if (tirads) {
    expectations.push({
      guidelineId: "tirads",
      expectedClassification: `TI-RADS ${tirads[1]}`,
      ...(hasRecommendation ? { recommendationRequired: true } : {}),
    });
  }

  return expectations;
}

function htmlBlock(title, findings, impression) {
  return `<center><b>${htmlEscape(title.toUpperCase())}</b></center><br><br><b>Achados</b><br>${htmlEscape(findings).replace(/\n+/g, "<br>")}<br><br><b>Conclusao</b><br>${htmlEscape(impression).replace(/\n+/g, "<br>")}`;
}

function goldFindingsFromText(text, forceCritical) {
  return splitSentences(text).map((sentence, index) => {
    const finding = {
      finding: sentence,
      severity: severityFor(sentence, forceCritical && index === 0),
    };
    const laterality = lateralityFor(sentence);
    if (laterality) finding.laterality = laterality;
    const measurements = measurementsFor(sentence);
    if (measurements.length > 0) finding.measurements = measurements;
    if (isNegated(sentence)) finding.negated = true;
    return finding;
  });
}

function rowToCandidate(row) {
  const split = splitReport(row.report_text_deidentified);
  const impression = split.impression || row.conclusion_excerpt || split.findings.split(/(?<=[.;])\s+/).slice(-3).join(" ");
  const criticalSafety = bool(row.urgent_flag) || bool(row.suspicious_terms);
  const goldFindings = goldFindingsFromText(impression, criticalSafety);
  if (split.findings.length < 40 || goldFindings.length === 0) return null;

  const modality = modalityCode(row.modality_normalized);
  const region = regionCode(row.region_normalized);
  const difficulty = row.complexity === "complex" ? "hard" : row.complexity === "simple" ? "medium" : "easy";
  const referenceReport = htmlBlock(split.title || row.title_line || row.original_exame, split.findings, impression);
  const criticalFindings = goldFindings.filter((finding) => finding.severity === "critical" && !finding.negated).map((finding) => finding.finding);
  const tags = [
    "private",
    "controlled-corpus",
    "audit-120",
    modality,
    region,
    difficulty,
    row.modality_normalized,
    row.region_normalized,
  ];
  if (criticalFindings.length > 0) tags.push("critical-safety");
  if (bool(row.urgent_flag)) tags.push("urgent-flag");
  if (bool(row.suspicious_terms)) tags.push("suspicious-terms");
  if (bool(row.acute_terms)) tags.push("acute-terms");
  if (bool(row.global_normal_flag)) tags.push("negative-control");

  return {
    row,
    stratumKey: `${row.modality_normalized}/${row.region_normalized}/${row.complexity}`,
    criticalSafety: criticalFindings.length > 0,
    negativeControl: bool(row.global_normal_flag) || row.complexity === "normal",
    case: {
      label: `Private controlled audit fixture: ${split.title || row.title_line || row.original_exame}`,
      synthetic: false,
      schemaVersion: "1.1.0-private-controlled-audit",
      exam: `${row.original_exame || split.title || row.title_line}. Modalidade: ${modalityLabel(row.modality_normalized)}.`,
      findings: split.findings,
      locale: "pt-BR",
      tags,
      goldFindings,
      referenceReport,
      criticalFindings,
      guidelineExpectations: guidelineExpectationsFromText(referenceReport),
      patientContext: {
        indication: "Fixture privado controlado; identificadores diretos e datas de calendario foram removidos antes da construcao da suite.",
      },
      difficulty,
    },
  };
}

function selectByQuotas(candidates, limit) {
  const selected = [];
  const seen = new Set();

  for (const [stratumKey, quota] of STRATUM_QUOTAS.entries()) {
    const pool = candidates
      .filter((candidate) => candidate.stratumKey === stratumKey)
      .sort((a, b) => Number(b.criticalSafety) - Number(a.criticalSafety) || Number(b.negativeControl) - Number(a.negativeControl) || a.row.case_id.localeCompare(b.row.case_id));
    if (pool.length < quota) {
      throw new Error(`Only ${pool.length} candidates available for ${stratumKey}; need ${quota}.`);
    }
    for (const candidate of pool.slice(0, quota)) {
      if (seen.has(candidate.row.case_id)) continue;
      selected.push(candidate);
      seen.add(candidate.row.case_id);
    }
  }

  if (selected.length !== limit) {
    throw new Error(`Selected ${selected.length} cases; expected ${limit}. Check STRATUM_QUOTAS.`);
  }
  return selected;
}

function phiIssues(text) {
  const checks = [
    ["calendar-date", /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/],
    ["iso-date", /\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/],
    ["crm", /\bCRM\b/i],
    ["cpf", /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
    ["email", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
    ["phone", /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}\b/],
  ];
  return checks.filter(([, rx]) => rx.test(text)).map(([name]) => name);
}

const args = parseArgs(process.argv.slice(2));
const csvPath = args.csv;
const outPath = args.out ?? "cases/private/synthetic-demo.pt-BR.json";
const limit = Number(args.limit ?? DEFAULT_LIMIT);

if (!csvPath) {
  console.error("Usage: node scripts/import-reconstructed-audit-cases.mjs --csv <audit.csv> [--out cases/private/synthetic-demo.pt-BR.json] [--limit 120]");
  process.exit(1);
}

if (limit !== DEFAULT_LIMIT) {
  throw new Error(`This importer is quota-locked to ${DEFAULT_LIMIT} cases; received --limit ${limit}.`);
}

const rows = parseCsv(readFileSync(csvPath, "utf8").replace(/^\uFEFF/, ""));
const header = rows[0];
const records = rows.slice(1).map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]])));
const candidates = records.map(rowToCandidate).filter(Boolean);
const selected = selectByQuotas(candidates, limit);
const cases = selected.map((item, index) => ({
  id: `PRIVATE-PTBR-${String(index + 1).padStart(3, "0")}`,
  ...item.case,
}));

const output = `${JSON.stringify(cases, null, 2)}\n`;
const phi = phiIssues(output);
if (phi.length > 0) {
  throw new Error(`Potential PHI-like patterns in generated output: ${phi.join(", ")}`);
}

writeFileSync(outPath, output);

const summary = {
  rows: rows.length - 1,
  candidates: candidates.length,
  cases: cases.length,
  criticalSafety: cases.filter((item) => item.criticalFindings.length > 0).length,
  negativeControl: cases.filter((item) => item.tags?.includes("negative-control")).length,
};
console.log(JSON.stringify(summary, null, 2));

const strata = new Map();
for (const item of selected) {
  strata.set(item.stratumKey, (strata.get(item.stratumKey) ?? 0) + 1);
}
for (const [key, count] of Array.from(strata.entries()).sort()) {
  console.log(`${key}: ${count}`);
}
