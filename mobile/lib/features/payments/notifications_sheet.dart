import 'package:flutter/material.dart';

import '../../config/api_client.dart';
import '../../models.dart';
import '../../payment_repository.dart';
import 'new_request_sheet.dart';

/// Page version of the web's admin notification bell: a live list of pending
/// approvals (with inline Approve/Reject) plus pending-receipt nudges.
/// Opened as a full route from the bell, not a draggable sheet.
class NotificationsPage extends StatefulWidget {
  const NotificationsPage({
    super.key,
    required this.transactions,
    required this.currentUserName,
    this.balance,
    this.onResolved,
    this.onOpenDetail,
  });
  final List<PaymentTransaction> transactions;
  final String currentUserName;
  final String? balance;
  final void Function(String id, PaymentStatus)? onResolved;
  final void Function(PaymentTransaction)? onOpenDetail;

  @override
  State<NotificationsPage> createState() => _NotificationsPageState();
}

class _NotificationsPageState extends State<NotificationsPage> {
  final _repo = const PaymentRepository();
  final Map<String, bool> _resolving = {};

  List<PaymentTransaction> get _pendingApproval =>
      widget.transactions.where((t) => t.status == PaymentStatus.pending).toList();

  List<PaymentTransaction> get _pendingReceipts => widget
      .transactions
      .where((t) =>
          t.status == PaymentStatus.completed &&
          t.receiptPhoto == null &&
          t.createdByName == widget.currentUserName)
      .toList();

  Future<void> _resolve(PaymentTransaction tx, bool approve) async {
    setState(() => _resolving[tx.id] = true);
    try {
      final newStatus =
          await _repo.resolvePayment(id: tx.id, approve: approve);
      if (!mounted) return;
      widget.onResolved?.call(tx.id, newStatus);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      setState(() => _resolving.remove(tx.id));
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Failed: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final approvals = _pendingApproval;
    final receipts = _pendingReceipts;
    final isAdmin = api.isAdmin;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (widget.balance != null)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Center(
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: cs.primaryContainer,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    'Bal: ${widget.balance}',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: cs.onPrimaryContainer,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 16),
        children: [
          // Web parity: approvals (admin/cashier-only) and this user's own
          // pending receipts are both shown together, not one or the other.
          if (isAdmin)
            for (final tx in approvals) ...[
              _ApprovalTile(
                tx: tx,
                resolving: _resolving[tx.id] ?? false,
                onApprove: () => _resolve(tx, true),
                onReject: () => _resolve(tx, false),
                onOpen: () {
                  widget.onOpenDetail?.call(tx);
                },
              ),
              const SizedBox(height: 8),
            ],
          for (final tx in receipts) ...[
            _ReceiptTile(tx: tx, onOpen: () {
              widget.onOpenDetail?.call(tx);
            }),
            const SizedBox(height: 8),
          ],
          if ((!isAdmin || approvals.isEmpty) && receipts.isEmpty)
            const _EmptyNote('Nothing to review right now.'),
        ],
      ),
    );
  }
}
class _EmptyNote extends StatelessWidget {
  const _EmptyNote(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 48),
        child: Center(
          child: Text(
            text,
            style: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
        ),
      );
}

class _ApprovalTile extends StatelessWidget {
  const _ApprovalTile({
    required this.tx,
    required this.resolving,
    required this.onApprove,
    required this.onReject,
    required this.onOpen,
  });
  final PaymentTransaction tx;
  final bool resolving;
  final VoidCallback onApprove;
  final VoidCallback onReject;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final summary = tx.products.isNotEmpty
        ? tx.products.map((p) => '${p.name} ×${p.quantity}').join(', ')
        : tx.recipientLabel;
    final time =
        '${tx.createdAt.hour.toString().padLeft(2, '0')}:${tx.createdAt.minute.toString().padLeft(2, '0')}';
    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: onOpen,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(summary,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis),
              const SizedBox(height: 2),
              Text(
                'To: ${tx.recipientLabel} · ${formatRwf(tx.amount)} · $time',
                style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: resolving ? null : onReject,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFFEF4444),
                        side: const BorderSide(color: Color(0xFFEF4444)),
                      ),
                      child: const Text('Reject'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      onPressed: resolving ? null : onApprove,
                      child: resolving
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white),
                            )
                          : const Text('Approve'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ReceiptTile extends StatelessWidget {
  const _ReceiptTile({required this.tx, this.onOpen});
  final PaymentTransaction tx;
  final VoidCallback? onOpen;
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        leading: const Icon(Icons.receipt_long_outlined),
        title: Text('Upload receipt: ${tx.products.firstOrNull?.name ?? tx.recipientLabel}'),
        subtitle: Text('Approved · ${formatRwf(tx.amount)}',
            style: TextStyle(color: cs.onSurfaceVariant, fontSize: 12)),
        trailing: const Icon(Icons.chevron_right),
        onTap: onOpen,
      ),
    );
  }
}
