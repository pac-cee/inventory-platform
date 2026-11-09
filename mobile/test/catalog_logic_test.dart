import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/catalog_logic.dart';
import 'package:inventory_mobile/models.dart';

Item item(String id, String type, {String? category}) =>
    Item(id: id, type: type, name: type, model: 'Unspecified', sku: 'vrlt-$id', category: category);

Location loc(String id, String name, {String? parent}) => Location(id: id, name: name, parentId: parent);

void main() {
  final items = [
    item('a', 'Cable', category: 'Cables'),
    item('b', 'HDMI', category: ' cables '),
    item('c', 'Pi', category: 'Boards'),
    item('d', 'Mystery'),
    item('e', 'Battery', category: 'Boards'),
  ];
  final qty = {'a': 0, 'b': 25, 'c': 3, 'd': 40, 'e': 0};

  group('lowStockRows', () {
    test('lists only out/low items, out of stock first, then fewest left, then name', () {
      final rows = lowStockRows(items, qty);
      expect(rows.map((r) => r.item.id), ['e', 'a', 'c']); // out (Battery, Cable), then low (Pi)
      expect(rows.map((r) => r.status), [StockStatus.out, StockStatus.out, StockStatus.low]);
    });
    test('an item with no stock record counts as out', () {
      expect(lowStockRows([item('z', 'Ghost')], {}).single.status, StockStatus.out);
    });
    test('nothing low means an empty list', () {
      expect(lowStockRows([item('b', 'HDMI')], {'b': 25}), isEmpty);
    });
  });

  group('restockTone', () {
    test('red if anything is out, amber if only low, calm otherwise', () {
      expect(restockTone(lowStockRows(items, qty)), StockStatus.out);
      expect(restockTone(lowStockRows([items[2]], qty)), StockStatus.low);
      expect(restockTone(const []), StockStatus.ok);
    });
  });

  group('groupByCategory', () {
    test('merges categories that differ by case/spaces, sorts A-Z, Uncategorized last', () {
      final g = groupByCategory(items, qty);
      expect(g.map((c) => c.name), ['Boards', 'Cables', 'Uncategorized']);
      final cables = g[1];
      expect(cables.items.map((i) => i.id), ['a', 'b']);
      expect((cables.units, cables.out, cables.low), (25, 1, 0));
    });
    test('the worst status colours the category', () {
      final g = groupByCategory(items, qty);
      expect(g[0].worst, StockStatus.out); // Boards has an out item
      expect(g[2].worst, StockStatus.ok); // Uncategorized: 40 in stock
    });
  });

  group('topLevelSummaries', () {
    final locs = [
      loc('h', 'Hardware'),
      loc('s1', 'Shelf 1', parent: 'h'),
      loc('b1', 'Box 1', parent: 's1'),
      loc('m', 'Main Hall'),
    ];
    test('rolls everything nested into its top-level location and counts sub-locations', () {
      final s = topLevelSummaries(locs, {'h': 10, 's1': 20, 'b1': 5, 'm': 100});
      expect(s.map((x) => x.location.name), ['Main Hall', 'Hardware']);
      expect((s[1].units, s[1].subLocations), (35, 2));
      expect((s[0].units, s[0].subLocations), (100, 0));
    });
    test('a loop in parent ids cannot hang it', () {
      final a = loc('a', 'A', parent: 'b');
      final b = loc('b', 'B', parent: 'a');
      expect(topLevelSummaries([a, b], {}), isEmpty); // neither is top-level
      final root = loc('r', 'Root');
      final loop = loc('x', 'X', parent: 'r');
      final loop2 = loc('r2', 'R2', parent: 'x');
      expect(topLevelSummaries([root, loop, loop2], {'r': 1, 'x': 2, 'r2': 3}).single.units, 6);
    });
  });

  test('subLocationText', () {
    expect(subLocationText(0), '');
    expect(subLocationText(1), '1 sub-location');
    expect(subLocationText(7), '7 sub-locations');
  });
}
