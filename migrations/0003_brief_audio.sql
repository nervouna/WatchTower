PRAGMA foreign_keys = ON;

CREATE TABLE brief_audio (
  brief_date TEXT PRIMARY KEY REFERENCES briefs(brief_date) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  script_json TEXT,
  object_key TEXT,
  duration_seconds REAL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  voice TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  generated_at TEXT
);

CREATE INDEX idx_brief_audio_status ON brief_audio(status, updated_at);
