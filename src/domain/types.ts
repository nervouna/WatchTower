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
  items: BriefItem[];
}

export interface NarrationScript {
  opening_zh: string;
  items: Array<{ entity_id: string; text_zh: string }>;
  closing_zh: string;
}

export type BriefAudio =
  | { status: "pending" }
  | { status: "failed" }
  | {
      status: "ready";
      url: string;
      durationSeconds: number;
      generatedAt: string;
      transcript: string;
      provider: "xiaomi-mimo";
      synthetic: true;
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
