import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

// `setState(() => _future = load())` hands the Future back to setState, and a
// debug build refuses with "setState() callback argument returned a Future" —
// it broke Take/Return and pull-to-refresh on the item screen. A block body
// returns nothing. This fails if the arrow form comes back.
void main() {
  test('no setState uses an arrow that assigns a Future', () {
    final bad = <String>[];
    final re = RegExp(r'setState\(\(\)\s*=>\s*_\w*[fF]uture\w*\s*=');
    for (final f in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!f.path.endsWith('.dart')) continue;
      final lines = f.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        if (re.hasMatch(lines[i])) bad.add('${f.path.replaceAll('\\', '/')}:${i + 1}');
      }
    }
    expect(bad, isEmpty, reason: 'Use setState(() { _future = ...; }) — $bad');
  });
}
