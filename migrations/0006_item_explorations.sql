PRAGMA foreign_keys = ON;

CREATE TABLE item_explorations (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'researching', 'synthesizing', 'ready', 'failed')),
  quality TEXT CHECK (quality IN ('complete', 'partial')),
  active_job_id TEXT,
  lease_expires_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  content_json TEXT,
  source_catalog_json TEXT,
  evidence_json TEXT,
  prompt_version TEXT NOT NULL DEFAULT 'exploration-v1',
  query_version TEXT NOT NULL DEFAULT 'exploration-v1',
  generated_at TEXT,
  expires_at TEXT,
  retry_at TEXT,
  last_error_code TEXT,
  tavily_credits INTEGER NOT NULL DEFAULT 0,
  deepseek_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE exploration_daily_usage (
  usage_date TEXT PRIMARY KEY,
  reserved_credits INTEGER NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  used_credits INTEGER NOT NULL DEFAULT 0 CHECK (used_credits >= 0),
  jobs_started INTEGER NOT NULL DEFAULT 0 CHECK (jobs_started >= 0),
  jobs_succeeded INTEGER NOT NULL DEFAULT 0 CHECK (jobs_succeeded >= 0),
  jobs_failed INTEGER NOT NULL DEFAULT 0 CHECK (jobs_failed >= 0),
  cache_hits INTEGER NOT NULL DEFAULT 0 CHECK (cache_hits >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_item_explorations_status_lease
  ON item_explorations(status, lease_expires_at);
CREATE INDEX idx_item_explorations_expires
  ON item_explorations(expires_at);
