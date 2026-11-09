import 'package:flutter/material.dart';

import '../../config/theme.dart';

import '../../models.dart';
import 'new_request_sheet.dart';

class TransactionRow extends StatelessWidget {
  const TransactionRow({super.key, required this.tx, this.onTap});
  final PaymentTransaction tx;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    final (color, label) = _statusMeta(tx.status, cs);

    final productSummary = tx.products.isNotEmpty
        ? tx.products.map((p) => '${p.name} ×${p.quantity}').join(', ')
        : tx.recipientLabel;

    final date = _fmtDate(tx.createdAt);

    return InkWell(
      onTap: onTap,
      child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 3),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: StatusColors.text(context, color),
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  productSummary,
                  style: tt.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  [
                    if (tx.locationName != null) tx.locationName!,
                    if (tx.createdByName != null) tx.createdByName!,
                    date,
                  ].join(' · '),
                  style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (tx.products.isEmpty)
                  const SizedBox.shrink()
                else
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      'To: ${tx.recipientLabel}',
                      style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            formatRwf(tx.amount),
            style: tt.bodyMedium?.copyWith(fontWeight: FontWeight.bold),
          ),
        ],
      ),
    ));
  }

  (Color, String) _statusMeta(PaymentStatus status, ColorScheme cs) {
    switch (status) {
      case PaymentStatus.pending:
        return (const Color(0xFFF59E0B), 'Pending');
      case PaymentStatus.processing:
        return (const Color(0xFF3B82F6), 'Processing');
      case PaymentStatus.completed:
        return (const Color(0xFF22C55E), 'Approved');
      case PaymentStatus.failed:
        return (const Color(0xFFEF4444), 'Failed');
    }
  }

  String _fmtDate(DateTime dt) {
    final now = DateTime.now();
    final diff = now.difference(dt);
    if (diff.inDays == 0) return 'Today';
    if (diff.inDays == 1) return 'Yesterday';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${dt.day}/${dt.month}/${dt.year}';
  }
}
