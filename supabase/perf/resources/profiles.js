import http from 'k6/http';
import { check, group } from 'k6';
import { logFailure } from '../utils/log-failure.js';

const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

export function profilesRun(baseUrl, headers, otherUserId) {
  const targetId = otherUserId || FAKE_UUID;

  group('profiles', () => {
    group('GET /profiles', () => {
      const res = http.get(`${baseUrl}/profiles`, { headers, tags: { name: 'GET /profiles' } });
      check(res, { 'status 200': (r) => r.status === 200 });
      logFailure('GET /profiles', res);
    });

    group('GET /profiles/me', () => {
      const res = http.get(`${baseUrl}/profiles/me`, { headers, tags: { name: 'GET /profiles/me' } });
      check(res, { 'status 200': (r) => r.status === 200 });
      logFailure('GET /profiles/me', res);
    });

    group('PATCH /profiles/me', () => {
      const res = http.patch(
        `${baseUrl}/profiles/me`,
        JSON.stringify({ full_name: 'Perf Test User' }),
        { headers, tags: { name: 'PATCH /profiles/me' } },
      );
      check(res, { 'status 200 or 403': (r) => r.status === 200 || r.status === 403 });
      logFailure('PATCH /profiles/me', res, [200, 403]);
    });

    group('PATCH /profiles/:id/role', () => {
      // 404 if targetId is FAKE_UUID (PGRST116 → 404)
      const res = http.patch(
        `${baseUrl}/profiles/${targetId}/role`,
        JSON.stringify({ role: 'member' }),
        { headers, tags: { name: 'PATCH /profiles/:id/role' } },
      );
      check(res, { 'status 200 or 403 or 404': (r) => r.status === 200 || r.status === 403 || r.status === 404 });
      logFailure('PATCH /profiles/:id/role', res, [200, 403, 404]);
    });
  });
}
