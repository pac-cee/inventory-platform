// Smoke test for the Verlet theme.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:inventory_mobile/config/theme.dart';

void main() {
  // google_fonts (used by the Verlet theme) reads the asset bundle, which needs
  // the test binding initialized.
  TestWidgetsFlutterBinding.ensureInitialized();

  test('Verlet theme uses the pink highlight as the primary accent', () {
    final light = buildTheme(Brightness.light);
    final dark = buildTheme(Brightness.dark);

    expect(light.colorScheme.primary, kAccent);
    expect(dark.colorScheme.primary, const Color(0xFFE06090));
    expect(light.scaffoldBackgroundColor, const Color(0xFFF4F4F6));
    expect(dark.scaffoldBackgroundColor, const Color(0xFF0A0A0C));
  });
}
