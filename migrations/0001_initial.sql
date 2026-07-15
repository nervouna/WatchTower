PRAGMA foreign_keys = ON;

CREATE TABLE ingestion_runs (
  id TEXT PRIMARY KEY,
  target_date TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('collect', 'draft', 'final', 'recovery')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  source_status_json TEXT NOT NULL DEFAULT '{}',
  attempt_count INTEGER NOT NULL DEFAULT 1,
  error_code TEXT,
  usage_credits INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (target_date, stage)
);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  target_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('hacker-news', 'product-hunt', 'github', 'kickstarter')),
  platform_url TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  original_url TEXT,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL,
  extracted_content TEXT,
  search_score REAL NOT NULL DEFAULT 0,
  search_rank INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (target_date, source, platform_url),
  UNIQUE (target_date, source, canonical_key)
);

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE,
  canonical_title TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  first_seen_date TEXT NOT NULL,
  last_seen_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE briefs (
  brief_date TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('complete', 'partial')),
  publish_at TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  headline TEXT NOT NULL,
  intro TEXT NOT NULL,
  missing_sources_json TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL
);

CREATE TABLE brief_items (
  id TEXT PRIMARY KEY,
  brief_date TEXT NOT NULL REFERENCES briefs(brief_date) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  why_it_matters TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  continuity TEXT NOT NULL CHECK (continuity IN ('new', 'continuing')),
  material_change TEXT,
  previous_brief_date TEXT REFERENCES briefs(brief_date),
  UNIQUE (brief_date, rank)
);

CREATE TABLE item_sources (
  id TEXT PRIMARY KEY,
  brief_item_id TEXT NOT NULL REFERENCES brief_items(id) ON DELETE CASCADE,
  candidate_id TEXT REFERENCES candidates(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('hacker-news', 'product-hunt', 'github', 'kickstarter')),
  kind TEXT NOT NULL CHECK (kind IN ('platform', 'original')),
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  UNIQUE (brief_item_id, source, url)
);

CREATE INDEX idx_runs_target_stage ON ingestion_runs(target_date, stage);
CREATE INDEX idx_candidates_target_source ON candidates(target_date, source, search_rank);
CREATE INDEX idx_candidates_updated_at ON candidates(updated_at);
CREATE INDEX idx_entities_last_seen ON entities(last_seen_date DESC);
CREATE INDEX idx_briefs_publish_at ON briefs(publish_at DESC, brief_date DESC);
CREATE INDEX idx_brief_items_date_rank ON brief_items(brief_date, rank);
CREATE INDEX idx_item_sources_item ON item_sources(brief_item_id);
