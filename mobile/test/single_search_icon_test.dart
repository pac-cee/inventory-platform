import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

// The app has ONE global search icon (SearchButton) in every tab's app bar. Pages
// that also filter their own list must not show a second magnifier next to it —
// that read as a duplicate. This fails if a magnifier icon turns up anywhere it
// has not been deliberately allowed.
void main() {
  test('Icons.search appears only where it is meant to', () {
    const allowed = {
      'widgets/search_button.dart', // the global icon itself
      'features/items/category_items_screen.dart', // a pushed page with no app-bar icon: its own search box
    };
    final offenders = <String>[];
    for (final f in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!f.path.endsWith('.dart')) continue;
      final rel = f.path.replaceAll('\\', '/').replaceFirst('lib/', '');
      if (allowed.contains(rel)) continue;
      if (f.readAsStringSync().contains('Icons.search')) offenders.add(rel);
    }
    expect(offenders, isEmpty,
        reason: 'These files use Icons.search; use Icons.filter_list for a page filter '
            'or another icon for an action: $offenders');
  });

  test('every tab screen carries the global SearchButton exactly once', () {
    const tabs = [
      'features/dashboard/dashboard_screen.dart',
      'features/items/items_admin_screen.dart',
      'features/locations/locations_screen.dart',
      'features/payments/payments_screen.dart',
      'features/equipment/equipment_screen.dart',
      'features/reports/reports_screen.dart',
      'features/users/users_screen.dart',
      'features/settings/settings_screen.dart',
    ];
    for (final t in tabs) {
      final n = 'SearchButton()'.allMatches(File('lib/$t').readAsStringSync()).length;
      expect(n, 1, reason: '$t has $n SearchButton()s');
    }
  });
}
