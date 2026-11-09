import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/models.dart';
import 'package:inventory_mobile/features/reports/condition_grouping.dart';

/// Items carry a type, a name, a model and a machine-assigned SKU (0039), and
/// the condition report groups on that identity rather than on the SKU.

ConditionRow row({
  String itemId = 'i',
  String locationId = 'l',
  String type = 'Cable',
  String name = 'Patch Lead',
  String model = 'CAT6-3M',
  String? sku = 'vrlt-cbl-001',
  String? specification,
  String? category = 'Cables',
  int total = 10,
  int operational = 10,
}) =>
    ConditionRow(
      itemId: itemId,
      locationId: locationId,
      type: type,
      name: name,
      model: model,
      sku: sku,
      specification: specification,
      category: category,
      locationName: 'Shelf',
      roomId: 'r',
      roomName: 'Room',
      total: total,
      available: total,
      damaged: 0,
      operational: operational,
      inUse: 0,
      accounted: 0,
      faults: const [],
    );

void main() {
  group('Item.fromJson', () {
    test('reads the type, name, model and assigned SKU', () {
      final item = Item.fromJson({
        'id': 'x',
        'type': 'Cable',
        'name': 'Patch Lead 3m',
        'model': 'CAT6-3M',
        'sku': 'vrlt-cbl-001',
      });
      expect(item.type, 'Cable');
      expect(item.name, 'Patch Lead 3m');
      expect(item.model, 'CAT6-3M');
      expect(item.sku, 'vrlt-cbl-001');
    });

    test('falls back gracefully against a server that predates 0039', () {
      // An updated app must not crash when the API still sends the old shape.
      final item = Item.fromJson({'id': 'x', 'name': 'Old Widget'});
      expect(item.type, 'Old Widget');
      expect(item.name, 'Old Widget');
      expect(item.model, 'Unspecified');
      expect(item.sku, '');
    });

    test('itemLabel pairs the name with a real model', () {
      final item = Item.fromJson({
        'id': 'x',
        'type': 'Cable',
        'name': 'Patch Lead',
        'model': 'CAT6-3M',
        'sku': 'vrlt-cbl-001',
      });
      expect(item.itemLabel, 'Patch Lead · CAT6-3M');
    });

    test('itemLabel drops the placeholder model rather than printing it', () {
      final item = Item.fromJson({
        'id': 'x',
        'type': 'Cable',
        'name': 'Patch Lead',
        'model': 'Unspecified',
        'sku': 'vrlt-cbl-001',
      });
      expect(item.itemLabel, 'Patch Lead');
    });
  });

  group('condition grouping', () {
    test('keeps two names under one type apart', () {
      final g = groupVariants(
        [
          row(itemId: 'a', name: 'Patch Lead 3m', total: 9),
          row(itemId: 'b', name: 'Patch Lead 5m', total: 6),
        ],
        GroupMode.item,
      );
      expect(g.length, 2);
    });

    test('keeps two models under one name apart', () {
      final g = groupVariants(
        [
          row(itemId: 'a', model: 'CAT6-3M'),
          row(itemId: 'b', model: 'CAT6-5M'),
        ],
        GroupMode.item,
      );
      expect(g.length, 2);
    });

    test('combines one item that differs only by specification', () {
      final g = groupVariants(
        [
          row(itemId: 'a', specification: 'shielded', total: 9),
          row(itemId: 'b', specification: 'unshielded', total: 6),
        ],
        GroupMode.item,
      );
      expect(g.length, 1);
      expect(g.first.total, 15);
      expect(g.first.variants.length, 2);
    });

    test('does not split on the SKU, which is unique per item', () {
      // Were the SKU in the key, these two would never combine and every line
      // in the report would stand alone.
      final g = groupVariants(
        [
          row(itemId: 'a', sku: 'vrlt-cbl-001', specification: 'shielded'),
          row(itemId: 'b', sku: 'vrlt-cbl-002', specification: 'unshielded'),
        ],
        GroupMode.item,
      );
      expect(g.length, 1);
    });

    test('matches the identity case-insensitively', () {
      final g = groupVariants(
        [
          row(itemId: 'a', type: 'Cable', name: 'Patch Lead'),
          row(itemId: 'b', type: ' CABLE ', name: 'patch lead'),
        ],
        GroupMode.item,
      );
      expect(g.length, 1);
    });

    test('nests lines under their type, not their name', () {
      final lines = groupVariants(
        [
          row(itemId: 'a', name: 'Patch Lead 3m', total: 9, operational: 9),
          row(itemId: 'b', name: 'Patch Lead 5m', total: 6, operational: 6),
        ],
        GroupMode.item,
      );
      final nested = nestByName(lines);
      expect(nested.length, 1);
      expect(nested.first.name, 'Cable');
      expect(nested.first.lines.length, 2);
      expect(nested.first.total, 15);
    });

    test('itemText names the line under its type heading', () {
      final g = groupVariants([row()], GroupMode.item);
      expect(g.first.itemText, 'Patch Lead · CAT6-3M');
    });

    test('itemText hides the placeholder model', () {
      final g = groupVariants([row(model: 'Unspecified')], GroupMode.item);
      expect(g.first.itemText, 'Patch Lead');
    });

    test('skuText carries the assigned SKU', () {
      final g = groupVariants([row()], GroupMode.item);
      expect(g.first.skuText, 'vrlt-cbl-001');
    });
  });
}
