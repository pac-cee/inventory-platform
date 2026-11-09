import http from 'k6/http';
import { check, group } from 'k6';
import { logFailure } from '../utils/log-failure.js';

// The condition report is the heaviest read in the API: two recursive CTEs, a
// lateral join and a json_agg per row. Worth watching as the catalog grows.
export function reportsRun(baseUrl, headers) {
  group('reports', () => {
    group('GET /reports/categories', () => {
      const res = http.get(`${baseUrl}/reports/categories`, {
        headers,
        tags: { name: 'GET /reports/categories' },
      });
      check(res, { 'status 200': (r) => r.status === 200 });
      logFailure('GET /reports/categories', res);
    });

    group('GET /reports/condition', () => {
      const res = http.get(`${baseUrl}/reports/condition`, {
        headers,
        tags: { name: 'GET /reports/condition' },
      });
      check(res, {
        'status 200': (r) => r.status === 200,
        // Specification is what separates two variants of one product; a report
        // missing it silently prints rows that look like duplicates.
        'rows carry specification': (r) => {
          if (r.status !== 200) return false;
          const rows = r.json();
          return !Array.isArray(rows) || rows.length === 0
            ? true
            : Object.prototype.hasOwnProperty.call(rows[0], 'specification');
        },
      });
      logFailure('GET /reports/condition', res);
    });

    group('GET /reports/condition?faulty_only', () => {
      const res = http.get(`${baseUrl}/reports/condition?faulty_only=true`, {
        headers,
        tags: { name: 'GET /reports/condition (faulty)' },
      });
      check(res, { 'status 200': (r) => r.status === 200 });
      logFailure('GET /reports/condition (faulty)', res);
    });
  });
}
