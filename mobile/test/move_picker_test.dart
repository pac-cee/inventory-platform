import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/features/items/destination_picker.dart';
import 'package:inventory_mobile/models.dart';
import 'package:inventory_mobile/move_picker_logic.dart';
import 'package:inventory_mobile/widgets/slide_sheet.dart';

Location loc(String id, String name, String kind, {String? parent, String? label}) =>
    Location(id: id, name: name, kind: kind, parentId: parent, label: label);

// Store > Shelf 1 > Level 1 > Box 4 (cables)   and   Store > Shelf 2 > Level 1 > Box 4 (screws):
// the same names on different shelves, which is exactly what the flat list could not tell apart.
final all = <Location>[
  loc('a', 'Store', 'area'),
  loc('s1', 'Shelf 1', 'shelf', parent: 'a'),
  loc('s2', 'Shelf 2', 'shelf', parent: 'a'),
  loc('l1a', 'Level 1', 'level', parent: 's1'),
  loc('l1b', 'Level 1', 'level', parent: 's2'),
  loc('b1', 'Box 4', 'box', parent: 'l1a', label: 'USB cables'),
  loc('b2', 'Box 4', 'box', parent: 'l1b', label: 'Screws'),
  loc('b3', 'Box 5', 'box', parent: 'l1b'),
];
final byId = {for (final l in all) l.id: l};
// Stock may land only in boxes here (the rest have children).
final dests = all.where((l) => l.isBox).toList();

void main() {
  group('paths', () {
    test('full path from the top', () {
      expect(locationPath(byId['b2']!, byId), 'Store › Shelf 2 › Level 1 › Box 4');
      expect(locationPath(byId['a']!, byId), 'Store');
    });
    test('parent path leaves out the place itself', () {
      expect(parentPath(byId['b2']!, byId), 'Store › Shelf 2 › Level 1');
      expect(parentPath(byId['a']!, byId), '');
    });
    test('two boxes with the same name have different paths', () {
      expect(locationPath(byId['b1']!, byId), isNot(locationPath(byId['b2']!, byId)));
    });
    test('a loop in bad data does not hang', () {
      final x = loc('x', 'X', 'area', parent: 'y');
      final y = loc('y', 'Y', 'area', parent: 'x');
      expect(locationPath(x, {'x': x, 'y': y}), isNotEmpty);
    });
    test('a box shows its purpose when it has one', () {
      expect(displayName(byId['b1']!), 'USB cables');
      expect(displayName(byId['b3']!), 'Box 5');
    });
  });

  group('browsing', () {
    test('children are in name order and boxes are counted below a place', () {
      expect(childrenOf(all, 'a').map((l) => l.id), ['s1', 's2']);
      expect(boxesBelow(all, 's2'), 2);
      expect(boxesBelow(all, 'a'), 3);
      expect(boxesBelow(all, 'b1'), 0);
    });
    test('boxes first, ordered by path', () {
      final mixed = [byId['s1']!, byId['b2']!, byId['b1']!];
      expect(boxesFirst(mixed, byId).map((l) => l.id), ['b1', 'b2']);
    });
  });

  group('search', () {
    test('"shelf 2 box 4" finds exactly that box', () {
      expect(searchDestinations(dests, byId, 'shelf 2 box 4').map((l) => l.id), ['b2']);
    });
    test('matches the purpose label too', () {
      expect(searchDestinations(dests, byId, 'usb').map((l) => l.id), ['b1']);
    });
    test('every word must match', () {
      expect(searchDestinations(dests, byId, 'shelf 2 usb'), isEmpty);
    });
    test('an empty query finds nothing (the screen shows the lists instead)', () {
      expect(searchDestinations(dests, byId, '  '), isEmpty);
    });
    test('boxes outrank other places', () {
      final res = searchDestinations([byId['s2']!, byId['b2']!], byId, 'shelf 2');
      expect(res.first.id, 'b2');
    });
  });

  group('recent destinations', () {
    test('newest first, no duplicates, capped', () {
      var r = <String>[];
      for (final id in ['a', 'b', 'c', 'd', 'e', 'f']) {
        r = RecentDestinations.pushed(r, id);
      }
      expect(r, ['f', 'e', 'd', 'c', 'b']);
      expect(RecentDestinations.pushed(r, 'c'), ['c', 'f', 'e', 'd', 'b']);
    });
    test('survives a round trip through the file', () async {
      final dir = await Directory.systemTemp.createTemp('recent');
      RecentDestinations.directoryOverride = dir.path;
      addTearDown(() {
        RecentDestinations.directoryOverride = null;
        dir.deleteSync(recursive: true);
      });
      expect(await RecentDestinations.load(), isEmpty);
      await RecentDestinations.remember('b1');
      await RecentDestinations.remember('b2');
      expect(await RecentDestinations.load(), ['b2', 'b1']);
    });
  });

  group('the picker', () {
    Future<void> pump(WidgetTester t, {double height = 700, double keyboard = 0, List<String> recent = const []}) async {
      t.view.physicalSize = Size(360, height);
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.reset);
      await t.pumpWidget(MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(size: Size(360, height), viewInsets: EdgeInsets.only(bottom: keyboard)),
          child: Scaffold(
            body: Column(children: [
              const SheetHandle(),
              Expanded(child: DestinationPicker(all: all, destinations: dests, recentIds: recent)),
            ]),
          ),
        ),
      ));
      await t.pumpAndSettle();
    }

    testWidgets('two boxes with the same name are told apart by their path', (t) async {
      await pump(t);
      // Both are called Box 4; each shows where it is.
      expect(find.text('Store › Shelf 1 › Level 1'), findsWidgets);
      expect(find.text('Store › Shelf 2 › Level 1'), findsWidgets);
      expect(find.byKey(const ValueKey('dest-b1')), findsWidgets);
      expect(find.byKey(const ValueKey('dest-b2')), findsWidgets);
    });

    testWidgets('boxes are listed first, and recent destinations above them', (t) async {
      await pump(t, recent: ['b2']);
      final recentY = t.getTopLeft(find.text('Recent')).dy;
      final boxesY = t.getTopLeft(find.text('Boxes')).dy;
      expect(recentY, lessThan(boxesY));
    });

    testWidgets('searching by path narrows to the one box', (t) async {
      await pump(t);
      await t.enterText(find.byType(TextField), 'shelf 2 box 4');
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('dest-b2')), findsOneWidget);
      expect(find.byKey(const ValueKey('dest-b1')), findsNothing);
    });

    testWidgets('drilling down walks Area > Shelf > Level and Back returns', (t) async {
      await pump(t);
      await t.tap(find.byKey(const ValueKey('dest-a')));
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('dest-s1')), findsOneWidget);
      await t.tap(find.byKey(const ValueKey('picker-back')));
      await t.pumpAndSettle();
      expect(find.byKey(const ValueKey('dest-a')), findsOneWidget);
    });

    for (final (h, kb) in [(700.0, 0.0), (500.0, 260.0), (400.0, 250.0)]) {
      testWidgets('fits at height $h with a ${kb}px keyboard (it scrolls instead of overflowing)', (t) async {
        await pump(t, height: h, keyboard: kb, recent: ['b1']);
        expect(t.takeException(), isNull);
      });
    }
  });
}
