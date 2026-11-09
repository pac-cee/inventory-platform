import http from 'k6/http';
import { check, group } from 'k6';
import exec from 'k6/execution';
import { logFailure } from '../utils/log-failure.js';

const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

export function itemsRun(baseUrl, headers, itemId) {
  const id = itemId || FAKE_UUID;

  group('items', () => {
    // Shared within the group so PATCH and DELETE operate on the same row we created
    let createdId = null;

    group('GET /items', () => {
      const res = http.get(`${baseUrl}/items`, { headers, tags: { name: 'GET /items' } });
      check(res, {
        'status 200': (r) => r.status === 200,
        // photo_url is a link, not the bytes. If it ever becomes base64 this
        // response grows by every image and the list is the first thing to hurt.
        'photo_url stays a link': (r) => {
          if (r.status !== 200) return false;
          const items = r.json();
          if (!Array.isArray(items)) return true;
          return items.every((i) => !i.photo_url || /^https?:\/\//i.test(i.photo_url));
        },
      });
      logFailure('GET /items', res);
    });

    group('GET /items?search=', () => {
      const res = http.get(`${baseUrl}/items?search=test&limit=20`, { headers, tags: { name: 'GET /items?search=' } });
      check(res, { 'status 200': (r) => r.status === 200 });
      logFailure('GET /items?search=', res);
    });

    group('GET /items/:id', () => {
      const res = http.get(`${baseUrl}/items/${id}`, { headers, tags: { name: 'GET /items/:id' } });
      check(res, { 'status 200': (r) => r.status === 200 });
      logFailure('GET /items/:id', res);
    });

    group('GET /items/:id/stock', () => {
      const res = http.get(`${baseUrl}/items/${id}/stock`, { headers, tags: { name: 'GET /items/:id/stock' } });
      check(res, { 'status 200': (r) => r.status === 200 });
      logFailure('GET /items/:id/stock', res);
    });

    group('POST /items', () => {
      // Since 0039 an item needs a type, a name AND a model; the SKU is
      // assigned by the server from the type, so it is not sent. A per-VU type
      // keeps each VU on its own SKU counter rather than contending on one.
      const type = `perf-type-vu${exec.vu.idInTest}`;
      const name = `perf-item-vu${exec.vu.idInTest}-it${exec.vu.iterationInInstance}`;
      const model = `perf-model-${exec.vu.iterationInInstance}`;
      const res = http.post(
        `${baseUrl}/items`,
        JSON.stringify({ type, name, model }),
        { headers, tags: { name: 'POST /items' } },
      );
      check(res, { 'status 201 or 403': (r) => r.status === 201 || r.status === 403 });
      logFailure('POST /items', res, [201, 403]);
      if (res.status === 201) createdId = res.json()?.id ?? null;
    });

    group('PATCH /items/:id', () => {
      // Use the just-created item; fall back to seeded id (accepts 200/403/404)
      const targetId = createdId || id;
      const res = http.patch(
        `${baseUrl}/items/${targetId}`,
        JSON.stringify({ specification: 'perf-updated' }),
        { headers, tags: { name: 'PATCH /items/:id' } },
      );
      check(res, { 'status 200 or 403 or 404': (r) => r.status === 200 || r.status === 403 || r.status === 404 });
      logFailure('PATCH /items/:id', res, [200, 403, 404]);
    });

    group('DELETE /items/:id', () => {
      // Delete the item we created — keeps the DB clean across runs
      if (!createdId) return;
      const res = http.del(
        `${baseUrl}/items/${createdId}`,
        null,
        { headers, tags: { name: 'DELETE /items/:id' } },
      );
      check(res, { 'status 204 or 403': (r) => r.status === 204 || r.status === 403 });
      logFailure('DELETE /items/:id', res, [204, 403]);
    });
  });
}
