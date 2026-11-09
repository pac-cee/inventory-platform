/// A hold on units of an item at a location for a window of dates (0043).
class Reservation {
  Reservation({
    required this.id,
    required this.itemId,
    required this.locationId,
    required this.locationName,
    required this.userId,
    required this.userName,
    required this.requestedBy,
    required this.requestedByName,
    required this.quantity,
    required this.startsAt,
    required this.endsAt,
    required this.state,
    this.note,
  });

  final String id;
  final String itemId;
  final String locationId;
  final String locationName;
  final String userId;
  final String userName;
  final String requestedBy;
  final String requestedByName;
  final int quantity;
  final DateTime startsAt;
  final DateTime endsAt;

  /// upcoming | active | expired | cancelled | fulfilled — derived from the dates
  /// by the API, except the stored outcomes.
  final String state;
  final String? note;

  /// Still standing: it can be cancelled.
  bool get isStanding => state == 'upcoming' || state == 'active';

  factory Reservation.fromJson(Map<String, dynamic> j) => Reservation(
        id: j['id'] as String,
        itemId: j['item_id'] as String,
        locationId: j['location_id'] as String,
        locationName: (j['location_name'] as String?) ?? '',
        userId: j['user_id'] as String,
        userName: (j['user_name'] as String?) ?? '',
        requestedBy: j['requested_by'] as String,
        requestedByName: (j['requested_by_name'] as String?) ?? '',
        quantity: (j['quantity'] as num).toInt(),
        startsAt: DateTime.parse(j['starts_at'] as String),
        endsAt: DateTime.parse(j['ends_at'] as String),
        state: (j['state'] as String?) ?? 'upcoming',
        note: j['note'] as String?,
      );

  static const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /// "12 Nov – 14 Nov" (or one date for a single day), in Kigali time (UTC+2, no
  /// daylight saving) to match the server whatever the phone's zone says.
  String get windowText {
    String d(DateTime t) {
      final k = t.toUtc().add(const Duration(hours: 2));
      return '${k.day} ${_months[k.month - 1]}';
    }

    final a = d(startsAt);
    final b = d(endsAt);
    return a == b ? a : '$a – $b';
  }

  String get stateText => switch (state) {
        'active' => 'Holding now',
        'upcoming' => 'Upcoming',
        'expired' => 'Not collected',
        'fulfilled' => 'Collected',
        _ => 'Cancelled',
      };
}
