import 'models.dart';

/// The payments report: where the money went, by status and by person, for a
/// date range. Computed on the phone from the transactions list (admins and
/// cashiers get everyone's), so it needs no endpoint of its own.

/// Which payments count as "money out": a failed payment moved nothing, and a
/// pending one has not been approved yet.
bool movedMoney(PaymentTransaction t) => t.status == PaymentStatus.completed;

/// The payments created within [from]..[to] (inclusive, by calendar day in the
/// phone's local time). Either bound may be null for open-ended.
List<PaymentTransaction> inRange(List<PaymentTransaction> all, DateTime? from, DateTime? to) {
  final start = from == null ? null : DateTime(from.year, from.month, from.day);
  final end = to == null ? null : DateTime(to.year, to.month, to.day).add(const Duration(days: 1));
  return [
    for (final t in all)
      if ((start == null || !t.createdAt.toLocal().isBefore(start)) &&
          (end == null || t.createdAt.toLocal().isBefore(end)))
        t,
  ];
}

class StatusTotal {
  const StatusTotal(this.status, this.count, this.amount);
  final PaymentStatus status;
  final int count;
  final double amount;
}

/// One row per status, always in the same order, including statuses with nothing.
List<StatusTotal> totalsByStatus(List<PaymentTransaction> txs) {
  const order = [PaymentStatus.completed, PaymentStatus.processing, PaymentStatus.pending, PaymentStatus.failed];
  return [
    for (final s in order)
      StatusTotal(
        s,
        txs.where((t) => t.status == s).length,
        txs.where((t) => t.status == s).fold(0.0, (sum, t) => sum + t.amount),
      ),
  ];
}

class PersonTotal {
  PersonTotal(this.name);
  final String name;
  int requests = 0;

  /// Money that actually went out (completed payments).
  double paid = 0;

  /// Requested but not (yet) paid: pending and processing.
  double waiting = 0;
  int failed = 0;
}

/// One row per requester, the biggest spenders first (then waiting, then name).
List<PersonTotal> totalsByPerson(List<PaymentTransaction> txs) {
  final by = <String, PersonTotal>{};
  for (final t in txs) {
    final name = (t.createdByName?.trim().isNotEmpty ?? false) ? t.createdByName!.trim() : 'Unknown';
    final p = by.putIfAbsent(name, () => PersonTotal(name));
    p.requests += 1;
    switch (t.status) {
      case PaymentStatus.completed:
        p.paid += t.amount;
      case PaymentStatus.pending:
      case PaymentStatus.processing:
        p.waiting += t.amount;
      case PaymentStatus.failed:
        p.failed += 1;
    }
  }
  return by.values.toList()
    ..sort((a, b) {
      final byPaid = b.paid.compareTo(a.paid);
      if (byPaid != 0) return byPaid;
      final byWaiting = b.waiting.compareTo(a.waiting);
      return byWaiting != 0 ? byWaiting : a.name.compareTo(b.name);
    });
}

/// "RWF 12,500" — whole francs, thousands separated.
String rwf(double amount) {
  final s = amount.round().abs().toString();
  final buf = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) buf.write(',');
    buf.write(s[i]);
  }
  return 'RWF ${amount < 0 ? '-' : ''}$buf';
}
