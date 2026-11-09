import 'models.dart';

/// What the Dashboard and the Items browser show about stock — grouping and
/// ranking kept out of the widgets so the rules can be tested directly.

/// An item with its total on the shelf and how urgent that is.
class StockRow {
  const StockRow(this.item, this.quantity, this.status);
  final Item item;
  final int quantity;
  final StockStatus status;
}

/// Items that are out or low, most urgent first: out of stock, then fewest left,
/// then by name — so the top of the list is always what needs attention.
List<StockRow> lowStockRows(List<Item> items, Map<String, int> quantityByItem) {
  final rows = [
    for (final i in items)
      if (statusForQuantity(quantityByItem[i.id] ?? 0) != StockStatus.ok)
        StockRow(i, quantityByItem[i.id] ?? 0, statusForQuantity(quantityByItem[i.id] ?? 0)),
  ]..sort((a, b) {
      final byStatus = a.status.index.compareTo(b.status.index); // out < low
      if (byStatus != 0) return byStatus;
      final byQty = a.quantity.compareTo(b.quantity);
      return byQty != 0 ? byQty : a.item.type.toLowerCase().compareTo(b.item.type.toLowerCase());
    });
  return rows;
}

/// How worried the "Needs restock" tile should look: red when anything is out,
/// amber when things are only low, calm otherwise.
StockStatus restockTone(List<StockRow> rows) {
  if (rows.any((r) => r.status == StockStatus.out)) return StockStatus.out;
  if (rows.isNotEmpty) return StockStatus.low;
  return StockStatus.ok;
}

/// The name an item with no category is filed under.
const String kUncategorized = 'Uncategorized';

class ItemCategory {
  ItemCategory(this.name);
  final String name;
  final List<Item> items = [];
  int units = 0;
  int out = 0;
  int low = 0;

  /// The worst status among its items — what colours the category tile.
  StockStatus get worst => out > 0
      ? StockStatus.out
      : low > 0
          ? StockStatus.low
          : StockStatus.ok;
}

/// Group items by category, A to Z with "Uncategorized" last. Categories that
/// differ only by case or stray spaces are one category.
List<ItemCategory> groupByCategory(List<Item> items, Map<String, int> quantityByItem) {
  final by = <String, ItemCategory>{};
  for (final i in items) {
    final raw = (i.category ?? '').trim();
    final key = raw.isEmpty ? kUncategorized : raw.toLowerCase();
    final c = by.putIfAbsent(key, () => ItemCategory(raw.isEmpty ? kUncategorized : raw));
    final q = quantityByItem[i.id] ?? 0;
    c.items.add(i);
    c.units += q;
    switch (statusForQuantity(q)) {
      case StockStatus.out:
        c.out += 1;
      case StockStatus.low:
        c.low += 1;
      case StockStatus.ok:
        break;
    }
  }
  return by.values.toList()
    ..sort((a, b) {
      if (a.name == kUncategorized) return 1;
      if (b.name == kUncategorized) return -1;
      return a.name.toLowerCase().compareTo(b.name.toLowerCase());
    });
}

/// A top-level storage location with everything inside it rolled up.
class LocationSummary {
  LocationSummary(this.location);
  final Location location;
  int units = 0;
  int subLocations = 0;
}

/// Top-level locations (no parent), each with the units in it and in everything
/// nested below it, biggest first.
List<LocationSummary> topLevelSummaries(List<Location> locations, Map<String, int> unitsByLocation) {
  final children = <String, List<Location>>{};
  for (final l in locations) {
    final p = l.parentId;
    if (p != null) (children[p] ??= []).add(l);
  }
  LocationSummary summarise(Location root) {
    final s = LocationSummary(root);
    final seen = <String>{root.id}; // a loop in parent ids must not hang
    final stack = [root];
    while (stack.isNotEmpty) {
      final cur = stack.removeLast();
      s.units += unitsByLocation[cur.id] ?? 0;
      for (final c in children[cur.id] ?? const <Location>[]) {
        if (seen.add(c.id)) {
          s.subLocations += 1;
          stack.add(c);
        }
      }
    }
    return s;
  }

  return [
    for (final l in locations)
      if (l.parentId == null) summarise(l),
  ]..sort((a, b) {
      final byUnits = b.units.compareTo(a.units);
      return byUnits != 0 ? byUnits : a.location.name.toLowerCase().compareTo(b.location.name.toLowerCase());
    });
}

/// "7 sub-locations" / "1 sub-location" / "" (nothing nested).
String subLocationText(int n) => n == 0 ? '' : '$n sub-location${n == 1 ? '' : 's'}';
