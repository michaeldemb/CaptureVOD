CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  index_name TEXT,
  timestamp TEXT,
  label TEXT,
  raw TEXT
);
