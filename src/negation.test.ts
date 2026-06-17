import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasNegationCue, isFindingNegated } from "./extract.js";
import { getDefaultCriticalExtractor } from "./extractors/critical-extractor.js";
import { deriveExamMeta } from "./classify.js";
import { runStructuralChecks } from "./evaluators/structural.js";

describe("clause-scoped negation (isFindingNegated)", () => {
  it("keeps a positive finding positive when a later clause is negated", () => {
    const s = "Grade III splenic laceration, without active contrast extravasation.";
    assert.equal(isFindingNegated(s, "splenic laceration", "en-US"), false);
    assert.equal(isFindingNegated(s, "active contrast extravasation", "en-US"), true);
  });

  it("handles pt-BR prefix negation per clause", () => {
    const s = "Pequena colecao subdural hiperatenue ao longo da foice. Sem desvio da linha media.";
    assert.equal(isFindingNegated("Pequena colecao subdural hiperatenue ao longo da foice", "colecao subdural", "pt-BR"), false);
    assert.equal(isFindingNegated("Sem desvio da linha media", "desvio da linha media", "pt-BR"), true);
  });
});

describe("hasNegationCue", () => {
  it("detects pt-BR and en-US negation openers", () => {
    assert.equal(hasNegationCue("Sem desvio da linha media", "pt-BR"), true);
    assert.equal(hasNegationCue("No intracranial hemorrhage", "en-US"), true);
    assert.equal(hasNegationCue("Left lobe and isthmus without nodules", "en-US"), true);
  });
  it("does not flag positive statements", () => {
    assert.equal(hasNegationCue("Occlusion of the M1 segment of the left MCA", "en-US"), false);
  });

  it("does not treat uncertainty phrases as absent findings", () => {
    assert.equal(hasNegationCue("Não sendo possível afastar pequeno trombo associado", "pt-BR"), false);
    assert.equal(hasNegationCue("Nefrolitíase não obstrutiva à direita", "pt-BR"), false);
  });
});

describe("critical extractor: pertinent negatives are not false positives", () => {
  const ex = getDefaultCriticalExtractor();
  it("does not count 'no intracranial hemorrhage' as a hallucinated critical", () => {
    const html =
      "<center><b>CT ANGIOGRAPHY OF THE HEAD</b></center><br><b>Findings</b><br>" +
      "Occlusion of the M1 segment of the left middle cerebral artery. No intracranial hemorrhage." +
      "<br><b>Impression</b><br>Left M1 occlusion.";
    const r = ex.detect(["occlusion of the M1 segment of the left middle cerebral artery"], html, "en-US");
    assert.equal(r.falsePositives.length, 0);
    assert.equal(r.truePositives.length, 1);
  });

  it("pt-BR: 'Sem desvio da linha media' is not a false positive", () => {
    const html =
      "<center><b>TC DE CRANIO</b></center><br><b>Achados</b><br>" +
      "Pequena colecao subdural hiperatenue ao longo da foice cerebral. Sem desvio da linha media." +
      "<br><b>Conclusao</b><br>Colecao subdural.";
    const r = ex.detect(["colecao subdural hiperatenue ao longo da foice cerebral"], html, "pt-BR");
    assert.equal(r.falsePositives.length, 0);
  });
});

describe("R02 laterality: negated contralateral side is not a swap", () => {
  it("passes when the report documents the normal opposite lobe", () => {
    const meta = deriveExamMeta("Thyroid ultrasound, synthetic demonstration.", "Solid hypoechoic nodule in the right thyroid lobe.", "en-US");
    const html =
      "<center><b>THYROID ULTRASOUND</b></center><br><b>Findings</b><br>" +
      "Solid hypoechoic nodule in the right thyroid lobe, measuring 1.8 cm. " +
      "Left lobe and isthmus without nodules." +
      "<br><b>Impression</b><br>Right thyroid nodule, ACR TI-RADS 5.";
    const findings = "Solid hypoechoic nodule in the right thyroid lobe. Left lobe and isthmus without nodules.";
    const checks = runStructuralChecks(html, meta, findings, "en-US");
    const r02 = checks.find((c) => c.id === "R02");
    assert.ok(r02, "R02 must run when laterality present");
    assert.equal(r02!.passed, true, `R02 should pass, got: ${r02!.evidence}`);
  });

  it("still catches a real laterality swap on a positive finding", () => {
    const meta = deriveExamMeta("Chest CT", "Large right pleural effusion.", "en-US");
    const html =
      "<center><b>CHEST CT</b></center><br><b>Findings</b><br>" +
      "Large left pleural effusion." +
      "<br><b>Impression</b><br>Left pleural effusion.";
    const checks = runStructuralChecks(html, meta, "Large right pleural effusion.", "en-US");
    const r02 = checks.find((c) => c.id === "R02");
    assert.equal(r02!.passed, false);
    assert.match(String(r02!.evidence), /SWAP/);
  });
});
