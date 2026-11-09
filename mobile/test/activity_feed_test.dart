import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/activity_feed.dart';
import 'package:inventory_mobile/models.dart';

ReportRow row(String id, String reason, DateTime at,
        {String? person = 'Amina', String? personId = 'p1', String? actor, String? actorId, int units = 2, String type = 'Cable', String name = 'USB-A to C', String model = '1m', bool reversed = false}) =>
    ReportRow(
      id: id,
      createdAt: at,
      reason: reason,
      label: reason == 'destroyed' ? 'Damaged $units' : '',
      units: units,
      itemId: 'i-$id',
      itemType: type,
      itemName: name,
      itemModel: model,
      itemSku: 'vrlt-x',
      locationName: 'Hardware › Box 4',
      personId: personId,
      personName: person,
      actorId: actorId ?? personId,
      actorName: actor ?? person,
      note: null,
      reversed: reversed,
    );

void main() {
  final now = DateTime.utc(2026, 10, 30, 10, 0); // 12:00 in Kigali

  group('feedSentence', () {
    test('says who took or returned how many of what', () {
      final at = DateTime.utc(2026, 10, 30, 8);
      expect(feedSentence(row('1', 'take', at)), 'Amina took 2 × Cable · USB-A to C · 1m');
      expect(feedSentence(row('2', 'return', at, units: 1)), 'Amina returned 1 × Cable · USB-A to C · 1m');
    });
    test('leaves out a name that repeats the type and the placeholder model', () {
      final at = DateTime.utc(2026, 10, 30, 8);
      expect(feedSentence(row('1', 'take', at, type: 'Laptop', name: 'Laptop', model: 'Unspecified')), 'Amina took 2 × Laptop');
    });
    test('says when someone else recorded it, and not when the person did it themselves', () {
      final at = DateTime.utc(2026, 10, 30, 8);
      expect(feedSentence(row('1', 'take', at, actor: 'Brian', actorId: 'p2')), contains('(recorded by Brian)'));
      expect(feedSentence(row('1', 'take', at)), isNot(contains('recorded by')));
    });
    test('a missing name reads as "Someone", never as blank or "null"', () {
      final s = feedSentence(row('1', 'take', DateTime.utc(2026, 10, 30, 8), person: null, personId: null, actor: ''));
      expect(s, startsWith('Someone took'));
      expect(s, isNot(contains('null')));
    });
    test('damage is reported as damage', () {
      expect(feedSentence(row('1', 'destroyed', DateTime.utc(2026, 10, 30, 8))), '2 × Cable · USB-A to C · 1m damaged (Amina)');
    });
  });

  group('groupFeed', () {
    test('groups by Kigali day, newest first, labelled Today / Yesterday / date', () {
      final rows = [
        row('old', 'take', DateTime.utc(2026, 10, 27, 9)),
        row('t1', 'take', DateTime.utc(2026, 10, 30, 7)),
        row('y1', 'return', DateTime.utc(2026, 10, 29, 12)),
        row('t2', 'return', DateTime.utc(2026, 10, 30, 9)),
      ];
      final g = groupFeed(rows, now: now);
      expect(g.map((d) => d.label), ['Today', 'Yesterday', 'Tue 27 Oct']);
      expect(g[0].rows.map((r) => r.id), ['t2', 't1']);
    });
    test('uses Kigali midnight, not UTC: 23:30 UTC is already tomorrow in Kigali', () {
      final g = groupFeed([row('late', 'take', DateTime.utc(2026, 10, 29, 23, 30))], now: now);
      expect(g.single.label, 'Today');
    });
    test('undone rows are left out, and an empty list gives an empty feed', () {
      final g = groupFeed([row('u', 'take', DateTime.utc(2026, 10, 30, 8), reversed: true)], now: now);
      expect(g, isEmpty);
      expect(groupFeed([], now: now), isEmpty);
    });
  });

  test('feedTime is Kigali time', () {
    expect(feedTime(DateTime.utc(2026, 10, 30, 8, 5)), '10:05');
  });
}
