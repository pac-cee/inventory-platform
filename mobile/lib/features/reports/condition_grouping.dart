import '../../models.dart';

/// How condition-report lines are formed. Mirrors the web report exactly.
///
/// [item]     — one line per product per category, across every location, so
///              the report is about what is owned and place is a detail.
/// [location] — one line per product per place, for the room-by-room sheet.
enum GroupMode { item, location }

/// One printed line: every variant of a product, added up.
///
/// Rows stay separate in the database so each keeps its own faults and its own
/// percentage. Grouping happens here, at display time.
class GroupedRow {
  GroupedRow({
    required this.key,
    required this.roomId,
    required this.roomName,
    required this.category,
    required this.type,
    required this.name,
    required this.model,
  });

  final String key;
  final String roomId;
  final String roomName;
  final String? category;

  /// What kind of thing this line is — its heading.
  final String type;
  final String name;
  final String model;

  final List<String> skus = [];
  final List<({String? specification, int total})> variants = [];
  final List<({String name, int total})> locations = [];
  final List<Fault> faults = [];
  final List<ItemSuggestionNote> suggestions = [];

  int total = 0;
  int operational = 0;
  int damaged = 0;
  int accounted = 0;
  int inUse = 0;

  double get percentOperational => total <= 0 ? 0 : (operational / total) * 100;

  /// The lone spec, or each variant with its share when there are several.
  String get variantsText {
    if (variants.length == 1) {
      final spec = variants.first.specification?.trim();
      return (spec == null || spec.isEmpty) ? '—' : spec;
    }
    return variants
        .map((v) {
          final spec = v.specification?.trim();
          return '${(spec == null || spec.isEmpty) ? 'unspecified' : spec} (${v.total})';
        })
        .join(', ');
  }

  /// The SKU, or a marker when the entry has none.
  String get skuText => skus.isEmpty ? 'No SKU' : skus.join(', ');

  /// How the line names itself under its type: name, plus the model when it is
  /// a real one rather than the placeholder 0039 backfilled.
  String get itemText =>
      model.isEmpty || model == 'Unspecified' ? name : '$name · $model';

  /// The single place, or each place with how many are there.
  String get locationsText {
    if (locations.length == 1) return locations.first.name;
    return locations.map((l) => '${l.name} (${l.total})').join(', ');
  }

  String get conditionText {
    if (damaged == 0) return 'Good';
    final parts = <String>[];
    if (operational > 0) parts.add('$operational good');
    for (final f in faults) {
      parts.add('${f.units} ${f.note}');
    }
    final unexplained = damaged - accounted;
    if (unexplained > 0) parts.add('$unexplained out of service (reason not recorded)');
    return parts.join(', ');
  }

  /// Fixes for what is broken, then anything merely suggested.
  String get recommendationText {
    final seen = <String>{};
    for (final f in faults) {
      final r = f.recommendation;
      if (r != null && r.isNotEmpty) seen.add(r);
    }
    for (final x in suggestions) {
      seen.add('${x.note} (suggested)');
    }
    return seen.join('; ');
  }
}

/// Identity is (type, name, model) — the same rule the catalog enforces — so
/// two different items never have their counts added together. Entries that
/// differ only by specification do combine: that is the variant case.
///
/// The SKU is deliberately NOT in the key. It is unique per item now, so
/// including it would make every row its own line and defeat the grouping.
String _keyFor(ConditionRow r, GroupMode mode) {
  final identity = '${r.type.trim().toLowerCase()}~'
      '${r.name.trim().toLowerCase()}~'
      '${r.model.trim().toLowerCase()}';
  return mode == GroupMode.item
      ? '${r.category ?? ''}|$identity'
      : '${r.roomId}|${r.locationId}|${r.category ?? ''}|$identity';
}

/// Collapse rows into lines, preserving the API's ordering.
List<GroupedRow> groupVariants(List<ConditionRow> rows, GroupMode mode) {
  final out = <String, GroupedRow>{};
  for (final r in rows) {
    final key = _keyFor(r, mode);
    final g = out.putIfAbsent(
      key,
      () => GroupedRow(
        key: key,
        roomId: r.roomId,
        roomName: r.roomName,
        category: r.category,
        type: r.type,
        name: r.name,
        model: r.model,
      ),
    );
    // One item in five places arrives as five rows carrying the same SKU and
    // the same spec — name each once, not once per row.
    final sku = r.sku;
    if (sku != null && sku.isNotEmpty && !g.skus.contains(sku)) g.skus.add(sku);
    final specKey = (r.specification ?? '').trim().toLowerCase();
    final vi = g.variants.indexWhere(
        (v) => (v.specification ?? '').trim().toLowerCase() == specKey);
    if (vi >= 0) {
      final was = g.variants[vi];
      g.variants[vi] = (specification: was.specification, total: was.total + r.total);
    } else {
      g.variants.add((specification: r.specification, total: r.total));
    }
    // The same place can appear twice when two variants live there.
    final existing = g.locations.indexWhere((l) => l.name == r.locationName);
    if (existing >= 0) {
      final was = g.locations[existing];
      g.locations[existing] = (name: was.name, total: was.total + r.total);
    } else {
      g.locations.add((name: r.locationName, total: r.total));
    }
    g.total += r.total;
    g.operational += r.operational;
    g.damaged += r.damaged;
    g.accounted += r.accounted;
    g.inUse += r.inUse;
    g.faults.addAll(r.faults);
    g.suggestions.addAll(r.suggestions);
  }
  return out.values.toList();
}


/// Lines sharing a type, so the type is written once with its items beneath.
///
/// The lines keep their own totals — this only controls layout. A type with a
/// single line renders flat, without a redundant heading.
class NameGroup {
  NameGroup({required this.key, required this.name, required this.category});

  final String key;
  final String name;
  final String? category;
  final List<GroupedRow> lines = [];

  int total = 0;
  int operational = 0;

  double get percentOperational => total <= 0 ? 0 : (operational / total) * 100;
}

List<NameGroup> nestByName(List<GroupedRow> lines) {
  final out = <String, NameGroup>{};
  for (final l in lines) {
    // Nested by TYPE: "Cable" is the heading, its items are the lines under it.
    final key = '${l.category ?? ''}|${l.type.trim().toLowerCase()}';
    final g = out.putIfAbsent(
      key,
      () => NameGroup(key: key, name: l.type, category: l.category),
    );
    g.lines.add(l);
    g.total += l.total;
    g.operational += l.operational;
  }
  return out.values.toList();
}
