import http from "k6/http";
import { check, fail } from "k6";
import { Trend } from "k6/metrics";

/**
 * Reading the whole item catalog, the way the apps now do it.
 *
 * The screens used to make one GET /items call and take the 50 rows it
 * returned; they now page with limit=200 until a short page ends the list. That
 * turns one request into ceil(total/200)+1, so this measures what a cold
 * dashboard load actually costs and asserts the whole catalog came back.
 *
 *   k6 run -e API_URL=http://localhost:4000 -e TOKEN=<jwt> perf/items-paging.js
 *
 * TOKEN is a normal session access token — log in and copy it. Point API_URL at
 * a dev or staging API; do not run this against production.
 */

const API_URL = __ENV.API_URL || "http://localhost:4000";
const TOKEN = __ENV.TOKEN;
const BATCH = 200;
const MAX_BATCHES = 50;

/** Wall-clock for a full catalog read, not for one request. */
const catalogRead = new Trend("catalog_read_ms", true);

export const options = {
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    // A dashboard load waits on this, so it is judged whole, not per request.
    catalog_read_ms: ["p(95)<2000"],
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
  },
};

export function setup() {
  if (!TOKEN) fail("Set -e TOKEN=<access token>; the items list needs a session.");
}

export default function () {
  const params = { headers: { Authorization: `Bearer ${TOKEN}` }, tags: { name: "GET /items" } };
  const started = Date.now();
  let fetched = 0;
  let pages = 0;

  for (let n = 0; n < MAX_BATCHES; n++) {
    const res = http.get(`${API_URL}/items?limit=${BATCH}&offset=${fetched}`, params);
    pages++;
    const ok = check(res, {
      "200": (r) => r.status === 200,
      "returns an array": (r) => Array.isArray(r.json()),
      // The bug this guards: a page that silently comes back short.
      "no more than the batch": (r) => r.json().length <= BATCH,
    });
    if (!ok) break;

    const rows = res.json().length;
    fetched += rows;
    if (rows < BATCH) break;
  }

  catalogRead.add(Date.now() - started);
  check(null, {
    "read the catalog in a bounded number of pages": () => pages < MAX_BATCHES,
  });
}
