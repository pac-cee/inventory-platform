import 'package:flutter/material.dart';

import '../../models.dart';
import '../../payment_repository.dart';
import 'new_request_sheet.dart';

class BudgetCard extends StatefulWidget {
  const BudgetCard({
    super.key,
    required this.budget,
    required this.onUpdated,
    this.balance,
  });
  final PaymentBudget budget;
  final PaymentBalance? balance;
  final void Function(PaymentBudget) onUpdated;

  @override
  State<BudgetCard> createState() => _BudgetCardState();
}

class _BudgetCardState extends State<BudgetCard> {
  final _repo = const PaymentRepository();

  void _openSetAllocation() {
    showDialog<void>(
      context: context,
      builder: (_) => _AllocationDialog(
        current: widget.budget.allocatedAmount,
        minAmount: widget.budget.usedAmount,
        onSave: (amount) async {
          final updated = await _repo.setBudget(amount);
          if (mounted) widget.onUpdated(updated);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    final budget = widget.budget;
    final pct = budget.utilizationPct;
    final barColor = pct > 85
        ? const Color(0xFFEF4444)
        : pct > 60
            ? const Color(0xFFF59E0B)
            : const Color(0xFF22C55E);
    final monthName = _monthName(budget.month);

    return Card(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Monthly Budget',
                        style: tt.titleSmall
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                      Text(
                        '$monthName ${budget.year}',
                        style: tt.bodySmall
                            ?.copyWith(color: cs.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                TextButton(
                  onPressed: _openSetAllocation,
                  child: const Text('Set allocation'),
                ),
              ],
            ),
            if (widget.balance != null) ...[
              const SizedBox(height: 6),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: cs.primaryContainer.withValues(alpha: 0.4),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.account_balance_wallet_outlined,
                        size: 14, color: cs.primary),
                    const SizedBox(width: 6),
                    Text(
                      'MoMo balance: ${formatRwf(widget.balance!.availableBalance)}',
                      style: tt.bodySmall?.copyWith(
                          color: cs.primary, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _BudgetStat(
                    label: 'Allocated',
                    value: formatRwf(budget.allocatedAmount),
                  ),
                ),
                Expanded(
                  child: _BudgetStat(
                    label: 'Used',
                    value: formatRwf(budget.usedAmount),
                    valueColor: barColor,
                  ),
                ),
                Expanded(
                  child: _BudgetStat(
                    label: 'Remaining',
                    value: formatRwf(budget.remainingAmount),
                    align: TextAlign.right,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: (pct / 100).clamp(0.0, 1.0),
                minHeight: 6,
                backgroundColor: cs.surfaceContainerHighest,
                valueColor: AlwaysStoppedAnimation<Color>(barColor),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              '${pct.toStringAsFixed(0)}% utilized',
              style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }

  String _monthName(int m) => const [
        '',
        'January', 'February', 'March', 'April',
        'May', 'June', 'July', 'August',
        'September', 'October', 'November', 'December'
      ][m];
}

class _BudgetStat extends StatelessWidget {
  const _BudgetStat({
    required this.label,
    required this.value,
    this.valueColor,
    this.align = TextAlign.left,
  });
  final String label;
  final String value;
  final Color? valueColor;
  final TextAlign align;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: align == TextAlign.right
          ? CrossAxisAlignment.end
          : CrossAxisAlignment.start,
      children: [
        Text(label,
            style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
            textAlign: align),
        Text(value,
            style: tt.bodySmall?.copyWith(
                fontWeight: FontWeight.w600,
                color: valueColor ?? cs.onSurface),
            textAlign: align),
      ],
    );
  }
}

class _AllocationDialog extends StatefulWidget {
  const _AllocationDialog({
    required this.current,
    required this.minAmount,
    required this.onSave,
  });
  final double current;
  final double minAmount;
  final Future<void> Function(double) onSave;

  @override
  State<_AllocationDialog> createState() => _AllocationDialogState();
}

class _AllocationDialogState extends State<_AllocationDialog> {
  late final TextEditingController _ctrl;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController(
      text: widget.current > 0 ? widget.current.round().toString() : '',
    );
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final amount = double.tryParse(_ctrl.text.trim()) ?? -1;
    if (amount < 0) {
      setState(() => _error = 'Enter a valid amount.');
      return;
    }
    if (amount < widget.minAmount) {
      setState(() => _error =
          'Cannot set below current usage of ${formatRwf(widget.minAmount)}.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.onSave(amount);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = '$e';
          _saving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Set Monthly Allocation'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _ctrl,
            autofocus: true,
            keyboardType:
                const TextInputType.numberWithOptions(decimal: false),
            decoration: const InputDecoration(
              labelText: 'Amount (RWF)',
              hintText: 'e.g. 500000',
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(_error!,
                  style: const TextStyle(color: Color(0xFFEF4444))),
            ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: Text(_saving ? 'Saving…' : 'Save'),
        ),
      ],
    );
  }
}
