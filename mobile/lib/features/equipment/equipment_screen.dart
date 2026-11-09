import 'package:flutter/material.dart';

import '../../equipment_audit.dart';
import '../../models.dart';
import '../../repository.dart';
import '../../widgets/search_button.dart';
import '../items/item_detail_screen.dart';
import 'recent_activity_view.dart';
import '../../widgets/error_state.dart';

/// Managers: who is holding what and when it is due back, with filters and
/// per-person totals. Pull down to refresh.
class EquipmentScreen extends StatefulWidget {
  const EquipmentScreen({super.key});

  @override
  State<EquipmentScreen> createState() => _EquipmentScreenState();
}

class _EquipmentScreenState extends State<EquipmentScreen> {
  static const _filters = {
    'all': 'All',
    'overdue': 'Overdue',
    'due_today': 'Due today',
    'upcoming': 'Upcoming',
    'none': 'No date',
  };

  final _repo = const InventoryRepository();
  late Future<List<Loan>> _future = _repo.fetchAllLoans();
  String _status = 'all';
  String _query = '';

  // 'out' = who holds what now; 'recent' = who took or returned what lately.
  String _mode = 'out';

  Future<void> _refresh() async {
    final next = _repo.fetchAllLoans();
    setState(() {
      _future = next;
    });
    await next.catchError((_) => <Loan>[]);
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Borrowed equipment'), actions: const [SearchButton()]),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: SizedBox(
              width: double.infinity,
              child: SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'out', label: Text('Out now'), icon: Icon(Icons.assignment_ind_outlined)),
                  ButtonSegment(value: 'recent', label: Text('Recent activity'), icon: Icon(Icons.history)),
                ],
                selected: {_mode},
                onSelectionChanged: (s) => setState(() => _mode = s.first),
              ),
            ),
          ),
          Expanded(child: _mode == 'recent' ? const RecentActivityView() : _outNow(cs)),
        ],
      ),
    );
  }

  Widget _outNow(ColorScheme cs) {
    {
      return FutureBuilder<List<Loan>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError && !snap.hasData) {
            return ErrorState(message: '${snap.error}', onRetry: _refresh);
          }
          final all = snap.data ?? const <Loan>[];
          final shown = filterLoans(all, _status, _query);
          final totals = summarize(shown);
          final groups = groupByPerson(shown);

          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              children: [
                Row(children: [
                  _Stat('Loans', '${totals.loans}'),
                  _Stat('Units', '${totals.units}'),
                  _Stat('People', '${totals.people}'),
                  _Stat('Overdue', '${totals.overdue}', bad: totals.overdue > 0),
                ]),
                const SizedBox(height: 12),
                TextField(
                  decoration: const InputDecoration(
                    hintText: 'Filter by person, item or place',
                    prefixIcon: Icon(Icons.filter_list),
                    isDense: true,
                  ),
                  onChanged: (v) => setState(() => _query = v),
                ),
                const SizedBox(height: 8),
                Wrap(spacing: 8, children: [
                  for (final e in _filters.entries)
                    ChoiceChip(
                      label: Text(e.value),
                      selected: _status == e.key,
                      onSelected: (_) => setState(() => _status = e.key),
                    ),
                ]),
                const SizedBox(height: 8),
                if (groups.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 48),
                    child: Text(
                      all.isEmpty ? 'Nothing is borrowed right now.' : 'No loans match those filters.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: cs.onSurfaceVariant),
                    ),
                  ),
                for (final g in groups) _PersonCard(group: g),
              ],
            ),
          );
        },
      );
    }
  }
}

class _Stat extends StatelessWidget {
  const _Stat(this.label, this.value, {this.bad = false});
  final String label;
  final String value;
  final bool bad;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Expanded(
      child: Column(children: [
        Text(value,
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: bad ? cs.error : cs.onSurface)),
        Text(label, style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
      ]),
    );
  }
}

class _PersonCard extends StatelessWidget {
  const _PersonCard({required this.group});
  final PersonGroup group;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.only(top: 12),
      clipBehavior: Clip.antiAlias,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Row(children: [
            Expanded(child: Text(group.userName, style: const TextStyle(fontWeight: FontWeight.w600))),
            Text(
              '${group.units} unit${group.units == 1 ? '' : 's'}'
              '${group.overdue > 0 ? ' · ${group.overdue} overdue' : ''}',
              style: TextStyle(fontSize: 12, color: group.overdue > 0 ? cs.error : cs.onSurfaceVariant),
            ),
          ]),
        ),
        for (final l in group.loans)
          ListTile(
            dense: true,
            title: Text('${l.quantity} × ${l.itemName}', maxLines: 2, overflow: TextOverflow.ellipsis),
            subtitle: l.locationName.isEmpty ? null : Text(l.locationName),
            trailing: Text(
              l.dueText,
              style: TextStyle(fontSize: 12, color: l.isOverdue ? cs.error : cs.onSurfaceVariant),
            ),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => ItemDetailScreen(itemId: l.itemId, locationId: l.locationId.isEmpty ? null : l.locationId),
              ),
            ),
          ),
      ]),
    );
  }
}
