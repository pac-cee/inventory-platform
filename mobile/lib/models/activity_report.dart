/// One enriched activity row from GET /movements/report.
class ReportRow {
  ReportRow({
    required this.id,
    required this.createdAt,
    required this.reason,
    required this.label,
    required this.units,
    this.itemId = '',
    required this.itemType,
    required this.itemName,
    required this.itemModel,
    required this.itemSku,
    this.itemSpecification,
    required this.locationName,
    required this.personId,
    required this.personName,
    required this.actorId,
    required this.actorName,
    required this.note,
    required this.reversed,
  });

  final String id;
  final DateTime createdAt;
  final String reason;
  final String label; // e.g. "Damaged 3"
  final int units;
  final String itemId;
  final String itemType;
  final String itemName;
  final String itemModel;
  final String itemSku;
  final String? itemSpecification;
  final String locationName; // full path "Room › Cupboard › Level"
  final String? personId;
  final String? personName;
  final String? actorId;
  final String? actorName;
  final String? note;
  final bool reversed;

  factory ReportRow.fromJson(Map<String, dynamic> json) {
    final item = (json['item'] as Map<String, dynamic>?) ?? const {};
    final loc = (json['location'] as Map<String, dynamic>?) ?? const {};
    final person = (json['person'] as Map<String, dynamic>?) ?? const {};
    final actor = (json['actor'] as Map<String, dynamic>?) ?? const {};
    return ReportRow(
      id: json['id'] as String,
      createdAt: DateTime.parse(json['created_at'] as String),
      reason: json['reason'] as String,
      label: (json['label'] as String?) ?? '',
      units: (json['units'] as num?)?.toInt() ?? 0,
      itemId: (item['id'] as String?) ?? '',
      itemType: (item['type'] as String?) ?? (item['name'] as String?) ?? '—',
      itemName: (item['name'] as String?) ?? '—',
      itemModel: (item['model'] as String?) ?? '',
      itemSku: (item['sku'] as String?) ?? '',
      itemSpecification: item['specification'] as String?,
      locationName: (loc['name'] as String?) ?? '—',
      personId: person['id'] as String?,
      personName: person['name'] as String?,
      actorId: actor['id'] as String?,
      actorName: actor['name'] as String?,
      note: json['note'] as String?,
      reversed: (json['reversed'] as bool?) ?? false,
    );
  }
}

/// A summary rollup bucket (per reason / person / item).
class ReportBucket {
  ReportBucket({required this.key, required this.name, required this.count, required this.units});

  final String key;
  final String name;
  final int count;
  final int units;

  factory ReportBucket.fromJson(Map<String, dynamic> json) => ReportBucket(
        key: (json['key'] as String?) ?? '',
        name: (json['name'] as String?) ?? '',
        count: (json['count'] as num?)?.toInt() ?? 0,
        units: (json['units'] as num?)?.toInt() ?? 0,
      );
}

class ActivityReport {
  ActivityReport({
    required this.count,
    required this.rows,
    required this.byReason,
    required this.byPerson,
    required this.byItem,
  });

  final int count;
  final List<ReportRow> rows;
  final List<ReportBucket> byReason;
  final List<ReportBucket> byPerson;
  final List<ReportBucket> byItem;

  factory ActivityReport.fromJson(Map<String, dynamic> json) {
    List<ReportBucket> buckets(dynamic v) =>
        (v as List<dynamic>? ?? const []).map((e) => ReportBucket.fromJson(e as Map<String, dynamic>)).toList();
    final summary = (json['summary'] as Map<String, dynamic>?) ?? const {};
    return ActivityReport(
      count: (json['count'] as num?)?.toInt() ?? 0,
      rows: (json['rows'] as List<dynamic>? ?? const [])
          .map((e) => ReportRow.fromJson(e as Map<String, dynamic>))
          .toList(),
      byReason: buckets(summary['byReason']),
      byPerson: buckets(summary['byPerson']),
      byItem: buckets(summary['byItem']),
    );
  }
}

/// Composable filters for the activity report (all optional).
class ReportFilters {
  const ReportFilters({
    this.from,
    this.to,
    this.locationId,
    this.itemId,
    this.userId,
    this.personField = 'attributed',
    this.reasons = const [],
    this.includeUndone = false,
    this.limit,
  });

  final DateTime? from;
  final DateTime? to;
  final String? locationId;
  final String? itemId;
  final String? userId;
  final String personField; // 'attributed' | 'actor'
  final List<String> reasons;
  final bool includeUndone;

  /// Most rows to return (the API caps it at 5000 and defaults to 2000).
  final int? limit;

  String toQuery() {
    final p = <String, String>{};
    if (from != null) p['from'] = from!.toIso8601String();
    if (to != null) p['to'] = to!.toIso8601String();
    if (locationId != null) p['location_id'] = locationId!;
    if (itemId != null) p['item_id'] = itemId!;
    if (userId != null) {
      p['user_id'] = userId!;
      p['person_field'] = personField;
    }
    if (reasons.isNotEmpty) p['reason'] = reasons.join(',');
    if (includeUndone) p['include_undone'] = 'true';
    if (limit != null) p['limit'] = '$limit';
    return p.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&');
  }
}
