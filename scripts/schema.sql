-- Application schema (Sprint 1).
-- The `user` / `session` / `account` / `verification` tables are owned and
-- migrated by better-auth (`npm run auth:migrate`) and are intentionally not
-- redefined here.

CREATE TABLE IF NOT EXISTS course (
  id               TEXT PRIMARY KEY,
  title            TEXT    NOT NULL,
  subtitle         TEXT    NOT NULL DEFAULT '',
  description      TEXT    NOT NULL,
  thumbnail_url    TEXT    NOT NULL,
  price_jpy        INTEGER NOT NULL CHECK (price_jpy >= 0),
  instructor_name  TEXT    NOT NULL,
  instructor_title TEXT    NOT NULL DEFAULT '',
  level            TEXT    NOT NULL DEFAULT 'beginner'
                     CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  published        INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_course_published
  ON course (published, sort_order);

CREATE TABLE IF NOT EXISTS chapter (
  id             TEXT    PRIMARY KEY,
  course_id      TEXT    NOT NULL REFERENCES course (id) ON DELETE CASCADE,
  position       INTEGER NOT NULL CHECK (position > 0),
  title          TEXT    NOT NULL,
  -- bunny.net Stream: the library GUID of an already-uploaded video, plus the
  -- playback/iframe URL. Sprint 2 stores and surfaces them; playback itself is
  -- wired up in a later sprint.
  bunny_video_id TEXT    NOT NULL DEFAULT '',
  video_url      TEXT    NOT NULL DEFAULT '',
  -- Sprint 4: filename of the local placeholder clip under data/videos/ that
  -- stands in for the bunny.net Stream asset until the real account exists.
  -- src/lib/video-source.ts is the only place that reads it; once bunny.net is
  -- connected, bunny_video_id wins and this column simply stops being used.
  video_asset    TEXT    NOT NULL DEFAULT '',
  duration_seconds REAL  NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (course_id, position)
);

CREATE INDEX IF NOT EXISTS idx_chapter_course
  ON chapter (course_id, position);

-- Binary payloads uploaded from the admin screens (course thumbnails and
-- chapter attachments). Bytes live on disk under data/uploads/; this table is
-- the catalogue and is what the download route resolves against.
CREATE TABLE IF NOT EXISTS upload (
  id            TEXT    PRIMARY KEY,
  original_name TEXT    NOT NULL,
  stored_name   TEXT    NOT NULL,
  mime_type     TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL CHECK (size_bytes >= 0),
  kind          TEXT    NOT NULL DEFAULT 'resource'
                  CHECK (kind IN ('thumbnail', 'resource')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chapter_resource (
  id         TEXT    PRIMARY KEY,
  chapter_id TEXT    NOT NULL REFERENCES chapter (id) ON DELETE CASCADE,
  upload_id  TEXT    NOT NULL REFERENCES upload (id) ON DELETE CASCADE,
  label      TEXT    NOT NULL,
  position   INTEGER NOT NULL DEFAULT 1 CHECK (position > 0),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chapter_resource_chapter
  ON chapter_resource (chapter_id, position);

-- ---------------------------------------------------------------------------
-- Sprint 4: entitlements and viewing progress
-- ---------------------------------------------------------------------------

-- One row per (user, course) entitlement. This is the table Sprint 3's Stripe
-- Checkout flow will write to on `checkout.session.completed`: `provider` and
-- `provider_ref` are already shaped for it ('stripe' + the Checkout Session /
-- PaymentIntent id). Until then rows are created manually from the admin area
-- (provider = 'manual'), see src/app/admin/actions.ts.
CREATE TABLE IF NOT EXISTS purchase (
  id           TEXT    PRIMARY KEY,
  user_id      TEXT    NOT NULL,
  course_id    TEXT    NOT NULL REFERENCES course (id) ON DELETE CASCADE,
  amount_jpy   INTEGER NOT NULL DEFAULT 0 CHECK (amount_jpy >= 0),
  status       TEXT    NOT NULL DEFAULT 'paid'
                 CHECK (status IN ('paid', 'refunded')),
  provider     TEXT    NOT NULL DEFAULT 'manual'
                 CHECK (provider IN ('manual', 'stripe')),
  provider_ref TEXT    NOT NULL DEFAULT '',
  purchased_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_user
  ON purchase (user_id, status);

-- Per-user, per-chapter playback position and completion flag. `position_seconds`
-- powers "resume where you left off"; `completed` powers the per-chapter check
-- marks and the course-level percentage.
CREATE TABLE IF NOT EXISTS chapter_progress (
  id               TEXT    PRIMARY KEY,
  user_id          TEXT    NOT NULL,
  course_id        TEXT    NOT NULL REFERENCES course (id) ON DELETE CASCADE,
  chapter_id       TEXT    NOT NULL REFERENCES chapter (id) ON DELETE CASCADE,
  position_seconds REAL    NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
  duration_seconds REAL    NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  completed        INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  completed_at     TEXT,
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_chapter_progress_course
  ON chapter_progress (user_id, course_id);
