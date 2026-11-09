import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/widgets/section_card.dart';

Widget host(Widget child) => MaterialApp(home: Scaffold(body: SingleChildScrollView(child: child)));

void main() {
  testWidgets('a plain card is always open and has no chevron', (t) async {
    await t.pumpWidget(host(const SectionCard(title: 'Items', child: Text('body'))));
    expect(find.text('body'), findsOneWidget);
    expect(find.byIcon(Icons.expand_more), findsNothing);
    expect(find.byIcon(Icons.expand_less), findsNothing);
  });

  testWidgets('a collapsible card starts closed, says what is inside, and opens and closes on tap', (t) async {
    await t.pumpWidget(host(const SectionCard(
      title: 'Move to another location',
      collapsible: true,
      initiallyExpanded: false,
      summary: '6 places',
      child: Text('body'),
    )));
    expect(find.text('body'), findsNothing);
    expect(find.text('6 places'), findsOneWidget);
    expect(find.byIcon(Icons.expand_more), findsOneWidget);

    await t.tap(find.text('Move to another location'));
    await t.pump();
    expect(find.text('body'), findsOneWidget);
    expect(find.text('6 places'), findsNothing); // the summary is for the closed state
    expect(find.byIcon(Icons.expand_less), findsOneWidget);

    await t.tap(find.text('Move to another location'));
    await t.pump();
    expect(find.text('body'), findsNothing);
  });

  testWidgets('a collapsible card can start open', (t) async {
    await t.pumpWidget(host(const SectionCard(title: 'Reservations', collapsible: true, child: Text('body'))));
    expect(find.text('body'), findsOneWidget);
  });

  testWidgets('the header button beside a collapsible title still works on its own', (t) async {
    var reserved = 0;
    await t.pumpWidget(host(SectionCard(
      title: 'Reservations',
      collapsible: true,
      initiallyExpanded: false,
      trailing: TextButton(onPressed: () => reserved++, child: const Text('Reserve')),
      child: const Text('body'),
    )));
    await t.tap(find.text('Reserve'));
    await t.pump();
    expect(reserved, 1);
  });

  testWidgets('a long title and summary do not overflow a narrow header', (t) async {
    await t.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SizedBox(
          width: 300,
          child: SectionCard(
            title: 'A rather long card title that goes on',
            collapsible: true,
            initiallyExpanded: false,
            summary: 'fourteen entries · who took what',
            trailing: TextButton(onPressed: () {}, child: const Text('Reserve')),
            child: const Text('body'),
          ),
        ),
      ),
    ));
    expect(t.takeException(), isNull);
  });
}
