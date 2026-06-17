#!/usr/bin/env node
// Build the private controlled pt-BR case file from a merged CSV export.
//
// The importer is intentionally conservative and deterministic:
// - starts a case only when the row has Exame + known Modalidade + Laudo
// - joins continuation rows that the CSV export split on commas/newlines
// - strips administrative signature/CRM/date lines
// - redacts calendar dates that can link cases back to a source system
// - requires both findings/analysis and impression/conclusion sections
// - derives gold findings from the impression text without synonym expansion

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT_LIMIT = 120;
const REDACTED_DATE = "[data removida]";

const MODALITIES = new Map([
  ["tomografia computadorizada", { code: "CT", label: "Tomografia computadorizada" }],
  ["ressonancia magnetica", { code: "MRI", label: "Ressonancia magnetica" }],
  ["ultrassonografia", { code: "US", label: "Ultrassonografia" }],
  ["radiografia", { code: "XR", label: "Radiografia" }],
  ["mamografia", { code: "MG", label: "Mamografia" }],
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

function cleanCell(value) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function redactCalendarDates(value) {
  return String(value)
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, REDACTED_DATE)
    .replace(/\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/g, REDACTED_DATE)
    .replace(/\b\d{1,2}\s+de\s+(?:janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+\d{4}\b/gi, REDACTED_DATE);
}

function isCaseStart(row) {
  if (row.length < 3) return null;
  const exam = cleanCell(row[0]);
  const modality = MODALITIES.get(norm(row[1]));
  const body = cleanCell(row.slice(2).filter(Boolean).join(", "));
  if (!exam || !modality || body.length < 24) return null;
  return { exam, modality, body };
}

function lineFromRow(row) {
  return row.map(cleanCell).filter(Boolean).join(", ").trim();
}

function groupRows(rows) {
  const groups = [];
  let current = null;

  for (const row of rows.slice(1)) {
    const start = isCaseStart(row);
    if (start) {
      if (current) groups.push(current);
      current = {
        sourceIndex: groups.length + 1,
        exam: start.exam,
        modality: start.modality,
        chunks: [start.body],
      };
      continue;
    }

    if (!current) continue;
    const line = lineFromRow(row);
    if (line) current.chunks.push(line);
  }

  if (current) groups.push(current);
  return groups;
}

function stripAdministrativeLines(text) {
  const lines = text
    .replace(/^"+|"+$/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const kept = [];
  for (const line of lines) {
    const n = norm(line);
    if (/^(laudado por|revisado por|crm\b|data\b|dr\.|dra\.)/.test(n)) break;
    kept.push(line);
  }
  return kept;
}

function sectionKind(line) {
  const n = norm(line).replace(/[:.]+$/, "");
  if (/^(analise|achados|descricao|demais achados)\b/.test(n)) return "findings";
  if (/^(impressao|impressao diagnostica|conclusao|conclusao diagnostica|diagnostico)\b/.test(n)) return "impression";
  if (/^(tecnica|metodo|metodologia|protocolo)\b/.test(n)) return "technique";
  return null;
}

function splitSections(lines) {
  const sections = { preamble: [], technique: [], findings: [], impression: [] };
  let current = "preamble";

  for (const line of lines) {
    const kind = sectionKind(line);
    if (kind) {
      current = kind;
      const inline = line.includes(":") ? line.slice(line.indexOf(":") + 1).trim() : "";
      if (inline) sections[current].push(inline);
      continue;
    }
    sections[current].push(line);
  }
  return sections;
}

function paragraph(lines) {
  return lines
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSentences(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.;])\s+|\n+/)
    .map((s) => s.replace(/[.;]\s*$/, "").trim())
    .filter((s) => s.length >= 12 && !/^(estudos? anteriores?|comparativo|correlacionar)/i.test(s))
    .slice(0, 5);
}

function severityFor(sentence) {
  const n = norm(sentence);
  if (/\b(abscesso|perfuracao|trombose|oclusao|isquemia|hemorragia|aneurisma|disseccao|neoplas|tumor|carcinoma|metast|colangite|coledocolitiase|hidronefrose|fistul|colecao|colecoes|pneumotorax|embolia|infarto|rotura|processo expansivo)\b/.test(n)) {
    return "critical";
  }
  if (/\b(lesao|nodulo|massa|calculo|dilatacao|estenose|fratura|edema|derrame|inflamator|cisto|hernia|artrose|tendin|bursite|ruptura|colelit|linfonod|espessamento|laceracao|expansiv)\b/.test(n)) {
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

function goldFindingsFromImpression(impression) {
  return splitSentences(impression).map((sentence) => {
    const finding = {
      finding: sentence,
      severity: severityFor(sentence),
    };
    const lat = lateralityFor(sentence);
    if (lat) finding.laterality = lat;
    const measurements = measurementsFor(sentence);
    if (measurements.length > 0) finding.measurements = measurements;
    if (/\b(sem|nao ha|nao se observa|ausencia de)\b/i.test(norm(sentence))) finding.negated = true;
    return finding;
  });
}

function inferRegion(exam, findings) {
  const n = norm(`${exam} ${findings}`);
  if (/\b(cranio|encefalo|cerebr|face|seios da face)\b/.test(n)) return "head";
  if (/\b(torax|pulmao|pulmonar|mediastino)\b/.test(n)) return "chest";
  if (/\b(abdome|abdominal|figado|pancreas|baco|bilia)\b/.test(n)) return "abdomen";
  if (/\b(coluna|lombar|cervical|toracica)\b/.test(n)) return "spine";
  if (/\b(pelve|pelvica|utero|ovar|prostata|reto)\b/.test(n)) return "pelvis";
  if (/\b(mama|mamografia)\b/.test(n)) return "breast";
  if (/\b(tireoide|tireoid)\b/.test(n)) return "thyroid";
  if (/\b(pescoco|cervical)\b/.test(n)) return "neck";
  if (/\b(rim|renal|ureter|bexiga|urinari)\b/.test(n)) return "urinary";
  return "unknown";
}

function difficultyFor(goldFindings, findings) {
  if (goldFindings.some((g) => g.severity === "critical") || goldFindings.length >= 4 || findings.length > 1200) return "hard";
  if (goldFindings.some((g) => g.severity === "major") || goldFindings.length >= 2 || findings.length > 700) return "medium";
  return "easy";
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function htmlBlock(title, findings, impression) {
  const findingsHtml = escapeHtml(findings).replace(/\n+/g, "<br>");
  const impressionHtml = escapeHtml(impression).replace(/\n+/g, "<br>");
  return `<center><b>${escapeHtml(title.toUpperCase())}</b></center><br><br><b>Achados</b><br>${findingsHtml}<br><br><b>Conclusao</b><br>${impressionHtml}`;
}

function guidelineExpectationsFromReport(reportHtml) {
  const expectations = [];
  const hasRecommendation = /recomenda[çc][aã]o|sugere-se|bi[oó]psia|pun[çc][aã]o|controle|seguimento|tratamento|magnifica[çc][aã]o|correla[çc][aã]o/i.test(reportHtml);

  const birads = /(?:acr\s+)?bi-?rads(?:\s*®|\s*\u00ae)?\s*[:\s]?\s*(\d[a-c]?)/i.exec(reportHtml);
  if (birads) {
    expectations.push({
      guidelineId: "birads",
      expectedClassification: `BI-RADS ${birads[1].toUpperCase()}`,
      ...(hasRecommendation ? { recommendationRequired: true } : {}),
    });
  }

  const tirads = /(?:acr\s+)?ti-?rads\s*[:\s]?\s*(\d)/i.exec(reportHtml);
  if (tirads) {
    expectations.push({
      guidelineId: "tirads",
      expectedClassification: `TI-RADS ${tirads[1]}`,
      ...(hasRecommendation ? { recommendationRequired: true } : {}),
    });
  }

  const lirads = /li-?rads\s*[:\s]?\s*((?:LR[-\s]?)?[1-5M](?:\s*[a-c])?)/i.exec(reportHtml);
  if (lirads) {
    expectations.push({
      guidelineId: "lirads",
      expectedClassification: `LI-RADS ${lirads[1].toUpperCase()}`,
    });
  }

  return expectations;
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function buildCandidate(group) {
  const lines = stripAdministrativeLines(group.chunks.join("\n"));
  const sections = splitSections(lines);
  const findings = paragraph(sections.findings.length > 0 ? sections.findings : sections.preamble.slice(1));
  const impression = paragraph(sections.impression);
  const redactedFindings = redactCalendarDates(findings);
  const redactedImpression = redactCalendarDates(impression);

  if (redactedFindings.length < 180 || redactedFindings.length > 2400) return null;
  if (redactedImpression.length < 24 || redactedImpression.length > 900) return null;

  const goldFindings = goldFindingsFromImpression(redactedImpression);
  if (goldFindings.length === 0) return null;

  const region = inferRegion(group.exam, redactedFindings);
  const difficulty = difficultyFor(goldFindings, redactedFindings);
  const referenceReport = htmlBlock(group.exam, redactedFindings, redactedImpression);
  return {
    sourceIndex: group.sourceIndex,
    groupKey: `${group.modality.code}:${region}`,
    sourceHash: fingerprint(`${group.exam}\n${redactedFindings}\n${redactedImpression}`),
    case: {
      label: group.exam,
      synthetic: false,
      schemaVersion: "1.0.0-private-controlled-report",
      exam: `${group.exam}. Modalidade: ${group.modality.label}.`,
      findings: redactedFindings,
      locale: "pt-BR",
      tags: ["private", "controlled-corpus", group.modality.code, region, difficulty],
      goldFindings,
      referenceReport,
      criticalFindings: goldFindings.filter((g) => g.severity === "critical" && !g.negated).map((g) => g.finding),
      guidelineExpectations: guidelineExpectationsFromReport(referenceReport),
      patientContext: {
        indication: "Fixture privado controlado; identificadores diretos e datas de calendario foram removidos.",
      },
      difficulty,
    },
  };
}

function selectDiverse(candidates, limit) {
  const buckets = new Map();
  for (const candidate of candidates) {
    if (!buckets.has(candidate.groupKey)) buckets.set(candidate.groupKey, []);
    buckets.get(candidate.groupKey).push(candidate);
  }

  const keys = Array.from(buckets.entries())
    .sort((a, b) => a[1][0].sourceIndex - b[1][0].sourceIndex)
    .map(([key]) => key);
  const selected = [];
  const seen = new Set();

  while (selected.length < limit) {
    let progressed = false;
    for (const key of keys) {
      const bucket = buckets.get(key);
      while (bucket.length > 0 && seen.has(bucket[0].sourceHash)) bucket.shift();
      if (bucket.length === 0) continue;
      const item = bucket.shift();
      seen.add(item.sourceHash);
      selected.push(item);
      progressed = true;
      if (selected.length === limit) break;
    }
    if (!progressed) break;
  }

  return selected.sort((a, b) => a.sourceIndex - b.sourceIndex);
}

const args = parseArgs(process.argv.slice(2));
const csvPath = args.csv;
const outPath = args.out ?? "cases/private/synthetic-demo.pt-BR.json";
const limit = Number(args.limit ?? DEFAULT_LIMIT);

if (!csvPath) {
  console.error("Usage: node scripts/import-merged-public-cases.mjs --csv <merged.csv> [--out cases/private/synthetic-demo.pt-BR.json] [--limit 120]");
  process.exit(1);
}

const rows = parseCsv(readFileSync(csvPath, "utf8").replace(/^\uFEFF/, ""));
const groups = groupRows(rows);
const candidates = groups.map(buildCandidate).filter(Boolean);
const selected = selectDiverse(candidates, limit);

if (selected.length < limit) {
  throw new Error(`Only ${selected.length} valid cases found; need ${limit}.`);
}

const cases = selected.map((item, index) => ({
  id: `PRIVATE-PTBR-${String(index + 1).padStart(3, "0")}`,
  ...item.case,
}));

writeFileSync(outPath, `${JSON.stringify(cases, null, 2)}\n`);

const byGroup = new Map();
for (const item of selected) byGroup.set(item.groupKey, (byGroup.get(item.groupKey) ?? 0) + 1);
console.log(`Read ${rows.length} CSV rows, reconstructed ${groups.length} report groups.`);
console.log(`Valid candidates: ${candidates.length}. Wrote ${cases.length} cases to ${outPath}.`);
console.log("Selected strata:");
for (const [key, count] of Array.from(byGroup.entries()).sort()) {
  console.log(`  ${key}: ${count}`);
}
