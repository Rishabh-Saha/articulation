-- Dedicated free-plan D1 database. Stores quota counters only, never journal data or videos.
CREATE TABLE IF NOT EXISTS analysis_limits (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  day TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_started INTEGER NOT NULL
);
