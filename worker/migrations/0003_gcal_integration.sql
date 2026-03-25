-- Google Calendar integration tables
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS gcal_connections (
  npub            TEXT    PRIMARY KEY,
  google_email    TEXT    NOT NULL,
  access_token_enc  TEXT  NOT NULL,  -- AES-256-GCM encrypted, base64url
  access_token_iv   TEXT  NOT NULL,
  access_token_tag  TEXT  NOT NULL,
  refresh_token_enc TEXT  NOT NULL,
  refresh_token_iv  TEXT  NOT NULL,
  refresh_token_tag TEXT  NOT NULL,
  token_expiry    INTEGER NOT NULL,   -- unix seconds
  key_version     INTEGER NOT NULL DEFAULT 1,
  status          TEXT    NOT NULL DEFAULT 'active', -- active | needs_reauth | sync_failed
  last_sync_at    INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS gcal_calendars (
  id               TEXT    PRIMARY KEY,  -- internal UUID
  npub             TEXT    NOT NULL,
  provider_cal_id  TEXT    NOT NULL,     -- Google calendar ID
  name             TEXT    NOT NULL,
  primary_cal      INTEGER NOT NULL DEFAULT 0,  -- boolean
  selected         INTEGER NOT NULL DEFAULT 1,  -- boolean
  color            TEXT,
  timezone         TEXT,
  sync_token       TEXT,
  watch_channel_id TEXT,
  watch_expiry     INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (npub) REFERENCES gcal_connections(npub) ON DELETE CASCADE,
  UNIQUE (npub, provider_cal_id)
);

CREATE INDEX IF NOT EXISTS idx_gcal_calendars_npub ON gcal_calendars(npub);
CREATE INDEX IF NOT EXISTS idx_gcal_calendars_watch ON gcal_calendars(watch_channel_id);
CREATE INDEX IF NOT EXISTS idx_gcal_calendars_watch_expiry ON gcal_calendars(watch_expiry);

CREATE TABLE IF NOT EXISTS gcal_events (
  id               TEXT    PRIMARY KEY,  -- internal UUID
  npub             TEXT    NOT NULL,
  calendar_id      TEXT    NOT NULL,     -- references gcal_calendars.id
  provider_event_id TEXT   NOT NULL,
  title            TEXT    NOT NULL DEFAULT '',
  description      TEXT,
  location         TEXT,
  start_iso        TEXT    NOT NULL,
  end_iso          TEXT    NOT NULL,
  all_day          INTEGER NOT NULL DEFAULT 0,
  status           TEXT    NOT NULL DEFAULT 'confirmed',  -- confirmed | tentative | cancelled
  html_link        TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (calendar_id) REFERENCES gcal_calendars(id) ON DELETE CASCADE,
  UNIQUE (npub, calendar_id, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_gcal_events_npub ON gcal_events(npub);
CREATE INDEX IF NOT EXISTS idx_gcal_events_calendar ON gcal_events(calendar_id);
CREATE INDEX IF NOT EXISTS idx_gcal_events_start ON gcal_events(npub, start_iso);
