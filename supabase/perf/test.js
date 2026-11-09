import http from 'k6/http';
import { check, group, sleep } from 'k6';

import { authRun } from './resources/auth.js';
import { itemsRun } from './resources/items.js';
import { locationsRun } from './resources/locations.js';
import { movementsRun } from './resources/movements.js';
import { paymentsRun } from './resources/payments.js';
import { profilesRun } from './resources/profiles.js';
import { reportsRun } from './resources/reports.js';
import { stockRun } from './resources/stock.js';
import { usersRun } from './resources/users.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

export const options = {
  scenarios: {
    // Load scenario: ramps VUs up to the project goal and stresses every
    // resource endpoint except auth (auth has its own lifecycle below).
    load: {
      executor: 'ramping-vus',
      exec: 'default',
      stages: [
        { duration: '15s', target: 2 },    // baseline
        { duration: '30s', target: 10 },   // ramp up
        { duration: '10s', target: 50 },   // stress
        { duration: '30s', target: 150 },  // project goal: 100–150 concurrent users
      ],
    },

    // Auth scenario: independent of the ramp. Each VU signs up on its first
    // iteration, refreshes once, then exercises the auth endpoints every
    // iteration for the full run. Using per-vu-iterations keeps the auth
    // lifecycle deterministic — refresh is first-iteration-only in authRun,
    // so GoTrue's serialized DB writes are never thundering-herded.
    auth: {
      executor: 'per-vu-iterations',
      exec: 'authDefault',
      vus: 50,
      iterations: 10,
      maxDuration: '3m',
    },
  },
  thresholds: {
    // http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000', 'p(99)<1500'],
    // createUser runs bcrypt + GoTrue — amortized, not a hot path
    'http_req_duration{name:POST /users}': ['p(99)<2000'],
  },
};

// Runs once before VUs start. Logs in, fetches seed IDs, and passes everything
// to every VU via `data`.
export function setup() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({
      email: __ENV.PERF_TEST_EMAIL,
      password: __ENV.PERF_TEST_PASSWORD,
    }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /auth/login' } },
  );

  check(res, { 'login successful': (r) => r.status === 200 });

  // Guard: a non-200 (rate-limited IP, locked admin, wrong creds) yields no
  // .session — fail loudly with the body instead of throwing on undefined.
  const body = res.json();
  if (res.status !== 200 || !body?.session?.access_token) {
    throw new Error(`setup() login failed (status=${res.status}): ${JSON.stringify(body)}`);
  }
  const token = body.session.access_token;
  const authHeaders = { Authorization: *** ${token}`, 'Content-Type': 'application/json' };

  const itemsRes = http.get(`${BASE_URL}/items`, { headers: authHeaders, tags: { name: 'GET /items' } });
  let itemId = itemsRes.status === 200 ? (itemsRes.json()[0]?.id ?? null) : null;

  if (!itemId) {
    const r = http.post(`${BASE_URL}/items`, JSON.stringify({ type: 'perf-seed-type', name: 'perf-seed-item', model: 'perf-seed-model' }), { headers: authHeaders, tags: { name: 'setup: seed item' } });
    if (r.status === 201) itemId = r.json()?.id ?? null;
  }

  const locsRes = http.get(`${BASE_URL}/locations`, { headers: authHeaders, tags: { name: 'GET /locations' } });
  let locationId = locsRes.status === 200 ? (locsRes.json()[0]?.id ?? null) : null;

  if (!locationId) {
    const r = http.post(`${BASE_URL}/locations`, JSON.stringify({ name: 'perf-seed-location' }), { headers: authHeaders, tags: { name: 'setup: seed location' } });
    if (r.status === 201) locationId = r.json()?.id ?? null;
  }

  // Give the seed item plenty of stock so check-in/out don't hit capacity during the run
  if (itemId && locationId) {
    http.post(`${BASE_URL}/movements/adjust`, JSON.stringify({ item_id: itemId, location_id: locationId, quantity: 500, capacity: 5000 }), { headers: authHeaders, tags: { name: 'setup: adjust stock' } });
    // 422 "nothing to change" if already at those values — that's fine
  }

  const meRes = http.get(`${BASE_URL}/profiles/me`, { headers: authHeaders, tags: { name: 'GET /profiles/me' } });
  const myId = meRes.status === 200 ? (meRes.json()?.id ?? null) : null;

  const profilesRes = http.get(`${BASE_URL}/profiles`, { headers: authHeaders, tags: { name: 'GET /profiles' } });
  const otherUserId = profilesRes.status === 200
    ? (profilesRes.json().find((p) => p.id !== myId)?.id ?? null)
    : null;

  return { token, itemId, locationId, otherUserId };
}

// Load scenario:
export default function (data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
    'Content-Type': 'application/json',
  };

  group('health', () => {
    const res = http.get(`${BASE_URL}/health`, { tags: { name: 'GET /health' } });
    check(res, { 'status 200': (r) => r.status === 200 });
  });

  itemsRun(BASE_URL, headers, data.itemId);
  locationsRun(BASE_URL, headers, data.locationId);
  movementsRun(BASE_URL, headers, data.itemId, data.locationId);
  paymentsRun(BASE_URL, headers, data.locationId, data.otherUserId);
  profilesRun(BASE_URL, headers, data.otherUserId);
  reportsRun(BASE_URL, headers);
  stockRun(BASE_URL, headers);
  usersRun(BASE_URL, headers);

  sleep(1);
}

// Auth lifecycle scenario:
export function authDefault() {
  authRun(BASE_URL);
  sleep(1);
}

// Runs once after all VUs finish. Deletes every auth.users row whose email
// starts with 'perf-probe-' using the GoTrue admin API.
export function teardown() {
  const svcKey = __ENV.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcKey) {
    console.warn('teardown: SUPABASE_SERVICE_ROLE_KEY not set — skipping perf user cleanup');
    return;
  }

  const supabaseUrl = __ENV.SUPABASE_URL || 'http://localhost:54321';
  const adminHeaders = {
    Authorization: `Bearer ${svcKey}`,
    apikey: svcKey,
    'Content-Type': 'application/json',
  };

  const teardownTag = { tags: { name: '__teardown__' } };

  const listRes = http.get(`${supabaseUrl}/auth/v1/admin/users?per_page=1000`, { headers: adminHeaders, ...teardownTag });
  if (listRes.status !== 200) {
    console.error(`teardown: failed to list users (${listRes.status})`);
    return;
  }

  const perfUsers = (listRes.json().users || []).filter(u => u.email?.startsWith('perf-probe-'));
  console.log(`teardown: deleting ${perfUsers.length} perf user(s)`);

  for (const user of perfUsers) {
    http.del(`${supabaseUrl}/auth/v1/admin/users/${user.id}`, null, { headers: adminHeaders, ...teardownTag });
  }
}
