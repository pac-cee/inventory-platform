import http from 'k6/http';
import { check, group } from 'k6';
import { logFailure } from '../utils/log-failure.js';

export function stockRun(baseUrl, headers) {
  group('stock', () => {
    group('GET /stock', () => {
      const res = http.get(`${baseUrl}/stock`, { headers, tags: { name: 'GET /stock' } });
      check(res, { 'status 200': (r) => r.status === 200 });
      logFailure('GET /stock', res);
    });
  });
}
