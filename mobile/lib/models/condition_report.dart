/// One outstanding fault: why some units are damaged, and what to do about it.
///
/// A fault is created by marking stock damaged and stays outstanding until a
/// repair is recorded against it (or the damage is undone). [units] is what it
/// still accounts for — the damage it caused minus everything repaired.
class Fault {
  Fault({
    required this.id,
    required this.note,
    required this.units,
    this.recommendation,
  });

  final String id;
  final String note;
  final int units;
  final String? recommendation;

  factory Fault.fromJson(Map<String, dynamic> json) => Fault(
        id: json['id'] as String? ?? '',
        note: json['note'] as String? ?? 'Reason not recorded',
        units: (json['units'] as num?)?.toInt() ?? 0,
        recommendation: json['recommendation'] as String?,
      );
}

/// One row of the condition report: an item at a location, and what state it
/// is in.
///
/// [operational] counts checked-out units — they still work — so it is
/// `total - damaged` rather than anything derived from what is on the shelf.
class ConditionRow {
  ConditionRow({
    required this.itemId,
    required this.locationId,
    required this.type,
    required this.name,
    required this.model,
    required this.locationName,
    required this.roomId,
    required this.roomName,
    required this.total,
    required this.available,
    required this.damaged,
    required this.operational,
    required this.inUse,
    required this.accounted,
    required this.faults,
    this.suggestions = const [],
    this.sku,
    this.specification,
    this.category,
  });

  final String itemId;
  final String locationId;

  /// What kind of thing this is — the heading a report line sits under.
  final String type;
  final String name;

  /// Model designation; 'Unspecified' on rows that predate 0039.
  final String model;
  final String? sku;
  final String? specification;
  final String? category;
  final String locationName;
  final String roomId;
  final String roomName;

  /// Everything owned here, including units currently checked out.
  final int total;

  /// On the shelf right now.
  final int available;
  final int damaged;
  final int operational;

  /// Owned but neither on the shelf nor damaged — someone has it out.
  final int inUse;

  /// Damaged units explained by a recorded fault. Below [damaged] when the
  /// damage predates required reasons; the UI shows the gap rather than
  /// pretending those units are fine.
  final int accounted;

  final List<Fault> faults;

  /// Open suggestions — work worth doing on units that are NOT damaged. They
  /// never affect the tally or the percentage, only the recommendation.
  final List<ItemSuggestionNote> suggestions;

  double get percentOperational => total <= 0 ? 0 : (operational / total) * 100;

  /// The Condition column, in the words the printed report uses.
  ///
  /// Nothing wrong -> "Good"; a mix -> "9 good, 12 batteries died"; damage with
  /// no recorded reason is called out rather than folded into the good count.
  String get conditionText {
    if (damaged == 0) return 'Good';
    final parts = <String>[];
    if (operational > 0) parts.add('$operational good');
    for (final f in faults) {
      parts.add('${f.units} ${f.note}');
    }
    final unexplained = damaged - accounted;
    if (unexplained > 0) {
      parts.add('$unexplained out of service (reason not recorded)');
    }
    return parts.join(', ');
  }

  /// The distinct fixes recommended across this row's outstanding faults.
  String get recommendationText {
    final seen = <String>{};
    for (final f in faults) {
      final r = f.recommendation;
      if (r != null && r.isNotEmpty) seen.add(r);
    }
    // Suggestions are marked, so broken reads differently from could-be-better.
    for (final x in suggestions) {
      seen.add('${x.note} (suggested)');
    }
    return seen.join('; ');
  }

  factory ConditionRow.fromJson(Map<String, dynamic> json) => ConditionRow(
        itemId: json['item_id'] as String,
        locationId: json['location_id'] as String,
        name: json['name'] as String? ?? '',
        type: (json['type'] as String?) ?? (json['name'] as String? ?? ''),
        model: (json['model'] as String?) ?? 'Unspecified',
        sku: json['sku'] as String?,
        specification: json['specification'] as String?,
        category: json['category'] as String?,
        locationName: json['location_name'] as String? ?? '',
        roomId: json['room_id'] as String? ?? '',
        roomName: json['room_name'] as String? ?? '',
        total: (json['total'] as num?)?.toInt() ?? 0,
        available: (json['available'] as num?)?.toInt() ?? 0,
        damaged: (json['damaged'] as num?)?.toInt() ?? 0,
        operational: (json['operational'] as num?)?.toInt() ?? 0,
        inUse: (json['in_use'] as num?)?.toInt() ?? 0,
        accounted: (json['accounted'] as num?)?.toInt() ?? 0,
        suggestions: ((json['suggestions'] as List<dynamic>?) ?? const [])
            .map((e) => ItemSuggestionNote.fromJson(e as Map<String, dynamic>))
            .toList(),
        faults: (json['faults'] as List<dynamic>? ?? const [])
            .map((e) => Fault.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}


/// A suggestion as it appears on a condition-report row.
class ItemSuggestionNote {
  const ItemSuggestionNote({required this.note, required this.kind, this.units});

  final String note;
  final String kind;
  final int? units;

  static ItemSuggestionNote fromJson(Map<String, dynamic> j) => ItemSuggestionNote(
        note: j['note'] as String? ?? '',
        kind: j['kind'] as String? ?? 'upgrade',
        units: (j['units'] as num?)?.toInt(),
      );
}
