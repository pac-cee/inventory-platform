import 'models.dart';

/// The manager's audit of borrowed equipment — the same rules as the web app's
/// lib/equipment-audit.ts, free of widgets so they can be tested directly.

/// Loans matching the status ('all' or a Loan status) and any typed text
/// (person, item or place). Order is kept.
List<Loan> filterLoans(List<Loan> loans, String status, String query) {
  final q = query.trim().toLowerCase();
  return [
    for (final l in loans)
      if ((status == 'all' || l.status == status) &&
          (q.isEmpty ||
              [l.userName, l.itemName, l.locationName].any((t) => t.toLowerCase().contains(q))))
        l,
  ];
}

class AuditSummary {
  const AuditSummary({required this.loans, required this.units, required this.people, required this.overdue});
  final int loans;
  final int units;
  final int people;
  final int overdue;
}

AuditSummary summarize(List<Loan> loans) => AuditSummary(
      loans: loans.length,
      units: loans.fold(0, (n, l) => n + l.quantity),
      people: {for (final l in loans) l.userId}.length,
      overdue: loans.where((l) => l.status == 'overdue').length,
    );

class PersonGroup {
  PersonGroup(this.userId, this.userName);
  final String userId;
  final String userName;
  int units = 0;
  int overdue = 0;
  int worstDaysOverdue = 0;
  final List<Loan> loans = [];
}

/// One group per person; the people with the most overdue (then the latest) first.
List<PersonGroup> groupByPerson(List<Loan> loans) {
  final by = <String, PersonGroup>{};
  for (final l in loans) {
    final g = by.putIfAbsent(l.userId, () => PersonGroup(l.userId, l.userName.isEmpty ? 'Unknown' : l.userName));
    g.units += l.quantity;
    g.loans.add(l);
    if (l.status == 'overdue') {
      g.overdue += 1;
      if (l.daysOverdue > g.worstDaysOverdue) g.worstDaysOverdue = l.daysOverdue;
    }
  }
  final groups = by.values.toList()
    ..sort((a, b) {
      final byOverdue = b.overdue.compareTo(a.overdue);
      if (byOverdue != 0) return byOverdue;
      final byWorst = b.worstDaysOverdue.compareTo(a.worstDaysOverdue);
      return byWorst != 0 ? byWorst : a.userName.compareTo(b.userName);
    });
  return groups;
}
