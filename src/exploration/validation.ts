import type {
  ExplorationQuality,
  ExplorationSections,
  ExplorationSource,
} from "../domain/types";

type ValidationResult =
  | { ok: true; value: ExplorationSections; quality: ExplorationQuality }
  | { ok: false; errors: string[] };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, minimum: number, maximum: number): value is string {
  const length = typeof value === "string" ? Array.from(value.trim()).length : 0;
  return typeof value === "string" && length >= minimum && length <= maximum;
}

function sourceIds(value: unknown, allowed: ReadonlySet<string>): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 6 &&
    value.every((id) => typeof id === "string" && allowed.has(id)) && new Set(value).size === value.length;
}

function cited(value: unknown, allowed: ReadonlySet<string>, minimum: number, maximum: number): boolean {
  return record(value) && exactKeys(value, ["text", "sourceIds"]) && text(value.text, minimum, maximum) && sourceIds(value.sourceIds, allowed);
}

function hasUrlField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUrlField);
  if (!record(value)) return false;
  return Object.entries(value).some(([key, child]) => key.toLowerCase().includes("url") || hasUrlField(child));
}

function hasUrlText(value: unknown): boolean {
  if (typeof value === "string") return /https?:\/\//iu.test(value);
  if (Array.isArray(value)) return value.some(hasUrlText);
  return record(value) && Object.values(value).some(hasUrlText);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key)) && allowed.every((key) => key in value);
}

function collectCitations(value: unknown, citations: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCitations(item, citations);
  } else if (record(value)) {
    if (Array.isArray(value.sourceIds)) {
      for (const id of value.sourceIds) if (typeof id === "string") citations.add(id);
    }
    for (const child of Object.values(value)) collectCitations(child, citations);
  }
}

export function validateExplorationOutput(value: unknown, sources: readonly ExplorationSource[]): ValidationResult {
  const errors: string[] = [];
  const allowed = new Set(sources.map((source) => source.id));
  if (!record(value)) return { ok: false, errors: ["NOT_OBJECT"] };
  if (!exactKeys(value, ["overview", "relatedProducts", "perspectives", "industry", "watchNext"])) errors.push("UNKNOWN_OR_MISSING_FIELD");
  if (hasUrlField(value)) errors.push("URL_FIELD_FORBIDDEN");
  if (hasUrlText(value)) errors.push("URL_TEXT_FORBIDDEN");
  if (!cited(value.overview, allowed, 40, 800)) errors.push("INVALID_OVERVIEW");

  const related = value.relatedProducts;
  if (!Array.isArray(related) || related.length > 6 || related.some((item) =>
    !record(item) || !exactKeys(item, ["name", "relation", "summary", "sourceIds"]) ||
    !text(item.name, 1, 80) || !text(item.relation, 1, 80) ||
    !text(item.summary, 20, 400) || !sourceIds(item.sourceIds, allowed))) {
    errors.push("INVALID_RELATED_PRODUCTS");
  }

  const perspectives = value.perspectives;
  if (!Array.isArray(perspectives) || perspectives.length > 6 || perspectives.some((item) =>
    !record(item) || !exactKeys(item, ["label", "summary", "sourceIds"]) ||
    !text(item.label, 1, 40) || !text(item.summary, 20, 400) ||
    !sourceIds(item.sourceIds, allowed))) {
    errors.push("INVALID_PERSPECTIVES");
  }

  if (value.industry !== null && !cited(value.industry, allowed, 20, 600)) errors.push("INVALID_INDUSTRY");
  const watchNext = value.watchNext;
  if (!Array.isArray(watchNext) || watchNext.length > 6 || watchNext.some((item) =>
    !record(item) || !exactKeys(item, ["signal", "sourceIds"]) ||
    !text(item.signal, 10, 240) || !sourceIds(item.sourceIds, allowed))) {
    errors.push("INVALID_WATCH_NEXT");
  }
  if (errors.length > 0) return { ok: false, errors };

  const citations = new Set<string>();
  collectCitations(value, citations);
  const domains = new Set(sources.filter((source) => citations.has(source.id)).map((source) => source.domain));
  if (domains.size < 2) return { ok: false, errors: ["INSUFFICIENT_CITATION_DOMAINS"] };

  const sections: ExplorationSections = {
    overview: value.overview as ExplorationSections["overview"],
    relatedProducts: value.relatedProducts as ExplorationSections["relatedProducts"],
    perspectives: value.perspectives as ExplorationSections["perspectives"],
    industry: value.industry as ExplorationSections["industry"],
    watchNext: value.watchNext as ExplorationSections["watchNext"],
  };
  const quality: ExplorationQuality = sections.relatedProducts.length > 0 &&
    sections.perspectives.length > 0 && sections.industry !== null && sections.watchNext.length > 0
    ? "complete"
    : "partial";
  return { ok: true, value: sections, quality };
}
