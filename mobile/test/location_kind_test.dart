import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/models.dart';

void main() {
  group('Location kind (0041)', () {
    test('an API that does not send the fields means an ordinary area', () {
      final l = Location.fromJson({'id': '1', 'name': 'Warehouse'});
      expect(l.kind, 'area');
      expect(l.isBox, isFalse);
      expect(l.boxBadge, isNull);
      expect(l.qrToken, isNull);
    });

    test('a box reads its label and code', () {
      final l = Location.fromJson({
        'id': '2',
        'name': 'Box 4',
        'kind': 'box',
        'label': 'USB-A to C cables',
        'qr_token': 'ABCDEFGH23',
      });
      expect(l.isBox, isTrue);
      expect(l.label, 'USB-A to C cables');
      expect(l.qrToken, 'ABCDEFGH23');
      expect(l.boxBadge, 'Box · USB-A to C cables');
    });

    test('a box without a label still gets a badge', () {
      final l = Location.fromJson({'id': '3', 'name': 'B', 'kind': 'box', 'qr_token': 'ABCDEFGH23'});
      expect(l.boxBadge, 'Box');
    });

    test('shelves and levels are not boxes', () {
      expect(Location.fromJson({'id': '4', 'name': 'S', 'kind': 'shelf'}).boxBadge, isNull);
      expect(Location.fromJson({'id': '5', 'name': 'L', 'kind': 'level'}).isBox, isFalse);
    });
  });
}
