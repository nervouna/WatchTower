CREATE TABLE feedback_allowlist (
  user_id TEXT PRIMARY KEY,
  note TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE entity_feedback ADD COLUMN updated_by_user_id TEXT;
