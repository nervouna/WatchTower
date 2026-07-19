import { SOURCE_KINDS, type GeneratedBrief, type GeneratedBriefItem, type SourceKind } from "./types";

interface CandidateCatalogEntry {
  source: SourceKind;
}

interface ValidationContext {
  candidates: ReadonlyMap<string, CandidateCatalogEntry>;
  entities: ReadonlySet<string>;
  enforceSourceQuota: boolean;
  excludedEntityIds?: ReadonlySet<string>;
}

export type GeneratedBriefValidation =
  | { ok: true; value: GeneratedBrief }
  | { ok: false; errors: string[] };

const URL_PATTERN = /(?:https?:\/\/|www\.)/iu;
const NON_DAILY_HEADER_PATTERN = /(?:本周|周报)/u;

function codePoints(value: string): number {
  return Array.from(value).length;
}

function validLength(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && codePoints(value) >= minimum && codePoints(value) <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsUrl(value: unknown): boolean {
  if (typeof value === "string") return URL_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(containsUrl);
  if (isRecord(value)) return Object.values(value).some(containsUrl);
  return false;
}

function validateItemShape(value: unknown): value is GeneratedBriefItem {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.candidate_ids) &&
    value.candidate_ids.every((entry) => typeof entry === "string") &&
    (typeof value.existing_entity_id === "string" || value.existing_entity_id === null) &&
    typeof value.title_zh === "string" &&
    typeof value.summary_zh === "string" &&
    typeof value.why_it_matters_zh === "string" &&
    Array.isArray(value.tags_zh) &&
    value.tags_zh.every((entry) => typeof entry === "string") &&
    (value.update_kind === "new" || value.update_kind === "continuing") &&
    (typeof value.material_change_zh === "string" || value.material_change_zh === null)
  );
}

export function validateGeneratedBrief(value: unknown, context: ValidationContext): GeneratedBriefValidation {
  const errors = new Set<string>();
  if (!isRecord(value) || !Array.isArray(value.items)) return { ok: false, errors: ["INVALID_STRUCTURE"] };
  if (!validLength(value.headline_zh, 8, 60)) {
    errors.add("FIELD_LENGTH");
    errors.add("FIELD_LENGTH_HEADLINE");
  }
  if (!validLength(value.intro_zh, 40, 180)) {
    errors.add("FIELD_LENGTH");
    errors.add("FIELD_LENGTH_INTRO");
  }
  if (
    (typeof value.headline_zh === "string" && NON_DAILY_HEADER_PATTERN.test(value.headline_zh)) ||
    (typeof value.intro_zh === "string" && NON_DAILY_HEADER_PATTERN.test(value.intro_zh))
  ) {
    errors.add("NON_DAILY_HEADER");
  }
  if (value.items.length === 0) errors.add("EMPTY_ITEMS");
  if (value.items.length > 20 || value.items.some((item) => !validateItemShape(item))) errors.add("INVALID_STRUCTURE");
  if (containsUrl(value)) errors.add("MODEL_URL_FORBIDDEN");

  const assigned = new Set<string>();
  const sourceCounts = new Map<SourceKind, number>();
  for (const rawItem of value.items) {
    if (!validateItemShape(rawItem)) continue;
    if (rawItem.candidate_ids.length === 0) errors.add("INVALID_STRUCTURE");
    if (!validLength(rawItem.title_zh, 2, 80)) {
      errors.add("FIELD_LENGTH");
      errors.add("FIELD_LENGTH_TITLE");
    }
    if (!validLength(rawItem.summary_zh, 60, 240)) {
      errors.add("FIELD_LENGTH");
      errors.add("FIELD_LENGTH_SUMMARY");
    }
    if (!validLength(rawItem.why_it_matters_zh, 20, 120)) {
      errors.add("FIELD_LENGTH");
      errors.add("FIELD_LENGTH_WHY");
    }
    if (
      rawItem.tags_zh.length < 2 ||
      rawItem.tags_zh.length > 4 ||
      rawItem.tags_zh.some((tag) => !validLength(tag, 1, 20))
    ) {
      errors.add("FIELD_LENGTH");
      errors.add("FIELD_LENGTH_TAG");
    }
    if (
      (rawItem.update_kind === "continuing" && !validLength(rawItem.material_change_zh, 1, 240)) ||
      (rawItem.update_kind === "continuing" && rawItem.existing_entity_id === null) ||
      (rawItem.update_kind === "new" && (rawItem.material_change_zh !== null || rawItem.existing_entity_id !== null))
    ) {
      errors.add("INVALID_CONTINUITY");
    }
    if (rawItem.existing_entity_id !== null && !context.entities.has(rawItem.existing_entity_id)) errors.add("UNKNOWN_ENTITY");
    if (rawItem.existing_entity_id !== null && context.excludedEntityIds?.has(rawItem.existing_entity_id)) {
      errors.add("FEEDBACK_EXCLUDED_ENTITY");
    }

    const itemSources = new Set<SourceKind>();
    for (const candidateId of rawItem.candidate_ids) {
      const candidate = context.candidates.get(candidateId);
      if (!candidate) errors.add("UNKNOWN_CANDIDATE");
      else itemSources.add(candidate.source);
      if (assigned.has(candidateId)) errors.add("DUPLICATE_CANDIDATE");
      assigned.add(candidateId);
    }
    for (const source of itemSources) sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  }

  if (context.enforceSourceQuota) {
    const available = new Map<SourceKind, number>();
    for (const candidate of context.candidates.values()) available.set(candidate.source, (available.get(candidate.source) ?? 0) + 1);
    if (SOURCE_KINDS.every((source) => (available.get(source) ?? 0) >= 3)) {
      if (SOURCE_KINDS.some((source) => (sourceCounts.get(source) ?? 0) < 3)) errors.add("SOURCE_QUOTA");
    }
  }

  if (errors.size > 0) return { ok: false, errors: [...errors].sort() };
  const items = value.items.filter(validateItemShape).map((item) => ({
    candidate_ids: [...item.candidate_ids],
    existing_entity_id: item.existing_entity_id,
    title_zh: item.title_zh,
    summary_zh: item.summary_zh,
    why_it_matters_zh: item.why_it_matters_zh,
    tags_zh: [...item.tags_zh],
    update_kind: item.update_kind,
    material_change_zh: item.material_change_zh,
  }));
  return {
    ok: true,
    value: {
      headline_zh: typeof value.headline_zh === "string" ? value.headline_zh : "",
      intro_zh: typeof value.intro_zh === "string" ? value.intro_zh : "",
      items,
    },
  };
}
