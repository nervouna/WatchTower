ALTER TABLE push_subscriptions
ADD COLUMN app_id TEXT NOT NULL DEFAULT 'io.damao.watchtower'
CHECK (app_id IN ('io.damao.watchtower', 'io.damao.watchtower.dev'));
