// Parsing of the fields 0036 added: a picture per location, and each item's
// number within a location. Both arrive from the API and both have to survive
// being absent, because the app talks to whatever version is deployed.

import 'package:flutter_test/flutter_test.dart';

import 'package:inventory_mobile/models.dart';

void main() {
  group('Location photo', () {
    test('reads the link and the upload flag', () {
      final loc = Location.fromJson({
        'id': 'l1',
        'name': 'Store room',
        'parent_id': null,
        'photo_url': 'https://example.com/room.jpg',
        'has_photo': true,
      });
      expect(loc.photoUrl, 'https://example.com/room.jpg');
      expect(loc.hasPhoto, isTrue);
      expect(loc.hasAnyPhoto, isTrue);
    });

    test('a sub-location has a photo of its own', () {
      final sub = Location.fromJson({
        'id': 'l2',
        'name': 'Shelf 3',
        'parent_id': 'l1',
        'has_photo': true,
      });
      expect(sub.isTopLevel, isFalse);
      expect(sub.hasAnyPhoto, isTrue);
    });

    test('has no photo when neither is set', () {
      final loc = Location.fromJson({'id': 'l3', 'name': 'Bare', 'parent_id': null});
      expect(loc.photoUrl, isNull);
      expect(loc.hasPhoto, isFalse);
      expect(loc.hasAnyPhoto, isFalse);
    });

    test('an empty link does not count as a photo', () {
      final loc = Location.fromJson({'id': 'l4', 'name': 'Bare', 'photo_url': ''});
      expect(loc.hasAnyPhoto, isFalse);
    });
  });

  group('StockLevel shelf number', () {
    test('reads the number the item has in that location', () {
      final s = StockLevel.fromJson({
        'item_id': 'i1',
        'location_id': 'l1',
        'quantity': 5,
        'slot_no': 3,
      });
      expect(s.slotNo, 3);
    });

    test('is null for stock that predates numbering', () {
      final s = StockLevel.fromJson({'item_id': 'i1', 'location_id': 'l1', 'quantity': 5});
      expect(s.slotNo, isNull);
    });
  });
}
