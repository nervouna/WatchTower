PRAGMA foreign_keys = ON;

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  installation_hmac TEXT NOT NULL UNIQUE,
  token_hmac TEXT NOT NULL UNIQUE,
  token_ciphertext TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  app_version TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_success_at TEXT,
  disabled_at TEXT
);

CREATE TABLE brief_push_batches (
  brief_date TEXT PRIMARY KEY REFERENCES briefs(brief_date) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE brief_push_deliveries (
  id TEXT PRIMARY KEY,
  brief_date TEXT NOT NULL REFERENCES briefs(brief_date) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'delivered', 'retry', 'invalid', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT,
  UNIQUE (brief_date, subscription_id)
);

CREATE INDEX idx_push_subscriptions_active ON push_subscriptions(active, updated_at);
CREATE INDEX idx_push_deliveries_status ON brief_push_deliveries(status, updated_at);
