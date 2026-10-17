-- Pivnik Run: one row per guest with their best score (all-time board). Additive, re-runnable, touches no existing table.
CREATE TABLE IF NOT EXISTS run_scores (
  user_id BIGINT PRIMARY KEY,
  best_score BIGINT NOT NULL CHECK (best_score >= 0),
  best_char TEXT,
  runs INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS run_scores_best_idx ON run_scores (best_score DESC, updated_at ASC);
