import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/features/users/add_user_sheet.dart';
import 'package:inventory_mobile/widgets/slide_sheet.dart';

// "Add user" overflowed by 119px with the keyboard open: the form was a plain
// column in a sheet that shrinks when the keyboard appears. A sheet whose
// content is taller than the space it gets must scroll instead.
void main() {
  Future<void> pumpIn(WidgetTester t, Widget sheet, {required double height, double keyboard = 0}) async {
    t.view.physicalSize = Size(360, height);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(360, height), viewInsets: EdgeInsets.only(bottom: keyboard)),
        child: Scaffold(body: Column(children: [const SheetHandle(), Expanded(child: sheet)])),
      ),
    ));
  }

  for (final (h, kb) in [(700.0, 0.0), (600.0, 300.0), (480.0, 260.0)]) {
    testWidgets('Add user fits at height $h with a ${kb}px keyboard (it scrolls instead of overflowing)', (t) async {
      await pumpIn(t, const AddUserSheet(), height: h, keyboard: kb);
      expect(t.takeException(), isNull);
      expect(find.text('Add user'), findsWidgets);
    });
  }

  testWidgets('every field can still be reached by scrolling when space is tight', (t) async {
    await pumpIn(t, const AddUserSheet(), height: 420, keyboard: 250);
    await t.scrollUntilVisible(find.text('Temporary password (optional)'), 100, scrollable: find.byType(Scrollable).first);
    expect(t.takeException(), isNull);
  });
}
