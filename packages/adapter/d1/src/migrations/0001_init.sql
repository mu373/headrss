PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE app_passwords (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_version INTEGER NOT NULL,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE feeds (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  site_url TEXT,
  favicon_url TEXT,
  etag TEXT,
  last_modified TEXT,
  last_fetched_at INTEGER,
  fetch_error_count INTEGER NOT NULL DEFAULT 0,
  next_fetch_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  custom_title TEXT,
  read_cursor_item_id INTEGER,
  UNIQUE (user_id, feed_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE TABLE labels (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE subscription_labels (
  subscription_id INTEGER NOT NULL,
  label_id INTEGER NOT NULL,
  PRIMARY KEY (subscription_id, label_id),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  feed_id INTEGER NOT NULL,
  guid TEXT NOT NULL,
  title TEXT,
  url TEXT,
  author TEXT,
  content TEXT,
  summary TEXT,
  published_at INTEGER NOT NULL,
  crawl_time_ms INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (feed_id, guid),
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE TABLE item_states (
  item_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  is_read INTEGER,
  is_starred INTEGER NOT NULL DEFAULT 0,
  starred_at INTEGER,
  PRIMARY KEY (item_id, user_id),
  CHECK (is_read IN (0, 1) OR is_read IS NULL),
  CHECK (is_starred IN (0, 1)),
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE item_labels (
  user_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  label_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id, label_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
);

CREATE TABLE feed_credentials (
  id INTEGER PRIMARY KEY,
  feed_id INTEGER NOT NULL UNIQUE,
  auth_type TEXT NOT NULL,
  credentials_encrypted BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE TABLE rate_limits (
  ip TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY (ip, endpoint)
);

CREATE INDEX idx_items_feed_published
  ON items(feed_id, published_at DESC, id DESC);

CREATE INDEX idx_subscriptions_user
  ON subscriptions(user_id);

CREATE INDEX idx_subscriptions_user_feed
  ON subscriptions(user_id, feed_id);

CREATE INDEX idx_feeds_next_fetch
  ON feeds(next_fetch_at);

CREATE INDEX idx_item_states_user_item
  ON item_states(user_id, item_id);

CREATE INDEX idx_item_states_user_read_override
  ON item_states(user_id, is_read)
  WHERE is_read IS NOT NULL;

CREATE INDEX idx_item_states_user_starred
  ON item_states(user_id, is_starred)
  WHERE is_starred = 1;

CREATE INDEX idx_subscription_labels_label
  ON subscription_labels(label_id);

CREATE INDEX idx_item_labels_user_item
  ON item_labels(user_id, item_id);

CREATE INDEX idx_item_labels_label
  ON item_labels(label_id);

CREATE INDEX idx_labels_user
  ON labels(user_id);

CREATE INDEX idx_items_published
  ON items(published_at);

CREATE INDEX idx_app_passwords_user
  ON app_passwords(user_id);
