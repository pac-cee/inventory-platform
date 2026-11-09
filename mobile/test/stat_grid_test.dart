import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/config/theme.dart';
import 'package:inventory_mobile/widgets/stat_card.dart';

// The "Needs restock" tile overflowed by ~1px on the Dashboard. These render the
// real tiles on a narrow phone with large text; an overflow fails the test.
void main() {
  Future<void> pumpGrid(WidgetTester t, {required double width, required double textScale}) async {
    t.view.physicalSize = Size(width, 900);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 900), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(
          body: Padding(
            padding: const EdgeInsets.all(16),
            child: StatGrid(children: [
              const StatCard(label: 'Items', value: '38', icon: Icons.widgets_outlined),
              const StatCard(label: 'Units in stock', value: '1,204', icon: Icons.inventory_2_outlined),
              const StatCard(label: 'Locations', value: '4', icon: Icons.warehouse_outlined),
              StatCard(
                label: 'Needs restock',
                value: '12',
                icon: Icons.warning_amber_outlined,
                caption: '7 out · 5 low',
                tone: StatusColors.out,
                onTap: () {},
              ),
            ]),
          ),
        ),
      ),
    ));
  }

  for (final (w, s) in [(320.0, 1.0), (360.0, 1.0), (360.0, 1.3), (320.0, 1.5), (411.0, 1.0)]) {
    testWidgets('no overflow at width $w, text x$s', (t) async {
      await pumpGrid(t, width: w, textScale: s);
      expect(tester_exception(t), isNull); // an overflow is reported as a framework exception
      expect(find.text('Needs restock'), findsOneWidget);
      expect(find.text('7 out · 5 low'), findsOneWidget);
    });
  }

  testWidgets('both tiles in a row are the same height', (t) async {
    await pumpGrid(t, width: 360, textScale: 1.0);
    final cards = t.getSize(find.byType(StatCard).at(2)); // Locations
    final restock = t.getSize(find.byType(StatCard).at(3)); // Needs restock (has a caption)
    expect(cards.height, restock.height);
  });
}

Object? tester_exception(WidgetTester t) => t.takeException();
