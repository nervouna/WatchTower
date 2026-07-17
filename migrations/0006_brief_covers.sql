PRAGMA foreign_keys = ON;

CREATE TABLE brief_covers (
  brief_date TEXT PRIMARY KEY REFERENCES briefs(brief_date) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  object_key TEXT,
  fal_request_id TEXT,
  fal_status_url TEXT,
  fal_response_url TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  generated_at TEXT
);

CREATE INDEX idx_brief_covers_status ON brief_covers(status, updated_at);
