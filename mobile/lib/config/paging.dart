/// Reading a whole list endpoint that answers one page at a time.
///
/// GET /items caps a response at 200 rows and defaults to 50, so a single call
/// silently truncated the catalog: items past the cap vanished from the lists,
/// and on the location screen they kept their row but lost their thumbnail,
/// because the id -> item map used for photos never held them.
library;

/// Rows per request — the largest `limit` the list endpoints accept.
const int kPageBatch = 200;

/// A ceiling on requests, so a server that ignored `offset` cannot spin here.
const int kMaxBatches = 50;

/// Call [fetch] with successive offsets until a short batch ends the list.
///
/// A full batch cannot prove the list ended, so an exact multiple costs one
/// extra request that comes back empty — cheaper than guessing wrong.
Future<List<T>> fetchAllPages<T>(
  Future<List<T>> Function(int limit, int offset) fetch, {
  int batch = kPageBatch,
  int maxBatches = kMaxBatches,
}) async {
  final all = <T>[];
  for (var n = 0; n < maxBatches; n++) {
    final page = await fetch(batch, all.length);
    if (page.isEmpty) break;
    all.addAll(page);
    if (page.length < batch) break;
  }
  return all;
}
