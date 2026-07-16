CREATE TABLE entity_feedback (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  feedback TEXT NOT NULL CHECK (feedback IN ('follow', 'irrelevant', 'uninteresting')),
  source_brief_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
