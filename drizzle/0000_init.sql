CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE kb_versions(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK(kind IN ('knowledge','persona')), text TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE fb_groups(id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, name TEXT, visibility TEXT NOT NULL DEFAULT 'unknown' CHECK(visibility IN ('public','private','unknown')), rules_note TEXT NOT NULL DEFAULT '', allow_selling INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1, added_at TEXT NOT NULL);
CREATE TABLE posts(id TEXT PRIMARY KEY, text TEXT NOT NULL, images TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);
CREATE TABLE post_targets(id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id), group_id TEXT NOT NULL REFERENCES fb_groups(id), scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('scheduled','posting','pending_approval','published','declined','failed','untrackable')),
  reader TEXT NOT NULL DEFAULT 'scrape' CHECK(reader IN ('scrape','browser')), permalink TEXT, fb_post_id TEXT, posted_at TEXT, last_polled_at TEXT, next_poll_at TEXT, error TEXT, screenshot TEXT);
CREATE TABLE comments(id TEXT PRIMARY KEY, target_id TEXT NOT NULL REFERENCES post_targets(id), fb_comment_id TEXT NOT NULL, parent_fb_id TEXT, author_id TEXT, author_name TEXT, text TEXT NOT NULL,
  created_at TEXT, fetched_at TEXT NOT NULL, is_own INTEGER NOT NULL DEFAULT 0, reply_count INTEGER NOT NULL DEFAULT 0, feedback_id TEXT, expansion_token TEXT, UNIQUE(target_id, fb_comment_id));
CREATE TABLE replies(id TEXT PRIMARY KEY, comment_id TEXT NOT NULL UNIQUE REFERENCES comments(id), draft TEXT, final_text TEXT, category TEXT, grounded INTEGER, quotes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK(status IN ('waiting','approved','sending','sent','failed','skipped')), mode TEXT CHECK(mode IN ('manual','auto')), reason TEXT, model TEXT, created_at TEXT NOT NULL, sent_at TEXT, error TEXT);
CREATE TABLE drafts(id TEXT PRIMARY KEY, comment_id TEXT, text TEXT, category TEXT, grounded INTEGER, model TEXT, created_at TEXT NOT NULL);
CREATE TABLE api_calls(id TEXT PRIMARY KEY, day TEXT NOT NULL, route TEXT NOT NULL, cost INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT);
