import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/config/paging.dart';

/// The catalog is fetched whole. These pin the loop that does it, because the
/// bug it fixes was invisible: one request returned 50 rows and every screen
/// treated that as the entire catalog.
void main() {
  /// A stub endpoint holding [total] rows, honouring limit and offset.
  ({Future<List<int>> Function(int, int) fetch, List<String> calls}) stub(int total) {
    final calls = <String>[];
    Future<List<int>> fetch(int limit, int offset) async {
      calls.add('limit=$limit offset=$offset');
      final all = List<int>.generate(total, (i) => i + 1);
      if (offset >= all.length) return <int>[];
      return all.sublist(offset, (offset + limit).clamp(0, all.length));
    }

    return (fetch: fetch, calls: calls);
  }

  test('returns a catalog smaller than one batch in a single request', () async {
    final s = stub(106);
    expect(await fetchAllPages(s.fetch), hasLength(106));
    expect(s.calls, ['limit=200 offset=0']);
  });

  test('keeps going past the 200-row cap', () async {
    final s = stub(450);
    expect(await fetchAllPages(s.fetch), hasLength(450));
    expect(s.calls, [
      'limit=200 offset=0',
      'limit=200 offset=200',
      'limit=200 offset=400',
    ]);
  });

  test('asks once more when the total is an exact multiple of the batch', () async {
    // A full batch cannot prove the list ended, so this costs one empty request.
    final s = stub(400);
    expect(await fetchAllPages(s.fetch), hasLength(400));
    expect(s.calls, hasLength(3));
  });

  test('returns rows in order, with nothing dropped or duplicated', () async {
    final s = stub(305);
    expect(await fetchAllPages(s.fetch), List<int>.generate(305, (i) => i + 1));
  });

  test('handles an empty list without a second request', () async {
    final s = stub(0);
    expect(await fetchAllPages(s.fetch), isEmpty);
    expect(s.calls, hasLength(1));
  });

  test('stops instead of looping when the server ignores offset', () async {
    var calls = 0;
    Future<List<int>> alwaysFull(int limit, int offset) async {
      calls++;
      return List<int>.filled(limit, 0);
    }

    await fetchAllPages(alwaysFull, maxBatches: 5);
    expect(calls, 5);
  });
}
