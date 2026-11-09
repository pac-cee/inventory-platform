# API Performance Tests

k6 load tests for the Express API. All commands run from the **repo root**.

## Setup

Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/

Copy the env template and fill in an admin account:

```bash
cp supabase/perf/.env.example supabase/perf/.env
```

```dotenv
PERF_TEST_EMAIL=admin@example.com
PERF_TEST_PASSWORD=yourpassword
```

The account must be an admin — several endpoints (`POST /users`, payments) require it.

## Running

```bash
# Run with live terminal output only
npm run api:perf

# Run and write a JSON artifact for the visualizer
npm run api:perf:out
```

`api:perf:out` writes to `supabase/perf/artifacts/results.json`. The `artifacts/` directory is gitignored.

### Manual run (from repo root)

```bash
k6 run -e PERF_TEST_EMAIL=you@example.com -e PERF_TEST_PASSWORD=pass supabase/perf/test.js
```

The `-e` flag passes variables into the script as `__ENV.KEY`. Alternatively, export them in your shell before running and k6 picks them up automatically.

### Named output file

```bash
k6 run supabase/perf/test.js --out json=supabase/perf/artifacts/round4.json
```

### With live web dashboard

```bash
K6_WEB_DASHBOARD=true npm run api:perf:out
```

Opens at `http://localhost:5665` during the run.

## Load profile

Defined in `test.js` under `options.stages`:

| Stage | Duration | Target VUs |
|---|---|---|
| Baseline | 15s | 2 |
| Ramp up | 30s | 10 |
| Stress | 10s | 50 |

## Visualizing results

Open `supabase/perf/k6_endpoint_analyzer.html` in a browser (works as a local file), then drag and drop any artifact from `artifacts/` onto it.

Shows per-endpoint: avg, p50, p95, p99, server wait time (TTFB), request count, and status codes — sorted slowest first.

## Utility SQL

`supabase/snippets/` contains helper queries for local maintenance:

- `clear_perf_users.sql` — deletes users created by the `POST /users` perf test
- `grant_api_privileges.sql` — grants table privileges needed for the test account
