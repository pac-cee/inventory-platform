/// One outstanding loan from GET /movements/borrowed: units taken, and when they
/// are due back. A person's several takes of one item are separate loans, each
/// with the date of the take it came from.
class Loan {
  Loan({
    required this.takeId,
    required this.itemId,
    this.itemName = '',
    required this.userId,
    required this.userName,
    this.locationId = '',
    this.locationName = '',
    required this.quantity,
    required this.takenAt,
    required this.expectedReturnAt,
    required this.status,
    required this.daysOverdue,
  });

  final String takeId;
  final String itemId;
  final String itemName;
  final String userId;
  final String userName;
  final String locationId;
  final String locationName;
  final int quantity;
  final DateTime takenAt;
  final DateTime? expectedReturnAt;

  /// none | upcoming | due_today | overdue
  final String status;
  final int daysOverdue;

  bool get isOverdue => status == 'overdue';

  factory Loan.fromJson(Map<String, dynamic> j) => Loan(
        takeId: j['take_id'] as String,
        itemId: j['item_id'] as String,
        itemName: (j['item_name'] as String?) ?? '',
        userId: j['user_id'] as String,
        userName: (j['user_name'] as String?) ?? '',
        locationId: (j['location_id'] as String?) ?? '',
        locationName: (j['location_name'] as String?) ?? '',
        quantity: (j['quantity'] as num).toInt(),
        takenAt: DateTime.parse(j['taken_at'] as String),
        expectedReturnAt: j['expected_return_at'] == null
            ? null
            : DateTime.parse(j['expected_return_at'] as String),
        status: (j['status'] as String?) ?? 'none',
        daysOverdue: (j['days_overdue'] as num?)?.toInt() ?? 0,
      );

  static const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  static const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /// What to print next to the loan. The date is shown in Kigali time (UTC+2, no
  /// daylight saving) whatever the phone's own zone says, to match the server.
  String get dueText {
    switch (status) {
      case 'none':
        return 'No fixed return date';
      case 'due_today':
        return 'Due today';
      case 'overdue':
        if (daysOverdue <= 0) return 'Overdue';
        return 'Overdue · $daysOverdue day${daysOverdue == 1 ? '' : 's'}';
      default:
        final k = expectedReturnAt!.toUtc().add(const Duration(hours: 2));
        return 'Due ${_weekdays[k.weekday - 1]} ${k.day} ${_months[k.month - 1]}';
    }
  }
}

/// Which of someone's loans deserve a nudge on the Home screen: anything late, due
/// today, or due tomorrow (Kigali days). Anything further out, and open-ended
/// loans, stay quiet — a card that is always there gets ignored. Most urgent first.
List<Loan> loansNeedingAttention(List<Loan> loans, {DateTime? now}) {
  int dayNumber(DateTime t) {
    final k = t.toUtc().add(const Duration(hours: 2));
    return DateTime.utc(k.year, k.month, k.day).millisecondsSinceEpoch ~/ 86400000;
  }

  final today = dayNumber(now ?? DateTime.now());
  int rank(Loan l) => l.status == 'overdue' ? 0 : (l.status == 'due_today' ? 1 : 2);
  final kept = loans.where((l) {
    if (l.status == 'overdue' || l.status == 'due_today') return true;
    if (l.status == 'upcoming' && l.expectedReturnAt != null) {
      return dayNumber(l.expectedReturnAt!) - today == 1;
    }
    return false;
  }).toList();
  kept.sort((a, b) {
    final byRank = rank(a).compareTo(rank(b));
    return byRank != 0 ? byRank : b.daysOverdue.compareTo(a.daysOverdue);
  });
  return kept;
}
