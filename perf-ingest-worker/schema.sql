CREATE TABLE IF NOT EXISTS perf_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  token_hint TEXT NOT NULL,
  session_id TEXT NOT NULL,
  scene TEXT NOT NULL,
  fps REAL NOT NULL,
  frame_ms_avg REAL NOT NULL,
  frame_ms_p95 REAL NOT NULL,
  long_frame_count INTEGER NOT NULL,
  heap_mb REAL,
  renderer TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_perf_ts ON perf_logs(ts);
CREATE INDEX IF NOT EXISTS idx_perf_session ON perf_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_perf_scene_ts ON perf_logs(scene, ts);
