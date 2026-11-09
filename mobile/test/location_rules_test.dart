import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/location_rules.dart';

void main() {
  group('Area > Shelf > Level > Box', () {
    test('only an area can be created at the top', () {
      expect(kindsAllowedUnder(null), ['area']);
    });

    test('each step offers exactly the next one down', () {
      expect(kindsAllowedUnder('area'), ['shelf']);
      expect(kindsAllowedUnder('shelf'), ['level']);
      expect(kindsAllowedUnder('level'), ['box']);
    });

    test('a box holds nothing below it', () {
      expect(kindsAllowedUnder('box'), isEmpty);
      expect(canHoldSubLocations('box'), isFalse);
      expect(canHoldSubLocations('level'), isTrue);
    });

    test('a box can never be offered at the top or on a shelf — the bug', () {
      expect(kindsAllowedUnder(null), isNot(contains('box')));
      expect(kindsAllowedUnder('shelf'), isNot(contains('box')));
      expect(kindsAllowedUnder('area'), isNot(contains('box')));
    });

    test('editing an older place keeps its own kind available', () {
      // a legacy "area" that sits on a level: the menu still includes what it is
      expect(kindsForEdit('area', 'level'), ['box', 'area']);
      // a normal shelf in an area: just shelf
      expect(kindsForEdit('shelf', 'area'), ['shelf']);
    });

    test('an old place inside another is recognised, so it can be typed', () {
      expect(isOlderUntypedPlace('area', 'shelf'), isTrue); // an old level inside a shelf
      expect(isOlderUntypedPlace('area', 'level'), isTrue);
      expect(isOlderUntypedPlace('area', 'area'), isFalse); // a grouping like "Shelves" inside a room
      expect(isOlderUntypedPlace('area', null), isFalse); // a real top-level area
      expect(isOlderUntypedPlace('shelf', 'area'), isFalse);
    });

    test('labels', () {
      expect(kindWord('level'), 'Level');
      expect(kindLabel('box'), 'Box (container)');
      expect(kindHint('shelf'), 'e.g. Shelf 3');
    });
  });
}
