import http from 'k6/http';
import { check, group } from 'k6';
import { logFailure } from '../utils/log-failure.js';

const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

export function movementsRun(baseUrl, headers, itemId, locationId) {
  const item = itemId || FAKE_UUID;
  const location = locationId || FAKE_UUID;

  group('movements', () => {
    group('GET /movements', () => {
      const res = http.get(`${baseUrl}/movements?limit=50`, { headers, tags: { name: 'GET /movements' } });
      check(res, { 'status 200': (r) => r.status === 200 });
      logFailure('GET /movements', res);
    });

    group('GET /movements?mine=true', () => {
      const res = http.get(`${baseUrl}/movements?mine=true&limit=50`, { headers, tags: { name: 'GET /movements?mine=true' } });
      check(res, { 'status 200': (r) => r.status === 200 });
      logFailure('GET /movements?mine=true', res);
    });

    group('POST /movements/check-in', () => {
      // 422 when quantity already at capacity ceiling (check_violation 23514)
      const res = http.post(
        `${baseUrl}/movements/check-in`,
        JSON.stringify({ item_id: item, location_id: location, quantity: 1 }),
        { headers, tags: { name: 'POST /movements/check-in' } },
      );
      check(res, { 'status 201 or 403 or 422': (r) => r.status === 201 || r.status === 403 || r.status === 422 });
      logFailure('POST /movements/check-in', res, [201, 403, 422]);
    });

    group('POST /movements/check-out', () => {
      // Stock may run out under load — check_violation (23514) maps to 422
      const res = http.post(
        `${baseUrl}/movements/check-out`,
        JSON.stringify({ item_id: item, location_id: location, quantity: 1 }),
        { headers, tags: { name: 'POST /movements/check-out' } },
      );
      check(res, { 'status 201 or 403 or 422': (r) => r.status === 201 || r.status === 403 || r.status === 422 });
      logFailure('POST /movements/check-out', res, [201, 403, 422]);
    });

    group('POST /movements', () => {
      const res = http.post(
        `${baseUrl}/movements`,
        JSON.stringify({ item_id: item, location_id: location, delta: 1, reason: 'return' }),
        { headers, tags: { name: 'POST /movements' } },
      );
      check(res, { 'status 201 or 403': (r) => r.status === 201 || r.status === 403 });
      logFailure('POST /movements', res, [201, 403]);
    });

    group('POST /movements/finish', () => {
      // 422 if item is not marked finishable; 422 if stock constraint hit
      const res = http.post(
        `${baseUrl}/movements/finish`,
        JSON.stringify({ item_id: item, location_id: location, quantity: 1 }),
        { headers, tags: { name: 'POST /movements/finish' } },
      );
      check(res, { 'status 201 or 403 or 422': (r) => r.status === 201 || r.status === 403 || r.status === 422 });
      logFailure('POST /movements/finish', res, [201, 403, 422]);
    });

    group('POST /movements/destroy', () => {
      // 422 if stock constraint hit
      const res = http.post(
        `${baseUrl}/movements/destroy`,
        JSON.stringify({ item_id: item, location_id: location, quantity: 1 }),
        { headers, tags: { name: 'POST /movements/destroy' } },
      );
      check(res, { 'status 201 or 403 or 422': (r) => r.status === 201 || r.status === 403 || r.status === 422 });
      logFailure('POST /movements/destroy', res, [201, 403, 422]);
    });

    group('POST /movements/adjust', () => {
      // Admin-only; 422 if no change (current already matches target)
      const res = http.post(
        `${baseUrl}/movements/adjust`,
        JSON.stringify({ item_id: item, location_id: location, quantity: 50, capacity: 200 }),
        { headers, tags: { name: 'POST /movements/adjust' } },
      );
      check(res, { 'status 201 or 403 or 422': (r) => r.status === 201 || r.status === 403 || r.status === 422 });
      logFailure('POST /movements/adjust', res, [201, 403, 422]);
    });

    group('POST /movements/:id/undo', () => {
      // FAKE_UUID — exercises auth + lookup path; returns 404
      const res = http.post(
        `${baseUrl}/movements/${FAKE_UUID}/undo`,
        null,
        { headers, tags: { name: 'POST /movements/:id/undo' } },
      );
      check(res, { 'status 404 or 403 or 422': (r) => r.status === 404 || r.status === 403 || r.status === 422 });
      logFailure('POST /movements/:id/undo', res, [404, 403, 422]);
    });
  });
}
