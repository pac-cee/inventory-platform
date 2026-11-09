import http from 'k6/http';
import { check, group } from 'k6';
import exec from 'k6/execution';
import { logFailure } from '../utils/log-failure.js';

export function usersRun(baseUrl, headers) {
  group('users', () => {
    // Create a disposable user for this iteration; PATCH and DELETE operate on it.
    // Teardown cleans up any that slip through (email prefix: perf-probe-).
    const email = `perf-probe-vu${exec.vu.idInTest}-iter${exec.vu.iterationInInstance}@example.com`;
    let createdId = null;

    group('POST /users', () => {
      const res = http.post(
        `${baseUrl}/users`,
        JSON.stringify({ email, password: 'password123' }),
        { headers, tags: { name: 'POST /users' } },
      );
      check(res, { 'status 201 or 403': (r) => r.status === 201 || r.status === 403 });
      logFailure('POST /users', res, [201, 403]);
      if (res.status === 201) createdId = res.json()?.user?.id ?? null;
    });

    group('PATCH /users/:id/block', () => {
      if (!createdId) return;
      const res = http.patch(
        `${baseUrl}/users/${createdId}/block`,
        JSON.stringify({ blocked: true }),
        { headers, tags: { name: 'PATCH /users/:id/block' } },
      );
      check(res, { 'status 200 or 403': (r) => r.status === 200 || r.status === 403 });
      logFailure('PATCH /users/:id/block', res, [200, 403]);
    });

    group('PATCH /users/:id', () => {
      if (!createdId) return;
      const res = http.patch(
        `${baseUrl}/users/${createdId}`,
        JSON.stringify({ full_name: 'Perf Updated' }),
        { headers, tags: { name: 'PATCH /users/:id' } },
      );
      check(res, { 'status 200 or 403': (r) => r.status === 200 || r.status === 403 });
      logFailure('PATCH /users/:id', res, [200, 403]);
    });

    group('DELETE /users/:id', () => {
      if (!createdId) return;
      const res = http.del(
        `${baseUrl}/users/${createdId}`,
        null,
        { headers, tags: { name: 'DELETE /users/:id' } },
      );
      check(res, { 'status 204 or 403': (r) => r.status === 204 || r.status === 403 });
      logFailure('DELETE /users/:id', res, [204, 403]);
    });
  });
}
