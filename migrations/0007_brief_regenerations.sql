PRAGMA foreign_keys = ON;

CREATE TABLE brief_regenerations (
  job_id TEXT PRIMARY KEY,
  brief_date TEXT NOT NULL REFERENCES briefs(brief_date) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  requested_user_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE UNIQUE INDEX idx_brief_regenerations_active_date
  ON brief_regenerations(brief_date)
  WHERE status IN ('queued', 'processing');

CREATE INDEX idx_brief_regenerations_date_created
  ON brief_regenerations(brief_date, created_at DESC);
