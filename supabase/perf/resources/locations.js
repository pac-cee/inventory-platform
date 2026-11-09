import http from 'k6/http';
import { check, group } from 'k6';
import exec from 'k6/execution';
import { logFailure } from '../utils/log-failure.js';

const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

export function locationsRun(baseUrl, headers, locationId) {
  const id = locationId || FAKE_UUID;

  group('locations', () => {
    // Shared within the group so PATCH and DELETE operate on the same row we created
    let createdId = null;

    group('GET /locations', () => {
      const res = http.get(`${baseUrl}/locations`, { headers, tags: { name: 'GET /locations' } });
      check(res, { 'status 200': (r) => r.status === 200 });
      logFailure('GET /locations', res);
    });

    group('GET /locations/:id', () => {
      const res = http.get(`${baseUrl}/locations/${id}`, { headers, tags: { name: 'GET /locations/:id' } });
      check(res, { 'status 200': (r) => r.status === 200 });
      logFailure('GET /locations/:id', res);
    });

    group('POST /locations', () => {
      const name = `perf-loc-vu${exec.vu.idInTest}-it${exec.vu.iterationInInstance}`;
      const res = http.post(
        `${baseUrl}/locations`,
        JSON.stringify({ name }),
        { headers, tags: { name: 'POST /locations' } },
      );
      check(res, { 'status 201 or 403': (r) => r.status === 201 || r.status === 403 });
      logFailure('POST /locations', res, [201, 403]);
      if (res.status === 201) createdId = res.json()?.id ?? null;
    });

    group('PATCH /locations/:id', () => {
      // Use the just-created location; fall back to FAKE_UUID (→ 404) to avoid
      // renaming seeded data when POST was not permitted
      const targetId = createdId || FAKE_UUID;
      const name = `perf-loc-upd-vu${exec.vu.idInTest}-it${exec.vu.iterationInInstance}`;
      const res = http.patch(
        `${baseUrl}/locations/${targetId}`,
        JSON.stringify({ name }),
        { headers, tags: { name: 'PATCH /locations/:id' } },
      );
      check(res, { 'status 200 or 403 or 404': (r) => r.status === 200 || r.status === 403 || r.status === 404 });
      logFailure('PATCH /locations/:id', res, [200, 403, 404]);
    });

    group('DELETE /locations/:id', () => {
      // Delete the location we created — keeps the DB clean across runs
      if (!createdId) return;
      const res = http.del(
        `${baseUrl}/locations/${createdId}`,
        null,
        { headers, tags: { name: 'DELETE /locations/:id' } },
      );
      check(res, { 'status 204 or 403': (r) => r.status === 204 || r.status === 403 });
      logFailure('DELETE /locations/:id', res, [204, 403]);
    });
  });
}
