import 'models.dart';

/// Search on the phone — the same rules as the web app's lib/search.ts, so a query
/// ranks things the same way on both.

/// How well [text] matches [query]: 0 exact, 1 starts with it, 2 a word in it
/// starts with it, 3 contains it. Null when it does not match.
int? matchScore(String query, String? text) {
  final q = query.trim().toLowerCase();
  final t = (text ?? '').toLowerCase();
  if (q.isEmpty || t.isEmpty) return null;
  if (t == q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.split(RegExp(r'[\s\-_/.,()]+')).any((w) => w.startsWith(q))) return 2;
  if (t.contains(q)) return 3;
  return null;
}

int? _bump(int? n, int by) => n == null ? null : n + by;

/// How an item reads on one line: type · name · model. A name that only repeats
/// the type and the 'Unspecified' placeholder model are left out.
String searchItemLabel(Item i) {
  final parts = <String>[i.type.isEmpty ? i.name : i.type];
  if (i.name.isNotEmpty && i.name != parts.first) parts.add(i.name);
  if (i.model.isNotEmpty && i.model != 'Unspecified') parts.add(i.model);
  return parts.join(' · ');
}

/// Best-matching items first: a name or type hit beats model and SKU, which beat spec.
List<Item> rankItems(List<Item> items, String query, {int limit = 6}) {
  final scored = <({Item item, int score})>[];
  for (final item in items) {
    final parts = <int?>[
      matchScore(query, item.name),
      matchScore(query, item.type),
      _bump(matchScore(query, item.model), 1),
      _bump(matchScore(query, item.sku), 1),
      _bump(matchScore(query, item.specification), 2),
    ].whereType<int>().toList();
    if (parts.isNotEmpty) {
      scored.add((item: item, score: parts.reduce((a, b) => a < b ? a : b)));
    }
  }
  scored.sort((a, b) {
    final byScore = a.score.compareTo(b.score);
    return byScore != 0 ? byScore : searchItemLabel(a.item).compareTo(searchItemLabel(b.item));
  });
  return [for (final s in scored.take(limit)) s.item];
}

/// "Warehouse › Shelf 3 › Level 2" — where a location sits, so two "Level 2"s are told apart.
String locationPathOf(Location loc, Map<String, Location> byId) {
  final parts = <String>[];
  final seen = <String>{};
  Location? cur = loc;
  while (cur != null && seen.add(cur.id)) {
    parts.insert(0, cur.name);
    cur = cur.parentId != null ? byId[cur.parentId] : null;
  }
  return parts.join(' › ');
}

List<Location> rankLocations(List<Location> locations, String query, {int limit = 5}) {
  final scored = <({Location loc, int score})>[];
  for (final l in locations) {
    final s = matchScore(query, l.name) ?? (l.isBox ? _bump(matchScore(query, l.label), 1) : null);
    if (s != null) scored.add((loc: l, score: s));
  }
  scored.sort((a, b) {
    final byScore = a.score.compareTo(b.score);
    return byScore != 0 ? byScore : a.loc.name.compareTo(b.loc.name);
  });
  return [for (final s in scored.take(limit)) s.loc];
}

/// A box reads as what it holds, then where it is; anything else as its path.
String placeText(StockPlace p) {
  if (p.kind == 'box') {
    final l = p.label;
    return (l != null && l.isNotEmpty) ? 'Box “$l” · ${p.path}' : 'Box · ${p.path}';
  }
  return p.path;
}

/// What a search result says about stock.
({String count, String? where, bool inStock}) stockSummary(ItemWhere? w) {
  if (w == null) return (count: '', where: null, inStock: false); // lookup failed: say nothing
  if (w.total <= 0 || w.places.isEmpty) return (count: 'None in stock', where: null, inStock: false);
  final more = w.places.length - 1;
  final top = placeText(w.places.first);
  return (
    count: '${w.total} in stock',
    where: more > 0 ? '$top (+$more more place${more == 1 ? '' : 's'})' : top,
    inStock: true,
  );
}
