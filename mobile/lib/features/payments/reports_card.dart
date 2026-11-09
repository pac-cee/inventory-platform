import 'package:flutter/material.dart';

import '../../models.dart';
import 'new_request_sheet.dart';

/// Mirrors the web "Reports" tab: today's + this month's completed spend.
/// Admin sees org-wide totals; members see only their own requests.
class ReportsCard extends StatelessWidget {
  const ReportsCard({
    super.key,
    required this.transactions,
    required this.currentUserName,
    this.isAdmin = false,
  });
  final List<PaymentTransaction> transactions;
  final String currentUserName;
  final bool isAdmin;

  List<PaymentTransaction> get _scope {
    final completed = transactions
        .where((t) => t.status == PaymentStatus.completed)
        .toList();
    if (isAdmin) return completed;
    return completed.where((t) => t.createdByName == currentUserName).toList();
  }

  double _sumWhere(bool Function(DateTime) test) => _scope
      .where((t) => test(t.createdAt))
      .fold<double>(0, (s, t) => s + t.amount);

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    final now = DateTime.now();
    final today = _sumWhere((d) =>
        d.year == now.year && d.month == now.month && d.day == now.day);
    final month = _sumWhere((d) => d.year == now.year && d.month == now.month);

    return Card(
      margin: const EdgeInsets.fromLTRB(16, 4, 16, 4),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              isAdmin ? 'Org Expense Reports' : 'My Expense Reports',
              style: tt.titleSmall?.copyWith(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _Stat(
                    label: "Today",
                    value: formatRwf(today),
                    accent: cs.primary,
                  ),
                ),
                Expanded(
                  child: _Stat(
                    label: "This month",
                    value: formatRwf(month),
                    align: TextAlign.right,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({
    required this.label,
    required this.value,
    this.align = TextAlign.left,
    this.accent,
  });
  final String label;
  final String value;
  final TextAlign align;
  final Color? accent;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment:
          align == TextAlign.right ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        Text(label,
            style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
            textAlign: align),
        const SizedBox(height: 2),
        Text(
          value,
          style: tt.titleMedium?.copyWith(
            fontWeight: FontWeight.bold,
            color: accent ?? cs.onSurface,
          ),
          textAlign: align,
        ),
      ],
    );
  }
}
