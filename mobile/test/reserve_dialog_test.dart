import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/features/items/reserve_dialog.dart';
import 'package:inventory_mobile/models.dart';

Future<void> _open(WidgetTester tester, {List<Holder> people = const []}) async {
  await tester.binding.setSurfaceSize(const Size(360, 800));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(
    home: Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: ElevatedButton(
            onPressed: () => showReserveDialog(
              context,
              places: const [
                ReservePlace(locationId: 'a', label: 'Hardware Area › Shelves › Shelf 2 › Level 3 › Box 4', onShelf: 12),
              ],
              behalfPeople: people,
            ),
            child: const Text('open'),
          ),
        ),
      ),
    ),
  ));
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows where, how many and the dates, with no overflow on a narrow phone', (tester) async {
    await _open(tester);
    expect(find.text('Reserve'), findsWidgets);
    expect(find.text('Choose the dates'), findsOneWidget);
    expect(find.text('Quantity'), findsOneWidget);
    expect(find.textContaining('Box 4 · 12'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('refuses to submit without dates, and says so', (tester) async {
    await _open(tester);
    await tester.tap(find.widgetWithText(FilledButton, 'Reserve'));
    await tester.pump();
    expect(find.text('Pick both dates.'), findsOneWidget);
  });

  testWidgets('refuses a quantity of zero', (tester) async {
    await _open(tester);
    await tester.enterText(find.widgetWithText(TextField, 'Quantity'), '0');
    await tester.tap(find.widgetWithText(FilledButton, 'Reserve'));
    await tester.pump();
    expect(find.text('Enter a quantity of at least 1.'), findsOneWidget);
  });

  testWidgets('only offers "Reserve for" when people are passed (managers)', (tester) async {
    await _open(tester);
    expect(find.text('Reserve for'), findsNothing);
  });

  testWidgets('a manager gets the "Reserve for" picker', (tester) async {
    await _open(tester, people: [Holder(userId: 'u', fullName: 'Tony', quantity: 0)]);
    expect(find.text('Reserve for'), findsOneWidget);
    expect(find.text('Me'), findsOneWidget);
  });
}
