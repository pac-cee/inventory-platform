import http from 'k6/http';
import { check, group, sleep } from 'k6';
import exec from 'k6/execution';
import { logFailure } from '../utils/log-failure.js';

// Per-VU state — module-level vars survive across iterations for the same VU
// but are never shared between VUs.
let vuToken = null;
let vuRefreshToken = null;
let vuEmail = null;
let vuPassword = null;

const PASS_A = 'password123';
const PASS_B = 'password456';

export function authRun(baseUrl) {
  group('auth', () => {
    // First iteration only: signup + refresh.
    // Refresh is intentionally here and not in the per-iteration block.
    // GoTrue token rotation is a serialized DB write; calling it every
    // iteration under 150 VUs saturates the local Postgres connection pool
    // and produces 20 s waits. Once per VU is realistic and sufficient.
    if (exec.vu.iterationInInstance === 0) {
      vuEmail = `perf-probe-vu${exec.vu.idInTest}@example.com`;
      vuPassword = PASS_A;

      group('POST /auth/signup', () => {
        const res = http.post(
          `${baseUrl}/auth/signup`,
          JSON.stringify({ email: vuEmail, password: vuPassword, full_name: 'Perf VU' }),
          { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /auth/signup' } },
        );
        check(res, { 'status 201': (r) => r.status === 201 });
        logFailure('POST /auth/signup', res, [201]);
        if (res.status === 201) {
          vuToken = res.json()?.session?.access_token ?? null;
          vuRefreshToken = res.json()?.session?.refresh_token ?? null;
        }
      });

      // Fallback: user already exists from a previous interrupted run
      if (!vuToken) {
        const res = http.post(
          `${baseUrl}/auth/login`,
          JSON.stringify({ email: vuEmail, password: vuPassword }),
          { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /auth/login' } },
        );
        if (res.status === 200) {
          vuToken = res.json()?.session?.access_token ?? null;
          vuRefreshToken = res.json()?.session?.refresh_token ?? null;
        }
      }

      // Stagger refresh calls across VUs so they don't all hit GoTrue
      // simultaneously. VU 1 waits 0.3 s, VU 50 waits 15 s.
      sleep(exec.vu.idInTest * 0.3);

      group('POST /auth/refresh', () => {
        if (!vuRefreshToken) return;
        const res = http.post(
          `${baseUrl}/auth/refresh`,
          JSON.stringify({ refresh_token: vuRefreshToken }),
          { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /auth/refresh' } },
        );
        check(res, { 'status 200': (r) => r.status === 200 });
        logFailure('POST /auth/refresh', res);
        if (res.status === 200) {
          vuToken = res.json()?.session?.access_token ?? vuToken;
          vuRefreshToken = res.json()?.session?.refresh_token ?? vuRefreshToken;
        }
      });

      // Change-password is a rare user action (not a hot path). Once per VU
      // gives coverage and realistic bcrypt load without hammering the CPU
      // 500 times across iterations.
      group('POST /auth/change-password', () => {
        if (!vuToken) return;
        const h = { Authorization: `Bearer ${vuToken}`, 'Content-Type': 'application/json' };
        const newPassword = PASS_B;
        const res = http.post(
          `${baseUrl}/auth/change-password`,
          JSON.stringify({ current_password: vuPassword, new_password: newPassword }),
          { headers: h, tags: { name: 'POST /auth/change-password' } },
        );
        check(res, { 'status 204': (r) => r.status === 204 });
        logFailure('POST /auth/change-password', res, [204]);
        if (res.status === 204) vuPassword = newPassword;
      });
    }

    if (!vuToken) return;

    const h = { Authorization: `Bearer ${vuToken}`, 'Content-Type': 'application/json' };

    // Every iteration:

    group('GET /auth/me', () => {
      const res = http.get(`${baseUrl}/auth/me`, { headers: h, tags: { name: 'GET /auth/me' } });
      check(res, { 'status 200': (r) => r.status === 200 });
      logFailure('GET /auth/me', res);
    });

    // Mini login → logout: stresses both endpoints every iteration without
    // disrupting the VU's main session (vuToken stays untouched).
    group('POST /auth/login', () => {
      const res = http.post(
        `${baseUrl}/auth/login`,
        JSON.stringify({ email: vuEmail, password: vuPassword }),
        { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /auth/login' } },
      );
      check(res, { 'status 200': (r) => r.status === 200 });
      logFailure('POST /auth/login', res);

      if (res.status !== 200) return;
      const miniToken = res.json()?.session?.access_token ?? null;
      if (!miniToken) return;

      group('POST /auth/logout', () => {
        const logoutRes = http.post(
          `${baseUrl}/auth/logout`,
          null,
          { headers: { Authorization: `Bearer ${miniToken}`, 'Content-Type': 'application/json' }, tags: { name: 'POST /auth/logout' } },
        );
        check(logoutRes, { 'status 204': (r) => r.status === 204 });
        logFailure('POST /auth/logout', logoutRes, [204]);
      });
    });
  });
}
