import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateCritical } from "./crit.js";
import type { BenchCase, Check, ExamMeta, GoldFinding, LocaleKey } from "../types.js";

const META: ExamMeta = {
  modality: "CT", contrast: false, region: "head",
  normalizedExam: "", normalizedFindings: "", abnormalStudy: true,
  expectedTitleTokens: [], expectedRegionTokens: [],
};

function critChecks(gold: GoldFinding[], reportHtml: string, locale: LocaleKey): Check[] {
  const benchCase: BenchCase = { id: "c", exam: "ct head", findings: gold.map((g) => g.finding).join(". "), locale, goldFindings: gold };
  return evaluateCritical(reportHtml, benchCase, locale, META, []).checks;
}
const cg01 = (checks: Check[]) => checks.find((c) => c.id === "CG01");

// A compound AFFIRMED critical gold label that appends an unrelated pertinent
// negative ("Acute hemorrhage, no midline shift") must still gate: omitting the
// affirmed critical must produce a failed critical-recall check (CG01). A whole
// label hasNegationCue() check used to drop these from the gate entirely.

describe("evaluateCritical: compound affirmed critical labels are gated (clause-scoped)", () => {
  it("en-US: omitting an affirmed compound critical fails CG01", () => {
    const checks = critChecks([{ finding: "Acute hemorrhage, no midline shift", severity: "critical" }], "<b>Findings</b><br>No acute intracranial abnormality.", "en-US");
    const c = cg01(checks);
    assert.ok(c, "CG01 must be emitted (label is gated)");
    assert.equal(c!.severity, "critical");
    assert.equal(c!.passed, false, c!.evidence);
  });

  it("pt-BR: omitting an affirmed compound critical fails CG01", () => {
    const checks = critChecks([{ finding: "Hematoma subdural agudo, sem desvio da linha media", severity: "critical" }], "<b>Achados</b><br>Sem alteracoes agudas.", "pt-BR");
    const c = cg01(checks);
    assert.ok(c);
    assert.equal(c!.passed, false, c!.evidence);
  });

  it("catches the negation-first ordering too", () => {
    const checks = critChecks([{ finding: "No midline shift, acute subdural hematoma", severity: "critical" }], "<b>Findings</b><br>No acute abnormality.", "en-US");
    assert.equal(cg01(checks)?.passed, false);
  });

  it("detection intact: a correctly reported compound critical passes CG01", () => {
    const checks = critChecks([{ finding: "Acute hemorrhage, no midline shift", severity: "critical" }], "<b>Findings</b><br>Acute hemorrhage in the right frontal lobe. No midline shift.", "en-US");
    assert.equal(cg01(checks)?.passed, true, JSON.stringify(checks));
  });
});

describe("evaluateCritical: pure pertinent negatives are NOT gated (no over-gating)", () => {
  it("en-US negated critical with a recognized anchor is excluded", () => {
    assert.equal(cg01(critChecks([{ finding: "No acute hemorrhage", severity: "critical" }], "<b>Findings</b><br>Normal study.", "en-US")), undefined);
  });

  it("pt-BR negated critical with a recognized anchor is excluded", () => {
    assert.equal(cg01(critChecks([{ finding: "Sem hemorragia", severity: "critical" }], "<b>Achados</b><br>Estudo normal.", "pt-BR")), undefined);
  });

  it("anchor-less negated critical is excluded (no opposite-direction regression)", () => {
    // "torsion"/"appendicitis" are not in CRITICAL_KEYWORDS, so the clause-anchor
    // path does not apply; the whole-label fallback must still drop these.
    assert.equal(cg01(critChecks([{ finding: "No testicular torsion", severity: "critical" }], "<b>Findings</b><br>Normal.", "en-US")), undefined);
    assert.equal(cg01(critChecks([{ finding: "No acute appendicitis", severity: "critical" }], "<b>Findings</b><br>Normal.", "en-US")), undefined);
    assert.equal(cg01(critChecks([{ finding: "Sem torcao ovariana", severity: "critical" }], "<b>Achados</b><br>Normal.", "pt-BR")), undefined);
  });
});
