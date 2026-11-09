import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/equipment_audit.dart';
import 'package:inventory_mobile/models.dart';

Loan loan(String id, String userId, String user,
        {String item = 'Cable · USB-A to C', String status = 'upcoming', int days = 0, int qty = 1, String place = 'Box 4'}) =>
    Loan(
      takeId: id,
      itemId: 'i$id',
      itemName: item,
      userId: userId,
      userName: user,
      locationName: place,
      quantity: qty,
      takenAt: DateTime.utc(2026, 10, 1),
      expectedReturnAt: status == 'none' ? null : DateTime.utc(2026, 10, 10),
      status: status,
      daysOverdue: days,
    );

void main() {
  final sample = [
    loan('1', 'u1', 'Amina', status: 'overdue', days: 3, qty: 2),
    loan('2', 'u2', 'Brian', item: 'Raspberry Pi'),
    loan('3', 'u1', 'Amina', item: 'Soldering iron', status: 'overdue', days: 9),
    loan('4', 'u3', 'Chloé', status: 'none'),
  ];

  test('filterLoans narrows by status and by text, ignoring case', () {
    expect(filterLoans(sample, 'all', '  '), hasLength(4));
    expect(filterLoans(sample, 'overdue', '').map((l) => l.takeId), ['1', '3']);
    expect(filterLoans(sample, 'all', 'BRIAN').map((l) => l.takeId), ['2']);
    expect(filterLoans(sample, 'all', 'box 4'), hasLength(4));
    expect(filterLoans(sample, 'overdue', 'pi'), isEmpty);
  });

  test('summarize counts loans, units, distinct people and overdue', () {
    final s = summarize(sample);
    expect((s.loans, s.units, s.people, s.overdue), (4, 5, 3, 2));
    final none = summarize([]);
    expect((none.loans, none.units, none.people, none.overdue), (0, 0, 0, 0));
  });

  test('groupByPerson totals each person, most overdue first, tie by name', () {
    final g = groupByPerson(sample);
    expect(g.map((p) => p.userName), ['Amina', 'Brian', 'Chloé']);
    expect((g[0].units, g[0].overdue, g[0].worstDaysOverdue, g[0].loans.length), (3, 2, 9, 2));
    final tie = groupByPerson([loan('x', 'x', ''), loan('a', 'a', 'Ada')]);
    expect(tie.map((p) => p.userName), ['Ada', 'Unknown']);
  });
}
