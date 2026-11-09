import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/widgets/location_stock_row.dart';

Widget host(Widget child, {double width = 320}) => MaterialApp(
      home: Scaffold(body: Center(child: SizedBox(width: width, child: child))),
    );

void main() {
  const longName = 'Precision Rotary Wire Wound Precision Rotary Wire Wound Potentiometer 10 Turn';

  testWidgets('a long name stays readable next to a tick box, a photo, a count and a chip on a narrow phone', (t) async {
    await t.pumpWidget(host(LocationStockRow(
      name: longName,
      sku: 'vrlt-prwwp-001',
      slotNo: 1,
      quantity: 19,
      thumb: const SizedBox(width: 48, height: 48),
      onSelectChanged: () {},
    )));
    expect(t.takeException(), isNull); // no overflow
    final box = t.getSize(find.text(longName));
    // wide enough for real words, and at most two lines (the old row broke it into one letter per line)
    expect(box.width, greaterThan(100));
    expect(box.height, lessThan(60));
  });

  testWidgets('shows the number and SKU under the name, and the count with its status', (t) async {
    await t.pumpWidget(host(const LocationStockRow(name: 'Cable', sku: 'vrlt-c-001', slotNo: 3, quantity: 5, thumb: SizedBox(width: 48, height: 48))));
    expect(find.text('#3 · vrlt-c-001'), findsOneWidget);
    expect(find.text('5'), findsOneWidget);
  });

  testWidgets('no tick box unless the person can move items; ticking reports back', (t) async {
    await t.pumpWidget(host(const LocationStockRow(name: 'A', quantity: 1, thumb: SizedBox())));
    expect(find.byType(Checkbox), findsNothing);
    var ticked = 0;
    await t.pumpWidget(host(LocationStockRow(name: 'A', quantity: 1, thumb: const SizedBox(), onSelectChanged: () => ticked++)));
    await t.tap(find.byType(Checkbox));
    expect(ticked, 1);
  });

  testWidgets('the move-to-a-box button appears only when there are boxes to move into, and reports taps', (t) async {
    await t.pumpWidget(host(const LocationStockRow(name: 'A', quantity: 3, thumb: SizedBox())));
    expect(find.byTooltip('Move to a box'), findsNothing);
    var moved = 0;
    await t.pumpWidget(host(LocationStockRow(name: 'A', quantity: 3, thumb: const SizedBox(), onMove: () => moved++)));
    await t.tap(find.byTooltip('Move to a box'));
    expect(moved, 1);
  });

  testWidgets('the name keeps enough room with every control present on a narrow phone', (t) async {
    await t.pumpWidget(host(LocationStockRow(
      name: longName,
      quantity: 19,
      thumb: const SizedBox(width: 48, height: 48),
      onSelectChanged: () {},
      onMove: () {},
    ), width: 340));
    expect(t.takeException(), isNull);
    expect(t.getSize(find.text(longName)).width, greaterThan(90));
  });
}
