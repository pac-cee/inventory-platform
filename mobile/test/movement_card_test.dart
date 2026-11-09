// MovementCard is the most-used control in the app. These pin the layout fixes:
// the action buttons must not overflow on a narrow phone with enlarged text, a
// long location path must ellipsise, and the quantity stepper must stay in step
// with what the user types.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:inventory_mobile/features/items/movement_card.dart';
import 'package:inventory_mobile/models.dart';
import 'package:inventory_mobile/return_by.dart';

class _Harness extends StatefulWidget {
  const _Harness({this.isAdmin = true, this.finishable = true, this.withPeople = false});
  final bool isAdmin;
  final bool withPeople;
  final bool finishable;

  @override
  State<_Harness> createState() => _HarnessState();
}

class _HarnessState extends State<_Harness> {
  int quantity = 1;
  ReturnBy returnBy = ReturnBy.none;
  DateTime? returnDate;
  String? forPerson;

  @override
  Widget build(BuildContext context) {
    final locations = [
      Location(id: 'room', name: 'Warehouse B — Electronics Prototyping Room'),
      Location(
          id: 'bin',
          name: 'Top shelf, third column from the left',
          parentId: 'room'),
    ];
    return Scaffold(
      body: SingleChildScrollView(
        child: MovementCard(
          locations: locations,
          stock: [StockLevel(itemId: 'i', locationId: 'bin', quantity: 12)],
          selectedLocationId: 'bin',
          quantity: quantity,
          working: false,
          finishable: widget.finishable,
          isAdmin: widget.isAdmin,
          onLocationChanged: (_) {},
          onQuantityChanged: (q) => setState(() => quantity = q),
          onTake: () {},
          onReturn: () {},
          onFinish: () {},
          onDestroy: () {},
          onLost: () {},
          onRepair: () {},
          returnBy: returnBy,
          returnDate: returnDate,
          onReturnByChanged: (v) => setState(() => returnBy = v),
          onPickReturnDate: () => setState(() => returnDate = DateTime(2026, 11, 5)),
          behalfPeople: widget.withPeople
              ? [
                  Holder(userId: 'u1', fullName: 'Tony Robert Niyonkuru-Mugisha of the Hardware Team', quantity: 2),
                  Holder(userId: 'u2', fullName: 'Amina', quantity: 0),
                ]
              : const [],
          forPersonId: forPerson,
          onForPersonChanged: (v) => setState(() => forPerson = v),
        ),
      ),
    );
  }
}

Future<void> _pump(WidgetTester tester, Widget child,
    {double width = 320, double textScale = 1.3}) async {
  await tester.binding.setSurfaceSize(Size(width, 900));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(
    builder: (context, c) => MediaQuery(
      data: MediaQuery.of(context)
          .copyWith(textScaler: TextScaler.linear(textScale)),
      child: c!,
    ),
    home: child,
  ));
}

void main() {
  testWidgets('all four actions fit a 320dp phone at 1.3x text with no overflow',
      (tester) async {
    await _pump(tester, const _Harness());
    expect(tester.takeException(), isNull);
    for (final label in ['Take', 'Return', 'Finish', 'Damaged', 'Lost', 'Repair']) {
      expect(find.text(label), findsOneWidget, reason: label);
    }
  });

  testWidgets('members get three actions, and a long location path does not overflow',
      (tester) async {
    await _pump(tester, const _Harness(isAdmin: false, finishable: false));
    expect(tester.takeException(), isNull);
    expect(find.text('Repair'), findsNothing);
    expect(find.text('Finish'), findsNothing);
    expect(find.text('Damaged'), findsOneWidget);
    expect(find.text('Lost'), findsOneWidget);
  });

  testWidgets('+ and - change the quantity; - is disabled at 1', (tester) async {
    await _pump(tester, const _Harness(), textScale: 1.0);
    TextField field() => tester.widget<TextField>(find.byType(TextField));
    expect(field().controller!.text, '1');

    final minus = find.widgetWithIcon(IconButton, Icons.remove);
    final plus = find.widgetWithIcon(IconButton, Icons.add);
    expect(tester.widget<IconButton>(minus).onPressed, isNull);

    await tester.tap(plus);
    await tester.pump();
    await tester.tap(plus);
    await tester.pump();
    expect(field().controller!.text, '3');

    await tester.tap(minus);
    await tester.pump();
    expect(field().controller!.text, '2');
  });

  testWidgets('typing a quantity is respected and not overwritten mid-edit',
      (tester) async {
    await _pump(tester, const _Harness(), textScale: 1.0);
    await tester.enterText(find.byType(TextField), '25');
    await tester.pump();
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, '25');

    // Clearing the field (quantity 0) must not be rewritten under the user.
    await tester.enterText(find.byType(TextField), '');
    await tester.pump();
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, '');
  });

  testWidgets('"Return by" is offered with the Take button, and picking a date shows it', (tester) async {
    await _pump(tester, const _Harness(), textScale: 1.0);
    expect(find.text('Return by'), findsOneWidget);
    expect(find.text('No fixed date'), findsOneWidget);

    await tester.tap(find.byType(DropdownButtonFormField<ReturnBy>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pick a date…').last);
    await tester.pumpAndSettle();

    // The harness stands in for the date picker with a fixed date.
    expect(find.text('2026-11-05'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a manager can record for someone else; the picker lists people with what they hold', (tester) async {
    await _pump(tester, const _Harness(withPeople: true), textScale: 1.0);
    expect(find.text('Record for'), findsOneWidget);
    expect(find.text('Me'), findsOneWidget);

    await tester.tap(find.byType(DropdownButtonFormField<String?>));
    await tester.pumpAndSettle();
    expect(find.textContaining('holds 2'), findsWidgets);
    expect(find.text('Amina'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a member never sees the picker, even if people were passed', (tester) async {
    await _pump(tester, const _Harness(isAdmin: false, finishable: false, withPeople: true), textScale: 1.0);
    expect(find.text('Record for'), findsNothing);
  });

  testWidgets('a long name does not overflow a 320dp phone at 1.3x text', (tester) async {
    await _pump(tester, const _Harness(withPeople: true));
    expect(tester.takeException(), isNull);
    await tester.tap(find.byType(DropdownButtonFormField<String?>));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
