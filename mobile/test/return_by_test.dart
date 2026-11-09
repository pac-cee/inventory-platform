import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/models.dart';
import 'package:inventory_mobile/return_by.dart';

void main() {
  loanAttentionTests();
  // Wednesday 21 Oct 2026, 10:00 (local).
  final now = DateTime(2026, 10, 21, 10);

  group('returnByIso', () {
    test('"no fixed date" sends nothing', () {
      expect(returnByIso(ReturnBy.none, now: now), (iso: null, error: null));
    });

    test('presets are the end of that local day', () {
      DateTime local(ReturnBy c) => DateTime.parse(returnByIso(c, now: now).iso!).toLocal();
      expect([local(ReturnBy.today).month, local(ReturnBy.today).day, local(ReturnBy.today).hour, local(ReturnBy.today).minute], [10, 21, 23, 59]);
      expect(local(ReturnBy.tomorrow).day, 22);
      expect(local(ReturnBy.week).day, 28);
      expect([local(ReturnBy.month).month, local(ReturnBy.month).day], [11, 21]);
    });

    test('"today" in the last minute has already passed', () {
      final late = DateTime(2026, 10, 21, 23, 59, 30);
      expect(returnByIso(ReturnBy.today, now: late).error, contains('passed'));
    });

    test('a picked date is the end of that day; none picked asks for one', () {
      final d = DateTime.parse(returnByIso(ReturnBy.custom, custom: DateTime(2026, 11, 5), now: now).iso!).toLocal();
      expect([d.month, d.day, d.hour, d.minute], [11, 5, 23, 59]);
      expect(returnByIso(ReturnBy.custom, now: now).error, contains('Pick'));
      expect(returnByIso(ReturnBy.custom, custom: DateTime(2026, 10, 1), now: now).error, contains('passed'));
    });
  });

  group('Loan.dueText', () {
    Loan loan(String status, {DateTime? due, int days = 0}) => Loan.fromJson({
          'take_id': 't',
          'item_id': 'i',
          'user_id': 'u',
          'user_name': 'Tony',
          'quantity': 2,
          'taken_at': '2026-10-20T08:00:00Z',
          'expected_return_at': due?.toUtc().toIso8601String(),
          'status': status,
          'days_overdue': days,
        });

    test('open-ended, due today and overdue', () {
      expect(loan('none').dueText, 'No fixed return date');
      expect(loan('due_today').dueText, 'Due today');
      expect(loan('overdue', days: 3).dueText, 'Overdue · 3 days');
      expect(loan('overdue', days: 1).dueText, 'Overdue · 1 day');
      expect(loan('overdue').dueText, 'Overdue');
      expect(loan('overdue', days: 3).isOverdue, isTrue);
    });

    test('an upcoming date is shown in Kigali time, whatever the phone zone is', () {
      // 22:00 UTC on 30 Oct is already 31 Oct in Kigali (UTC+2): a Saturday.
      expect(loan('upcoming', due: DateTime.utc(2026, 10, 30, 22)).dueText, 'Due Sat 31 Oct');
    });
  });
}

void loanAttentionTests() {
  // 20 Oct 2026, 09:00 Kigali.
  final now = DateTime.utc(2026, 10, 20, 7);
  DateTime kigali(int day, int hour) => DateTime.utc(2026, 10, day, hour - 2);

  Loan loan(String name, String status, DateTime? due, {int days = 0}) => Loan.fromJson({
        'take_id': name,
        'item_id': name,
        'item_name': name,
        'user_id': 'u',
        'user_name': 'Tony',
        'quantity': 1,
        'taken_at': '2026-10-01T08:00:00Z',
        'expected_return_at': due?.toIso8601String(),
        'status': status,
        'days_overdue': days,
      });

  group('loansNeedingAttention', () {
    test('keeps late, due today and due tomorrow; drops later and open-ended', () {
      final all = [
        loan('late', 'overdue', kigali(18, 17), days: 2),
        loan('today', 'due_today', kigali(20, 17)),
        loan('tomorrow', 'upcoming', kigali(21, 17)),
        loan('nextweek', 'upcoming', kigali(27, 17)),
        loan('open', 'none', null),
      ];
      expect(loansNeedingAttention(all, now: now).map((l) => l.itemName), ['late', 'today', 'tomorrow']);
    });

    test('most overdue first, then today, then tomorrow', () {
      final all = [
        loan('tomorrow', 'upcoming', kigali(21, 17)),
        loan('today', 'due_today', kigali(20, 17)),
        loan('late2', 'overdue', kigali(18, 17), days: 2),
        loan('late5', 'overdue', kigali(15, 17), days: 5),
      ];
      expect(loansNeedingAttention(all, now: now).map((l) => l.itemName), ['late5', 'late2', 'today', 'tomorrow']);
    });

    test('uses the Kigali day: 23:00 on the 21st is still tomorrow at 09:00 on the 20th', () {
      expect(loansNeedingAttention([loan('x', 'upcoming', kigali(21, 23))], now: now), hasLength(1));
    });

    test('nothing to nudge about is an empty list', () {
      expect(loansNeedingAttention([], now: now), isEmpty);
    });
  });
}
