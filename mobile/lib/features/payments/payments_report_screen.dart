import 'package:flutter/material.dart';

import '../../models.dart';
import '../../payment_repository.dart';
import '../../payments_report.dart';
import '../../widgets/error_state.dart';

/// Admins and cashiers: where the money went — by status and by person — for a
/// date range. Pull down to refresh.
class PaymentsReportScreen extends StatefulWidget {
  const PaymentsReportScreen({super.key});

  @override
  State<PaymentsReportScreen> createState() => _PaymentsReportScreenState();
}

class _PaymentsReportScreenState extends State<PaymentsReportScreen> {
  final _repo = const PaymentRepository();
  late Future<List<PaymentTransaction>> _future = _repo.fetchAllTransactions();
  DateTime? _from;
  DateTime? _to;

  Future<void> _refresh() async {
    final next = _repo.fetchAllTransactions();
    setState(() {
      _future = next;
    });
    await next.catchError((_) => <PaymentTransaction>[]);
  }

  static String _day(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _pick({required bool from}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: (from ? _from : _to) ?? now,
      firstDate: DateTime(2024),
      lastDate: now.add(const Duration(days: 1)),
    );
    if (picked == null) return;
    setState(() => from ? _from = picked : _to = picked);
  }

  static Color _statusColor(PaymentStatus s, ColorScheme cs) => switch (s) {
        PaymentStatus.completed => const Color(0xFF15803D),
        PaymentStatus.failed => cs.error,
        _ => cs.onSurfaceVariant,
      };

  static String _statusLabel(PaymentStatus s) => switch (s) {
        PaymentStatus.completed => 'Paid',
        PaymentStatus.processing => 'Processing',
        PaymentStatus.pending => 'Awaiting approval',
        PaymentStatus.failed => 'Failed',
      };

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Payments report')),
      body: FutureBuilder<List<PaymentTransaction>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError && !snap.hasData) {
            return ErrorState(message: '${snap.error}', onRetry: _refresh);
          }
          final shown = inRange(snap.data ?? const [], _from, _to);
          final statuses = totalsByStatus(shown);
          final people = totalsByPerson(shown);
          final paid = shown.where(movedMoney).fold(0.0, (s, t) => s + t.amount);

          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              children: [
                Row(children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _pick(from: true),
                      icon: const Icon(Icons.event, size: 18),
                      label: Text(_from == null ? 'From' : _day(_from!)),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _pick(from: false),
                      icon: const Icon(Icons.event, size: 18),
                      label: Text(_to == null ? 'To' : _day(_to!)),
                    ),
                  ),
                  if (_from != null || _to != null)
                    IconButton(
                      tooltip: 'Clear dates',
                      icon: const Icon(Icons.close),
                      onPressed: () => setState(() {
                        _from = null;
                        _to = null;
                      }),
                    ),
                ]),
                const SizedBox(height: 16),
                Text('PAID OUT', style: TextStyle(fontSize: 11, letterSpacing: 0.6, color: cs.onSurfaceVariant)),
                Text(rwf(paid), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w600)),
                const SizedBox(height: 16),
                Card(
                  child: Column(children: [
                    for (final s in statuses)
                      ListTile(
                        dense: true,
                        title: Text(_statusLabel(s.status)),
                        subtitle: Text('${s.count} payment${s.count == 1 ? '' : 's'}'),
                        trailing: Text(rwf(s.amount),
                            style: TextStyle(fontWeight: FontWeight.w600, color: _statusColor(s.status, cs))),
                      ),
                  ]),
                ),
                const SizedBox(height: 16),
                Text('BY PERSON', style: TextStyle(fontSize: 11, letterSpacing: 0.6, color: cs.onSurfaceVariant)),
                const SizedBox(height: 4),
                if (people.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 32),
                    child: Text('No payments in this range.',
                        textAlign: TextAlign.center, style: TextStyle(color: cs.onSurfaceVariant)),
                  ),
                for (final p in people)
                  Card(
                    child: ListTile(
                      title: Text(p.name),
                      subtitle: Text([
                        '${p.requests} request${p.requests == 1 ? '' : 's'}',
                        if (p.waiting > 0) '${rwf(p.waiting)} waiting',
                        if (p.failed > 0) '${p.failed} failed',
                      ].join(' · ')),
                      trailing: Text(rwf(p.paid), style: const TextStyle(fontWeight: FontWeight.w600)),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}
