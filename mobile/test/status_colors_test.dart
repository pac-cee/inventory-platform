// Status pills show a coloured word on a 15% tint of the same colour. The raw
// amber/green were ~2:1 on a light tint; StatusColors.text must reach the WCAG
// AA ratio (4.5:1) for normal-size text.

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:inventory_mobile/config/theme.dart';

double _lum(Color c) {
  double ch(double v) => v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

double _contrast(Color a, Color b) {
  final l1 = _lum(a), l2 = _lum(b);
  final hi = math.max(l1, l2), lo = math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/// What the pill background looks like: base at 15% over the surface.
Color _tint(Color base, Color surface) => Color.alphaBlend(base.withValues(alpha: 0.15), surface);

Future<Color> _textColor(WidgetTester tester, Color base, Brightness b) async {
  late Color out;
  await tester.pumpWidget(MaterialApp(
    theme: ThemeData(brightness: b),
    home: Builder(builder: (context) {
      out = StatusColors.text(context, base);
      return const SizedBox();
    }),
  ));
  return out;
}

void main() {
  const statuses = {
    'amber (pending / low)': Color(0xFFF59E0B),
    'green (approved / in stock)': Color(0xFF22C55E),
    'red (failed / out)': Color(0xFFEF4444),
    'blue (processing)': Color(0xFF3B82F6),
  };

  for (final e in statuses.entries) {
    testWidgets('light mode: ${e.key} text reaches 4.5:1 on its tint', (tester) async {
      final text = await _textColor(tester, e.value, Brightness.light);
      final ratio = _contrast(text, _tint(e.value, Colors.white));
      expect(ratio, greaterThanOrEqualTo(4.5), reason: 'was ${ratio.toStringAsFixed(2)}:1');
      // And it is a real improvement over the raw colour.
      expect(ratio, greaterThan(_contrast(e.value, _tint(e.value, Colors.white))));
    });

    testWidgets('dark mode: ${e.key} text reaches 4.5:1 on its tint', (tester) async {
      final text = await _textColor(tester, e.value, Brightness.dark);
      final ratio = _contrast(text, _tint(e.value, const Color(0xFF1C1C1E)));
      expect(ratio, greaterThanOrEqualTo(4.5), reason: 'was ${ratio.toStringAsFixed(2)}:1');
    });
  }
}
