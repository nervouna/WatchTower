export const SOURCE_KINDS = ["hacker-news", "product-hunt", "github", "kickstarter"] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];
export type BriefStatus = "complete" | "partial";
export type PipelineStage = "collect" | "draft" | "final" | "recovery";
export const FEEDBACK_VALUES = ["follow", "irrelevant", "uninteresting"] as const;
export type FeedbackValue = (typeof FEEDBACK_VALUES)[number];

export interface SearchCandidate {
  source: SourceKind;
  title: string;
  platformUrl: string;
  canonicalKey: string;
  canonicalUrl: string;
  snippet: string;
  score: number;
  rank: number;
}

export interface StoredCandidate extends SearchCandidate {
  id: string;
  targetDate: string;
  originalUrl: string | null;
  extractedContent: string | null;
  contentHash: string;
}

export interface GeneratedBrief {
  headline_zh: string;
  intro_zh: string;
  items: GeneratedBriefItem[];
}

export interface GeneratedBriefItem {
  candidate_ids: string[];
  existing_entity_id: string | null;
  title_zh: string;
  summary_zh: string;
  why_it_matters_zh: string;
  tags_zh: string[];
  update_kind: "new" | "continuing";
  material_change_zh: string | null;
}

export interface SourceLink {
  source: SourceKind;
  kind: "platform" | "original";
  label: string;
  url: string;
}

export type Continuity =
  | { kind: "new" }
  | { kind: "continuing"; previousDate: string; materialChange: string };

export interface BriefItem {
  rank: number;
  entityId: string;
  title: string;
  summary: string;
  whyItMatters: string;
  tags: string[];
  continuity: Continuity;
  sources: SourceLink[];
}

export interface BriefPayload {
  date: string;
  status: BriefStatus;
  publishedAt: string;
  generatedAt: string;
  headline: string;
  intro: string;
  missingSources: SourceKind[];
  sourceCounts: Record<SourceKind, number>;
  audio: BriefAudio | null;
  features?: { exploration?: boolean };
  items: BriefItem[];
}

export const EXPLORATION_QUERY_KINDS = ["context", "products", "perspectives", "industry"] as const;
export type ExplorationQueryKind = (typeof EXPLORATION_QUERY_KINDS)[number];
export type ExplorationStatus = "queued" | "researching" | "synthesizing" | "ready" | "failed";
export type ExplorationQuality = "complete" | "partial";

export interface ExplorationSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  queryKind: ExplorationQueryKind;
}

export interface ExplorationEvidenceSource extends ExplorationSource {
  snippet: string;
  score: number;
}

export interface CitedText {
  text: string;
  sourceIds: string[];
}

export interface ExplorationSections {
  overview: CitedText;
  relatedProducts: Array<{ name: string; relation: string; summary: string; sourceIds: string[] }>;
  perspectives: Array<{ label: string; summary: string; sourceIds: string[] }>;
  industry: CitedText | null;
  watchNext: Array<{ signal: string; sourceIds: string[] }>;
}

export interface ExplorationPayload {
  entityId: string;
  title: string;
  status: ExplorationStatus;
  quality?: ExplorationQuality;
  generatedAt?: string;
  expiresAt?: string;
  stale?: boolean;
  refreshing?: boolean;
  sections?: ExplorationSections;
  sources?: ExplorationSource[];
  pollAfterSeconds?: number;
  retryAt?: string;
  refreshLimited?: boolean;
}

export interface ExplorationSeed {
  entityId: string;
  title: string;
  summary: string;
  whyItMatters: string;
  tags: string[];
  canonicalUrl: string;
  sourceUrls: string[];
}

export interface NarrationScript {
  opening_zh: string;
  items: Array<{ entity_id: string; text_zh: string }>;
  closing_zh: string;
}

export type BriefCover =
  | { status: "pending" }
  | { status: "failed" }
  | {
      status: "ready";
      url: string;
      generatedAt: string;
      provider: "fal-ai";
      model: "fal-ai/recraft/v3/text-to-image";
      synthetic: true;
    };

export type BriefAudio =
  | { status: "pending"; cover?: BriefCover | null }
  | { status: "failed"; cover?: BriefCover | null }
  | {
      status: "ready";
      url: string;
      durationSeconds: number;
      generatedAt: string;
      transcript: string;
      provider: "xiaomi-mimo";
      synthetic: true;
      cover?: BriefCover | null;
    };

export interface BriefSummary {
  date: string;
  status: BriefStatus;
  publishedAt: string;
  itemCount: number;
  missingSources: SourceKind[];
}

export interface BriefListPayload {
  briefs: BriefSummary[];
  nextCursor: string | null;
}

export interface EntityFeedback {
  entityId: string;
  value: FeedbackValue;
  sourceBriefDate: string;
  createdAt: string;
  updatedAt: string;
}
