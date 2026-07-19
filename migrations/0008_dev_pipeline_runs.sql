CREATE TABLE dev_pipeline_runs (
  run_id TEXT PRIMARY KEY,
  stage TEXT NOT NULL CHECK (stage IN ('collect', 'draft', 'final', 'recovery')),
  target_date TEXT NOT NULL,
  requested_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  outcome TEXT,
  error_code TEXT,
  worker_version_tag TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE (stage, target_date)
);

CREATE INDEX idx_dev_pipeline_runs_created_at
  ON dev_pipeline_runs(created_at DESC);
