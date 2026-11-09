import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/models.dart';
import 'package:inventory_mobile/payments_report.dart';

PaymentTransaction tx(String id, String who, double amount, String status, DateTime at) => PaymentTransaction.fromJson({
      'id': id,
      'user_id': 'u',
      'recipient_phone': '0788123456',
      'amount': amount,
      'status': status,
      'location_id': 'l',
      'created_at': at.toUtc().toIso8601String(),
      'profiles': {'full_name': who},
    });

void main() {
  final sample = [
    tx('1', 'Amina', 1000, 'completed', DateTime(2026, 10, 2, 9)),
    tx('2', 'Amina', 500, 'pending', DateTime(2026, 10, 5, 9)),
    tx('3', 'Brian', 4000, 'completed', DateTime(2026, 10, 10, 9)),
    tx('4', 'Brian', 700, 'failed', DateTime(2026, 10, 11, 9)),
    tx('5', 'Brian', 300, 'processing', DateTime(2026, 10, 20, 9)),
    tx('6', '', 200, 'completed', DateTime(2026, 11, 1, 9)),
  ];

  test('inRange is inclusive of both end days and open-ended with null', () {
    expect(inRange(sample, null, null), hasLength(6));
    expect(inRange(sample, DateTime(2026, 10, 5), DateTime(2026, 10, 11)).map((t) => t.id), ['2', '3', '4']);
    expect(inRange(sample, DateTime(2026, 10, 20), null).map((t) => t.id), ['5', '6']);
    expect(inRange(sample, null, DateTime(2026, 10, 2)).map((t) => t.id), ['1']);
  });

  test('totalsByStatus gives every status, in a fixed order, even when empty', () {
    final t = totalsByStatus(sample);
    expect(t.map((s) => s.status), [PaymentStatus.completed, PaymentStatus.processing, PaymentStatus.pending, PaymentStatus.failed]);
    expect((t[0].count, t[0].amount), (3, 5200.0));
    expect(totalsByStatus([]).every((s) => s.count == 0 && s.amount == 0), isTrue);
  });

  test('totalsByPerson splits paid / waiting / failed and ranks by what was paid', () {
    final p = totalsByPerson(sample);
    expect(p.map((x) => x.name), ['Brian', 'Amina', 'Unknown']);
    expect((p[0].paid, p[0].waiting, p[0].failed, p[0].requests), (4000.0, 300.0, 1, 3));
    expect((p[1].paid, p[1].waiting), (1000.0, 500.0));
    expect(p[2].paid, 200.0); // a nameless requester is "Unknown", not dropped
  });

  test('movedMoney is true only for completed payments', () {
    expect(sample.where(movedMoney).map((t) => t.id), ['1', '3', '6']);
  });

  test('rwf formats whole francs with thousands separators', () {
    expect(rwf(0), 'RWF 0');
    expect(rwf(999), 'RWF 999');
    expect(rwf(12500), 'RWF 12,500');
    expect(rwf(1234567.4), 'RWF 1,234,567');
  });
}
