-- Voice dictation: per-user daily quota tracking
CREATE TABLE IF NOT EXISTS voice_quota (
  npub          TEXT    NOT NULL,
  date          TEXT    NOT NULL,   -- YYYY-MM-DD UTC
  session_count INTEGER NOT NULL DEFAULT 0,
  total_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (npub, date)
);
