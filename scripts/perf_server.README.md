# Perf Ingest Server (Test)

## 1) Generate token

```bash
npm run perf:token
```

Copy the printed token and set it in:

- Server env: `PERF_INGEST_TOKEN`
- Client config: `data/game_config.json -> run_rules.perfReporter.bearerToken`

## 2) Run server locally

```bash
PERF_INGEST_TOKEN="<your_token>" npm run perf:server
```

Optional env:

- `PORT` (default `8787`)
- `PERF_STORE_DIR` (default `./perf-logs`)
- `PERF_ALLOW_ORIGIN` (default `*`)
- `PERF_MAX_BODY_BYTES` (default `524288`)

## 3) API

- `POST /perf/ingest` (Bearer required)
- `GET /perf/health`
- `GET /perf/sessions`
- `GET /perf/sessions/:sessionId`

## 4) Deploy to peer domain

If you deploy behind `https://peer.kkopttarr.com`, expose route:

- `https://peer.kkopttarr.com/perf/ingest`

And keep the same `PERF_INGEST_TOKEN` on server side.
