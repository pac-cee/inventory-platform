import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/catalog_logic.dart';
import 'package:inventory_mobile/features/items/category_items_screen.dart';
import 'package:inventory_mobile/features/items/low_stock_screen.dart';
import 'package:inventory_mobile/models.dart';

Item item(String id, String type) => Item(id: id, type: type, name: type, model: 'Unspecified', sku: 'vrlt-$id');

void main() {
  group('LowStockScreen', () {
    final items = [item('a', 'Battery'), item('b', 'Cable'), item('c', 'Pi')];
    final rows = lowStockRows(items, {'a': 0, 'b': 0, 'c': 3});

    Future<void> open(WidgetTester t) =>
        t.pumpWidget(MaterialApp(home: LowStockScreen(rows: rows)));

    testWidgets('lists everything, out of stock first, with counts on the filters', (t) async {
      await open(t);
      expect(find.text('Needs restock (3)'), findsOneWidget);
      expect(find.text('Out of stock 2'), findsOneWidget);
      expect(find.text('Low 1'), findsOneWidget);
      final titles = t.widgetList<Text>(find.byType(Text)).map((x) => x.data).toList();
      expect(titles.indexOf('Battery'), lessThan(titles.indexOf('Pi'))); // out before low
    });

    testWidgets('the Low filter hides the out-of-stock rows', (t) async {
      await open(t);
      await t.tap(find.text('Low 1'));
      await t.pump();
      expect(find.text('Pi'), findsOneWidget);
      expect(find.text('Battery'), findsNothing);
    });
  });

  group('CategoryItemsScreen', () {
    final many = [for (var i = 0; i < 8; i++) item('i$i', 'Cable $i')];

    testWidgets('shows the count in the title and searches inside the category', (t) async {
      await t.pumpWidget(MaterialApp(
        home: CategoryItemsScreen(title: 'Cables', items: many, quantityByItem: {for (final i in many) i.id: 20}),
      ));
      expect(find.text('Cables (8)'), findsOneWidget);
      await t.enterText(find.byType(TextField), 'Cable 3');
      await t.pump();
      final list = find.byType(ListView);
      expect(find.descendant(of: list, matching: find.text('Cable 3')), findsOneWidget);
      expect(find.descendant(of: list, matching: find.text('Cable 5')), findsNothing);
    });

    testWidgets('a short category has no search box (nothing to hunt through)', (t) async {
      await t.pumpWidget(MaterialApp(
        home: CategoryItemsScreen(title: 'Boards', items: many.take(3).toList(), quantityByItem: const {}),
      ));
      expect(find.byType(TextField), findsNothing);
    });

    testWidgets('delete buttons appear only for managers, and the row goes after deleting', (t) async {
      await t.pumpWidget(MaterialApp(
        home: CategoryItemsScreen(title: 'Boards', items: many.take(2).toList(), quantityByItem: const {}),
      ));
      expect(find.byTooltip('Delete item'), findsNothing);

      final deleted = <String>[];
      await t.pumpWidget(MaterialApp(
        home: CategoryItemsScreen(
          title: 'Boards',
          items: many.take(2).toList(),
          quantityByItem: const {},
          onDelete: (i) async => deleted.add(i.id),
        ),
      ));
      await t.tap(find.byTooltip('Delete item').first);
      await t.pumpAndSettle();
      expect(deleted, ['i0']);
      expect(find.text('Cable 0'), findsNothing);
      expect(find.text('Cable 1'), findsOneWidget);
    });
  });
}
