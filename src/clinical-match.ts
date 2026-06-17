import { normalizeLoose, stripTags } from "./normalize.js";

const CLINICAL_STOPWORDS = new Set([
  // Common report glue.
  "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das",
  "e", "em", "no", "na", "nos", "nas", "por", "para", "com", "sem", "ao", "aos",
  "pela", "pelo", "pelas", "pelos", "entre", "sobre", "ate", "apos", "durante",
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "with", "without", "for",
  // Boilerplate around impression-derived labels.
  "esse", "essa", "esses", "essas", "achado", "achados", "imagem", "imagens",
  "sugere", "sugerem", "sugerindo", "sugestivo", "sugestiva", "sugestivos", "sugestivas",
  "compativel", "compativeis", "caracteristica", "caracteristicas", "cujas", "cuja", "cujo",
  "custas", "custa", "devido", "relacionado", "relacionada", "relacionados", "relacionadas",
  "natureza", "processo", "hipotese", "hipoteses", "considerar", "deve", "devem", "podendo",
  "afastar", "avaliacao", "correlacao", "clinica", "clinico", "metodo",
  // Non-finding normality tokens should not make two texts clinically match.
  "normal", "normais", "habitual", "habituais", "preservado", "preservada", "preservados",
  "preservadas", "conservado", "conservada", "conservados", "conservadas", "ausencia",
]);

const MANAGEMENT_OR_DIFFERENTIAL_RX =
  /\b(?:sugere\s*-\s*se|recomenda\s*-\s*se|recomenda(?:mos|do|da)?|correlacao|correlacionar|endoscop|laringoscop|seguimento|acompanhamento|controle|biopsia|puncao|deve\s*-\s*se\s+considerar|nao\s+se\s+podendo\s+afastar|nao\s+e\s+possivel\s+afastar|deste\s+exame\s+e\s+feita\s+considerando|considerando\s+tambem\s+os\s+dados\s+do\s+exame)\b/i;

export function clinicalTokens(value: string): string[] {
  const normalized = normalizeLoose(stripTags(value))
    .replace(/[^a-z0-9]+/g, " ");
  const tokens = normalized
    .split(/\s+/)
    .filter((token) => token.length > 2 && !CLINICAL_STOPWORDS.has(token));
  return Array.from(new Set(tokens));
}

export function clinicalComparableText(value: string): string {
  return clinicalTokens(value).join(" ");
}

function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 5 && longer.startsWith(shorter.slice(0, 5))) return true;
  return false;
}

function tokenHit(token: string, haystackTokens: string[]): boolean {
  return haystackTokens.some((candidate) => tokenMatches(token, candidate));
}

export function clinicalTokenCoverage(needle: string, haystack: string): number {
  const needleTokens = clinicalTokens(needle);
  if (needleTokens.length === 0) return 0;
  const haystackTokens = clinicalTokens(haystack);
  const hits = needleTokens.filter((token) => tokenHit(token, haystackTokens)).length;
  return hits / needleTokens.length;
}

export function clinicalTokenSimilarity(a: string, b: string): number {
  const tokensA = clinicalTokens(a);
  const tokensB = clinicalTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const aInB = tokensA.filter((token) => tokenHit(token, tokensB)).length;
  const bInA = tokensB.filter((token) => tokenHit(token, tokensA)).length;
  return (aInB / tokensA.length + bInA / tokensB.length) / 2;
}

export function isManagementOrDifferentialGold(value: string): boolean {
  return MANAGEMENT_OR_DIFFERENTIAL_RX.test(normalizeLoose(value));
}

function splitClinicalClauses(value: string): string[] {
  return stripTags(value.replace(/<br\s*\/?>/gi, "\n"))
    .split(/[.\n;]/)
    .map((clause) => clause.trim())
    .filter((clause) => clinicalTokens(clause).length >= 3);
}

export function sourceBackedFindingCoverage(goldFinding: string, reportText: string, sourceText: string): number {
  const goldTokens = clinicalTokens(goldFinding);
  if (goldTokens.length === 0) return 0;
  if (clinicalTokenCoverage(goldFinding, reportText) === 0) return 0;

  let bestClause = "";
  let bestGoldHits = 0;
  let bestGoldCoverage = 0;
  for (const clause of splitClinicalClauses(sourceText)) {
    const clauseTokens = clinicalTokens(clause);
    const goldHits = goldTokens.filter((token) => tokenHit(token, clauseTokens)).length;
    const goldCoverage = goldHits / goldTokens.length;
    if (goldHits > bestGoldHits || (goldHits === bestGoldHits && goldCoverage > bestGoldCoverage)) {
      bestGoldHits = goldHits;
      bestGoldCoverage = goldCoverage;
      bestClause = clause;
    }
  }

  if (!bestClause) return 0;
  const enoughGoldAnchor = bestGoldHits >= Math.min(2, goldTokens.length) || bestGoldCoverage >= 0.5;
  if (!enoughGoldAnchor) return 0;
  return clinicalTokenCoverage(bestClause, reportText);
}

export function isFindingClinicallyReflected(
  finding: string,
  reportText: string,
  sourceText = "",
): boolean {
  const directCoverage = clinicalTokenCoverage(finding, reportText);
  if (directCoverage >= 0.5) return true;
  if (!sourceText) return false;
  return sourceBackedFindingCoverage(finding, reportText, sourceText) >= 0.55;
}
