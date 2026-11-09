import 'package:flutter/material.dart';

import '../../models.dart';
import '../../payment_repository.dart';
import '../payments/new_request_sheet.dart';

class UserReportSheet extends StatefulWidget {
  const UserReportSheet({super.key, required this.profile});

  final Profile profile;

  @override
  State<UserReportSheet> createState() => _UserReportSheetState();
}

class _UserReportSheetState extends State<UserReportSheet> {
  final _repo = const PaymentRepository();
  UserReport? _report;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final report = await _repo.fetchUserReport(widget.profile.id);
      if (!mounted) return;
      setState(() {
        _report = report;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    final name = widget.profile.fullName ?? 'User';

    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (context, scroll) => Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Row(
              children: [
                Icon(Icons.bar_chart_rounded, color: cs.primary),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Spending Report', style: tt.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
                      Text(name, style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(child: Text(_error!, style: TextStyle(color: cs.error)))
                    : _ReportBody(
                        report: _report!,
                        profile: widget.profile,
                        scrollController: scroll,
                      ),
          ),
        ],
      ),
    );
  }
}

class _ReportBody extends StatelessWidget {
  const _ReportBody({
    required this.report,
    required this.profile,
    required this.scrollController,
  });

  final UserReport report;
  final Profile profile;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    final muted = cs.onSurfaceVariant;

    return ListView(
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        Row(
          children: [
            Expanded(child: _SpendCard(label: 'Today', spent: report.dailySpent, limit: profile.dailyLimit)),
            const SizedBox(width: 10),
            Expanded(child: _SpendCard(label: 'This month', spent: report.monthlySpent, limit: profile.monthlyLimit)),
          ],
        ),
        const SizedBox(height: 10),
        _LifetimeRow(lifetimeSpent: report.lifetimeSpent, perTxLimit: profile.perTransactionLimit),
        const SizedBox(height: 20),
        Text('Recent transactions', style: tt.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        if (report.recentTransactions.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 24),
            child: Center(
              child: Text('No transactions yet.', style: TextStyle(color: muted)),
            ),
          )
        else
          ...report.recentTransactions.map((tx) => _TxRow(tx: tx)),
      ],
    );
  }
}

class _SpendCard extends StatelessWidget {
  const _SpendCard({required this.label, required this.spent, required this.limit});

  final String label;
  final double spent;
  final double limit;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    final hasLimit = limit > 0;
    final pct = hasLimit ? (spent / limit * 100).clamp(0.0, 100.0) : 0.0;
    final barColor = pct > 85
        ? const Color(0xFFEF4444)
        : pct > 60
            ? const Color(0xFFF59E0B)
            : const Color(0xFF22C55E);

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
          const SizedBox(height: 4),
          Text(formatRwf(spent), style: tt.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
          Text(
            hasLimit ? '/ ${formatRwf(limit)}' : 'No limit',
            style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant, fontSize: 11),
          ),
          if (hasLimit) ...[
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: pct / 100,
                minHeight: 5,
                backgroundColor: cs.surfaceContainerLowest,
                valueColor: AlwaysStoppedAnimation<Color>(barColor),
              ),
            ),
            const SizedBox(height: 4),
            Text('${pct.toStringAsFixed(0)}%', style: tt.bodySmall?.copyWith(fontSize: 10, color: cs.onSurfaceVariant)),
          ],
        ],
      ),
    );
  }
}

class _LifetimeRow extends StatelessWidget {
  const _LifetimeRow({required this.lifetimeSpent, required this.perTxLimit});

  final double lifetimeSpent;
  final double perTxLimit;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Lifetime', style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                Text(formatRwf(lifetimeSpent), style: tt.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('Per-tx limit', style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
              Text(
                perTxLimit > 0 ? formatRwf(perTxLimit) : 'No cap',
                style: tt.bodySmall?.copyWith(fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TxRow extends StatelessWidget {
  const _TxRow({required this.tx});

  final ReportTransaction tx;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    final muted = cs.onSurfaceVariant;
    final (badgeColor, badgeBg) = _statusColors(tx.status, cs);
    final productSummary = tx.products.isEmpty
        ? 'No items'
        : tx.products.map((p) => '${p.name} ×${p.quantity}').join(', ');

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(color: badgeBg, borderRadius: BorderRadius.circular(999)),
            child: Text(
              _statusLabel(tx.status),
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: badgeColor),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(productSummary, style: tt.bodySmall?.copyWith(fontWeight: FontWeight.w500), maxLines: 1, overflow: TextOverflow.ellipsis),
                Text(
                  '${tx.locationName ?? tx.recipientPhone} · ${_date(tx.createdAt)}',
                  style: tt.bodySmall?.copyWith(color: muted, fontSize: 11),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(formatRwf(tx.amount), style: tt.bodySmall?.copyWith(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  (Color, Color) _statusColors(String status, ColorScheme cs) => switch (status) {
        'completed' => (const Color(0xFF10B981), const Color(0xFF10B981).withValues(alpha: 0.12)),
        'pending'   => (const Color(0xFFF59E0B), const Color(0xFFF59E0B).withValues(alpha: 0.12)),
        'failed'    => (const Color(0xFFEF4444), const Color(0xFFEF4444).withValues(alpha: 0.12)),
        _           => (cs.onSurfaceVariant,     cs.surfaceContainerHighest),
      };

  String _statusLabel(String s) => switch (s) {
        'completed' => 'Done',
        'pending'   => 'Pending',
        'processing'=> 'Processing',
        'failed'    => 'Failed',
        _           => s,
      };

  String _date(DateTime dt) {
    final d = dt.toLocal();
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }
}
