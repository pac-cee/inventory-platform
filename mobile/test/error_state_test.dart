import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/widgets/error_state.dart';

void main() {
  testWidgets('shows what went wrong and retries on tap', (tester) async {
    var retried = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: ErrorState(message: 'No connection', onRetry: () async => retried++)),
    ));
    expect(find.text("Couldn't load this"), findsOneWidget);
    expect(find.text('No connection'), findsOneWidget);
    await tester.tap(find.text('Try again'));
    expect(retried, 1);
  });

  testWidgets('without a retry callback there is no button', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: ErrorState(message: 'x'))));
    expect(find.text('Try again'), findsNothing);
  });
}
