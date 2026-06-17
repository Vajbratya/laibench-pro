/**
 * Critical finding evaluator.
 * If case has criticalFindings gold labels: compute sensitivity/recall/precision/F1.
 * If no gold labels: fall back to structural banned-phrase checks.
 * Score is recall-weighted (missing a critical finding is worse than a false positive).
 */

import { getDefaultCriticalExtractor } from "../extractors/critical-extractor.js";
import { extractCriticalMentions, hasNegationCue } from "../extract.js";
import { clinicalTokenCoverage, isManagementOrDifferentialGold } from "../clinical-match.js";
import { normalizeLoose, stripTags } from "../normalize.js";
import type { BenchCase, Check, EvaluatorResult, ExamMeta, LocaleKey } from "../types.js";

/**
 * Match critical finding labels from gold against mentions in the report,
 * delegating to the active (pluggable) critical-finding extractor. The default
 * is the keyword/substring + token-overlap matcher with negation awareness;
 * swapping in a validated model-based extractor is a one-call change via
 * setDefaultCriticalExtractor (see src/extractors/critical-extractor.ts).
 */
function matchCriticalFindings(goldLabels: string[], reportHtml: string, locale: LocaleKey) {
  return getDefaultCriticalExtractor().detect(goldLabels, reportHtml, locale);
}

function isScoredCriticalLabel(label: string, locale: LocaleKey): boolean {
  return !isManagementOrDifferentialGold(label) && !hasNegationCue(label, locale);
}

function criticalSourceText(benchCase: BenchCase): string {
  return stripTags([
    benchCase.findings,
    benchCase.referenceReport ?? "",
    ...(benchCase.goldFindings ?? []).map((finding) => finding.finding),
  ].join("\n"));
}

function isSourceBackedCriticalMention(text: string, benchCase: BenchCase): boolean {
  const sourceText = criticalSourceText(benchCase);
  return sourceText.length > 0 && clinicalTokenCoverage(text, sourceText) >= 0.55;
}

function withSourceBackedFalsePositivesRemoved(
  result: ReturnType<typeof matchCriticalFindings>,
  benchCase: BenchCase,
) {
  const falsePositives = result.falsePositives.filter((fp) => !isSourceBackedCriticalMention(fp.text, benchCase));
  const excludedFalsePositives = result.falsePositives.filter((fp) => isSourceBackedCriticalMention(fp.text, benchCase));
  const tp = result.truePositives.length;
  const fn = result.falseNegatives.length;
  const fp = falsePositives.length;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
  return { ...result, falsePositives, excludedFalsePositives, recall, precision, f1 };
}

/**
 * Evaluate critical finding detection.
 * Uses gold data when available, falls back to structural checks.
 */
export function evaluateCritical(
  reportHtml: string,
  benchCase: BenchCase,
  locale: LocaleKey,
  _meta: ExamMeta,
  structuralChecks: Check[],
): EvaluatorResult {
  const checks: Check[] = [];
  const details: Record<string, unknown> = {};
  const explicitCriticalFindings = benchCase.criticalFindings ?? [];
  const goldCriticalFindings = (benchCase.goldFindings ?? [])
    .filter((finding) => finding.severity === "critical" && !finding.negated && isScoredCriticalLabel(finding.finding, locale))
    .map((finding) => finding.finding);
  const criticalLabels = (explicitCriticalFindings.length > 0 ? explicitCriticalFindings : goldCriticalFindings)
    .filter((label) => isScoredCriticalLabel(label, locale));

  // Strategy 1: Gold critical finding labels
  if (criticalLabels.length > 0) {
    const result = withSourceBackedFalsePositivesRemoved(
      matchCriticalFindings(criticalLabels, reportHtml, locale),
      benchCase,
    );
    details.mode = "gold-critical";
    details.source = explicitCriticalFindings.length > 0 ? "criticalFindings" : "goldFindings";
    details.truePositives = result.truePositives;
    details.falseNegatives = result.falseNegatives;
    details.falsePositives = result.falsePositives.map((fp) => fp.text);
    details.excludedSourceBackedFalsePositives = result.excludedFalsePositives.map((fp) => fp.text);
    details.recall = result.recall;
    details.precision = result.precision;
    details.f1 = result.f1;

    // Recall check (most important - missing a critical finding is dangerous)
    checks.push({
      dim: "CRIT",
      id: "CG01",
      name: "Critical finding recall",
      severity: "critical",
      passed: result.recall >= 0.9,
      evidence: `recall=${(result.recall * 100).toFixed(0)}% (TP=${result.truePositives.length} FN=${result.falseNegatives.length})`,
    });

    // Each missed critical finding is a separate critical failure
    for (const missed of result.falseNegatives) {
      checks.push({
        dim: "CRIT",
        id: `CG02-${normalizeLoose(missed).replace(/\s+/g, "-").slice(0, 20)}`,
        name: `Missed critical finding: ${missed}`,
        severity: "critical",
        passed: false,
        evidence: `not found in report`,
      });
    }

    // Precision check (false positives are bad but less than false negatives)
    checks.push({
      dim: "CRIT",
      id: "CG03",
      name: "Critical finding precision",
      severity: result.falsePositives.length > 0 ? "critical" : "major",
      passed: result.precision >= 0.7,
      evidence: `precision=${(result.precision * 100).toFixed(0)}% (FP=${result.falsePositives.length})`,
    });

    // F1 check
    checks.push({
      dim: "CRIT",
      id: "CG04",
      name: "Critical finding F1 score",
      severity: "major",
      passed: result.f1 >= 0.8,
      evidence: `F1=${(result.f1 * 100).toFixed(0)}%`,
    });

    // Score: recall-weighted (0.7 recall + 0.3 precision)
    const score = Math.round(result.recall * 70 + result.precision * 30);
    return { dim: "CRIT", score, checks, details };
  }

  if ((benchCase.goldFindings?.length ?? 0) > 0) {
    const sourceBackedCriticalMentions = extractCriticalMentions(reportHtml, locale)
      .filter((fp) => isSourceBackedCriticalMention(fp.text, benchCase));
    const unexpectedCriticalMentions = extractCriticalMentions(reportHtml, locale)
      .filter((fp) => !isSourceBackedCriticalMention(fp.text, benchCase));
    details.mode = "gold-critical-none";
    details.source = "goldFindings";
    details.falsePositives = unexpectedCriticalMentions.map((fp) => fp.text);
    details.excludedSourceBackedFalsePositives = sourceBackedCriticalMentions.map((fp) => fp.text);
    if (unexpectedCriticalMentions.length > 0) {
      checks.push({
        dim: "CRIT",
        id: "CG00",
        name: "No unexpected critical finding",
        severity: "critical",
        passed: false,
        evidence: `unexpected critical mention(s): ${unexpectedCriticalMentions.map((fp) => fp.text).join("; ")}`,
      });
      return { dim: "CRIT", score: 0, checks, details };
    }
    checks.push({
      dim: "CRIT",
      id: "CG00",
      name: "No gold critical finding expected",
      severity: "minor",
      passed: true,
      evidence: "goldFindings contain no affirmative critical-severity finding",
    });
    return { dim: "CRIT", score: 100, checks, details };
  }

  // Strategy 2: Fall back to structural checks
  details.mode = "structural-fallback";
  const critChecks = structuralChecks.filter((c) => c.dim === "CRIT");
  const passCount = critChecks.filter((c) => c.passed).length;
  const totalCount = critChecks.length;
  const score = totalCount > 0 ? Math.round((passCount / totalCount) * 100) : 100;

  return { dim: "CRIT", score, checks: critChecks, details };
}
