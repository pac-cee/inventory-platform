import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/widgets/slide_sheet.dart';

// The add-item sheet could not be dragged shut because its scrolling body took
// every drag. These pin the fix: the handle closes it, the content still scrolls.
void main() {
  Future<void> open(WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: ElevatedButton(
              onPressed: () => showSlideSheet<void>(
                context,
                builder: (_) => ListView(
                  children: [for (var i = 0; i < 40; i++) ListTile(title: Text('row $i'))],
                ),
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

  testWidgets('dragging the handle down closes the sheet', (tester) async {
    await open(tester);
    expect(find.text('row 0'), findsOneWidget);
    await tester.fling(find.byType(SheetHandle), const Offset(0, 500), 1500);
    await tester.pumpAndSettle();
    expect(find.text('row 0'), findsNothing);
  });

  testWidgets('dragging the content scrolls it and leaves the sheet open', (tester) async {
    await open(tester);
    await tester.drag(find.text('row 3'), const Offset(0, -300));
    await tester.pumpAndSettle();
    expect(find.byType(SheetHandle), findsOneWidget); // still open
    expect(find.text('row 0'), findsNothing); // scrolled away
  });

  testWidgets('tapping the dimmed area still closes it', (tester) async {
    await open(tester);
    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();
    expect(find.byType(SheetHandle), findsNothing);
  });
}
