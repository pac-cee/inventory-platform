import http from 'k6/http';
import { check, group } from 'k6';
import { logFailure } from '../utils/log-failure.js';

const FAKE_UUID = '00000000-0000-0000-0000-000000000000';
const PAYMENT_OK = [200, 403];

export function paymentsRun(baseUrl, headers, locationId, otherUserId) {
  const location = locationId || FAKE_UUID;
  const targetUser = otherUserId || FAKE_UUID;

  group('payments', () => {
    group('GET /payments/transactions', () => {
      const res = http.get(`${baseUrl}/payments/transactions?limit=50`, { headers, tags: { name: 'GET /payments/transactions' } });
      check(res, { 'status 200 or 403': (r) => r.status === 200 || r.status === 403 });
      logFailure('GET /payments/transactions', res, PAYMENT_OK);
    });

    group('GET /payments/notifications', () => {
      const res = http.get(`${baseUrl}/payments/notifications`, { headers, tags: { name: 'GET /payments/notifications' } });
      check(res, { 'status 200 or 403': (r) => r.status === 200 || r.status === 403 });
      logFailure('GET /payments/notifications', res, PAYMENT_OK);
    });

    group('GET /payments/budgets', () => {
      const res = http.get(`${baseUrl}/payments/budgets`, { headers, tags: { name: 'GET /payments/budgets' } });
      check(res, { 'status 200 or 403': (r) => r.status === 200 || r.status === 403 });
      logFailure('GET /payments/budgets', res, PAYMENT_OK);
    });

    group('GET /payments/balance', () => {
      // Short timeout — this hits an external MoMo API; don't let one slow call block a VU
      const res = http.get(`${baseUrl}/payments/balance`, { headers, tags: { name: 'GET /payments/balance' }, timeout: '5s' });
      check(res, { 'status 200 or 403': (r) => r.status === 200 || r.status === 403 });
      logFailure('GET /payments/balance', res, PAYMENT_OK);
    });

    group('GET /payments/reports/export', () => {
      const res = http.get(`${baseUrl}/payments/reports/export`, { headers, tags: { name: 'GET /payments/reports/export' } });
      check(res, { 'status 200 or 403': (r) => r.status === 200 || r.status === 403 });
      logFailure('GET /payments/reports/export', res, PAYMENT_OK);
    });

    group('POST /payments/request', () => {
      // 409 if location FK invalid (FAKE_UUID fallback)
      const res = http.post(
        `${baseUrl}/payments/request`,
        JSON.stringify({
          recipient_phone: '+250780000001',
          location_id: location,
          products: [{ name: 'Perf Test Product', quantity: 1, price: 100 }],
        }),
        { headers, tags: { name: 'POST /payments/request' } },
      );
      check(res, { 'status 201 or 403 or 409': (r) => r.status === 201 || r.status === 403 || r.status === 409 });
      logFailure('POST /payments/request', res, [201, 403, 409]);
    });

    group('POST /payments/resolve', () => {
      // FAKE_UUID → 404; exercises auth + pending check
      const res = http.post(
        `${baseUrl}/payments/resolve`,
        JSON.stringify({ id: FAKE_UUID, status: 'rejected' }),
        { headers, tags: { name: 'POST /payments/resolve' } },
      );
      check(res, { 'status 403 or 404': (r) => r.status === 403 || r.status === 404 });
      logFailure('POST /payments/resolve', res, [403, 404]);
    });

    group('POST /payments/budgets', () => {
      const res = http.post(
        `${baseUrl}/payments/budgets`,
        JSON.stringify({ allocated_amount: 500000 }),
        { headers, tags: { name: 'POST /payments/budgets' } },
      );
      check(res, { 'status 200 or 403': (r) => r.status === 200 || r.status === 403 });
      logFailure('POST /payments/budgets', res, PAYMENT_OK);
    });

    group('PATCH /payments/profiles/:id/payment-settings', () => {
      // 404 if targetUser is FAKE_UUID (PGRST116 → 404)
      const res = http.patch(
        `${baseUrl}/payments/profiles/${targetUser}/payment-settings`,
        JSON.stringify({ has_payment_permission: true }),
        { headers, tags: { name: 'PATCH /payments/profiles/:id/payment-settings' } },
      );
      check(res, { 'status 200 or 403 or 404': (r) => r.status === 200 || r.status === 403 || r.status === 404 });
      logFailure('PATCH /payments/profiles/:id/payment-settings', res, [200, 403, 404]);
    });

    group('PATCH /payments/transactions/:id/receipt', () => {
      // FAKE_UUID → 404
      const res = http.patch(
        `${baseUrl}/payments/transactions/${FAKE_UUID}/receipt`,
        JSON.stringify({ receipt_base64: 'data:image/png;base64,iVBORw0KGgo=' }),
        { headers, tags: { name: 'PATCH /payments/transactions/:id/receipt' } },
      );
      check(res, { 'status 200 or 403 or 404': (r) => r.status === 200 || r.status === 403 || r.status === 404 });
      logFailure('PATCH /payments/transactions/:id/receipt', res, [200, 403, 404]);
    });
  });
}
