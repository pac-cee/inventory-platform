class Movement {
  Movement({
    required this.id,
    required this.itemId,
    required this.locationId,
    required this.userId,
    this.recordedBy,
    required this.delta,
    required this.createdAt,
    this.capacityDelta = 0,
    this.damagedDelta = 0,
    this.reason = 'take',
    this.reversalOf,
    this.note,
    this.locationName,
  });

  final String id;
  final String itemId;
  final String locationId;
  final String userId;

  /// Who physically recorded it (an admin, when attributed). Gates undo.
  final String? recordedBy;
  final int delta;

  /// Change to the ceiling (negative for finish/lost, positive for undo).
  final int capacityDelta;

  /// Change to the damaged bucket (positive when damaged, negative on repair/undo).
  final int damagedDelta;

  /// take | return | initial | finish | destroyed | lost | repair | adjust | undo
  final String reason;

  /// For an undo movement, the id of the movement it reverses.
  final String? reversalOf;
  final DateTime createdAt;
  final String? note;
  final String? locationName;

  factory Movement.fromJson(Map<String, dynamic> json) {
    final locations = json['locations'] as Map<String, dynamic>?;
    return Movement(
      id: json['id'] as String,
      itemId: json['item_id'] as String,
      locationId: json['location_id'] as String,
      userId: json['user_id'] as String,
      recordedBy: json['recorded_by'] as String?,
      delta: (json['delta'] as num).toInt(),
      capacityDelta: (json['capacity_delta'] as num?)?.toInt() ?? 0,
      damagedDelta: (json['damaged_delta'] as num?)?.toInt() ?? 0,
      reason: (json['reason'] as String?) ?? 'take',
      reversalOf: json['reversal_of'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
      note: json['note'] as String?,
      locationName: locations?['name'] as String?,
    );
  }
}
