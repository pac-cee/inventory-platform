
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../../models.dart';
import '../../repository.dart';
import '../../widgets.dart';
import 'condition_report_view.dart';
import 'report_pdf.dart';
import '../../widgets/search_button.dart';

/// Admin reports. Two different questions, so two tabs:
///
///   Activity  — what HAPPENED (a filtered read over the movement ledger: time,
///               location incl. nested sub-locations, item, activity, person)
///   Condition — what STATE things are in now (room, category, quantity,
///               condition, % operational, recommendation)
///
/// Both export a PDF from one button in the top-right, which appears once
/// that tab has results. Mirrors the web Reports page.
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

const _reasonOptions = <(String, String)>[
  ('take', 'Taken'),
  ('return', 'Returned'),
  ('destroyed', 'Damaged'),
  ('lost', 'Lost'),
  ('finish', 'Finished'),
  ('repair', 'Repaired'),
  ('initial', 'Stocked'),
  ('adjust', 'Adjusted'),
];

class _ReportsScreenState extends State<ReportsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this)
    ..addListener(() => setState(() {}));

  /// Set by the condition tab when it has rows to export.
  Future<void> Function()? _conditionExport;

  final _repo = const InventoryRepository();
  final _users = const UsersRepository();

  List<Location> _locations = [];
  List<Item> _items = [];
  List<Profile> _profiles = [];
  bool _loadingOptions = true;

  // Filters
  DateTime? _from;
  DateTime? _to;
  String? _locationId;
  String? _itemId;
  String? _userId;
  String _personField = 'attributed';
  final Set<String> _reasons = {};
  bool _includeUndone = false;

  ActivityReport? _report;
  bool _running = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _loadOptions();
  }

  Future<void> _loadOptions() async {
    try {
      final results = await Future.wait([
        _repo.fetchLocations(),
        _repo.fetchItems(),
        _users.fetchProfiles(),
      ]);
      if (!mounted) return;
      setState(() {
        _locations = results[0] as List<Location>;
        _items = results[1] as List<Item>;
        _profiles = results[2] as List<Profile>;
        _loadingOptions = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loadingOptions = false;
      });
    }
  }

  /// Full location path, e.g. "Room › Cupboard › Level".
  String _pathOf(String id) {
    final byId = {for (final l in _locations) l.id: l};
    final parts = <String>[];
    final seen = <String>{};
    Location? cur = byId[id];
    while (cur != null && !seen.contains(cur.id)) {
      seen.add(cur.id);
      parts.insert(0, cur.name);
      cur = cur.parentId != null ? byId[cur.parentId] : null;
    }
    return parts.join(' › ');
  }

  Future<void> _run() async {
    setState(() {
      _running = true;
      _error = null;
    });
    try {
      final report = await _repo.fetchActivityReport(ReportFilters(
        from: _from,
        to: _to,
        locationId: _locationId,
        itemId: _itemId,
        userId: _userId,
        personField: _personField,
        reasons: _reasons.toList(),
        includeUndone: _includeUndone,
      ));
      if (!mounted) return;
      setState(() {
        _report = report;
        _running = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _running = false;
      });
    }
  }

  void _reset() {
    setState(() {
      _from = null;
      _to = null;
      _locationId = null;
      _itemId = null;
      _userId = null;
      _personField = 'attributed';
      _reasons.clear();
      _includeUndone = false;
      _report = null;
      _error = null;
    });
  }

  void _preset(String kind) {
    final now = DateTime.now();
    setState(() {
      _to = DateTime(now.year, now.month, now.day, 23, 59, 59);
      switch (kind) {
        case 'today':
          _from = DateTime(now.year, now.month, now.day);
          break;
        case '7':
          _from = DateTime(now.year, now.month, now.day).subtract(const Duration(days: 7));
          break;
        case '30':
          _from = DateTime(now.year, now.month, now.day).subtract(const Duration(days: 30));
          break;
        case 'month':
          _from = DateTime(now.year, now.month, 1);
          break;
      }
    });
  }

  Future<void> _pickDate({required bool isFrom}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: (isFrom ? _from : _to) ?? now,
      firstDate: DateTime(2020),
      lastDate: DateTime(now.year + 1),
    );
    if (picked == null) return;
    setState(() {
      if (isFrom) {
        _from = DateTime(picked.year, picked.month, picked.day);
      } else {
        _to = DateTime(picked.year, picked.month, picked.day, 23, 59, 59);
      }
    });
  }

  Future<void> _sharePdf() async {
    final report = _report;
    if (report == null || report.rows.isEmpty) return;
    // Mirrors the row order below: type, name, model, specification, SKU.
    final head = ['When', 'Action', 'Units', 'Item type', 'Name', 'Model', 'Specification', 'SKU', 'Location', 'Attributed to', 'Recorded by', 'Note', 'Undone'];
    final rows = [
      for (final r in report.rows)
        [
          r.createdAt.toLocal().toString(),
          r.label,
          '${r.units}',
          r.itemType,
          r.itemName,
          r.itemModel,
          r.itemSpecification ?? '',
          r.itemSku,
          r.locationName,
          r.personName ?? '',
          r.actorName ?? '',
          r.note ?? '',
          r.reversed ? 'yes' : '',
        ],
    ];
    final bytes = await buildReportPdf(
      title: 'Activity Report',
      head: head,
      // One untitled block: activity is a flat ledger, not grouped by room.
      sections: [PdfSection(title: '', rows: [for (final r in rows) PdfRow(r)])],
      rightAligned: const [2],
    );
    await Share.shareXFiles(
      [XFile.fromData(bytes, mimeType: 'application/pdf', name: 'activity_report.pdf')],
      subject: 'Activity Report',
    );
  }

  @override
  Widget build(BuildContext context) {
    // One export button for both tabs, in the same place: whichever tab is
    // showing supplies the callback, and it is absent until that tab has run.
    final onExport = _tabs.index == 0
        ? ((_report != null && _report!.rows.isNotEmpty) ? _sharePdf : null)
        : _conditionExport;

    return Scaffold(
        appBar: AppBar(
          title: const Text('Reports'),
          actions: [
            const SearchButton(),
            if (onExport != null)
              IconButton(
                tooltip: 'Export PDF',
                icon: const Icon(Icons.ios_share),
                onPressed: onExport,
              ),
          ],
          bottom: TabBar(
            controller: _tabs,
            tabs: const [
              Tab(text: 'Activity'),
              Tab(text: 'Condition'),
            ],
          ),
        ),
        body: TabBarView(
          controller: _tabs,
          children: [
            _loadingOptions
                ? const Center(child: CircularProgressIndicator())
                : ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      _buildFilters(),
                      const SizedBox(height: 12),
                      if (_error != null)
                        Padding(
                          padding: const EdgeInsets.all(12),
                          child: Text('$_error',
                              style: const TextStyle(color: Colors.redAccent)),
                        ),
                      if (_report != null) ..._buildResults(_report!),
                    ],
                  ),
            ConditionReportView(
              onExportChanged: (cb) {
                if (_conditionExport == cb) return;
                // Called from the child's build/dispose cycle, so defer.
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (mounted) setState(() => _conditionExport = cb);
                });
              },
            ),
          ],
        ),
    );
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Widget _buildFilters() {
    final df = _fmtDate(_from);
    final dt = _fmtDate(_to);
    return SectionCard(
      title: 'Filters',
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: 8,
              children: [
                OutlinedButton(onPressed: () => _preset('today'), child: const Text('Today')),
                OutlinedButton(onPressed: () => _preset('7'), child: const Text('7 days')),
                OutlinedButton(onPressed: () => _preset('30'), child: const Text('30 days')),
                OutlinedButton(onPressed: () => _preset('month'), child: const Text('This month')),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.calendar_today, size: 16),
                    label: Text(df == null ? 'From' : 'From $df'),
                    onPressed: () => _pickDate(isFrom: true),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.calendar_today, size: 16),
                    label: Text(dt == null ? 'To' : 'To $dt'),
                    onPressed: () => _pickDate(isFrom: false),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String?>(
              initialValue: _locationId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Location (includes nested)'),
              items: [
                const DropdownMenuItem(value: null, child: Text('All locations')),
                for (final l in _locations)
                  DropdownMenuItem(value: l.id, child: Text(_pathOf(l.id), overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) => setState(() => _locationId = v),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String?>(
              initialValue: _itemId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Item'),
              items: [
                const DropdownMenuItem(value: null, child: Text('All items')),
                for (final it in _items)
                  DropdownMenuItem(
                      value: it.id,
                      child: Text('${it.type} · ${it.sku}',
                          overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) => setState(() => _itemId = v),
            ),
            const SizedBox(height: 16),
            const Align(alignment: Alignment.centerLeft, child: Text('Activity type')),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                for (final (value, label) in _reasonOptions)
                  FilterChip(
                    label: Text(label),
                    selected: _reasons.contains(value),
                    onSelected: (on) => setState(() {
                      if (on) {
                        _reasons.add(value);
                      } else {
                        _reasons.remove(value);
                      }
                    }),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String?>(
              initialValue: _userId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Person'),
              items: [
                const DropdownMenuItem(value: null, child: Text('Everyone')),
                for (final p in _profiles)
                  DropdownMenuItem(value: p.id, child: Text(p.fullName ?? 'Unknown')),
              ],
              onChanged: (v) => setState(() => _userId = v),
            ),
            if (_userId != null) ...[
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _personField,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Match person as'),
                items: const [
                  DropdownMenuItem(value: 'attributed', child: Text("Who it's attributed to")),
                  DropdownMenuItem(value: 'actor', child: Text('Who recorded it')),
                ],
                onChanged: (v) => setState(() => _personField = v ?? 'attributed'),
              ),
            ],
            const SizedBox(height: 4),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Include undone / reversed entries'),
              value: _includeUndone,
              onChanged: (v) => setState(() => _includeUndone = v),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _running ? null : _run,
                    icon: const Icon(Icons.play_arrow_rounded),
                    label: Text(_running ? 'Running…' : 'Run report'),
                  ),
                ),
                const SizedBox(width: 12),
                OutlinedButton(onPressed: _running ? null : _reset, child: const Text('Reset')),
              ],
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildResults(ActivityReport report) {
    if (report.count == 0) {
      return const [
        SizedBox(height: 40),
        Center(child: Text('No activities match these filters.')),
      ];
    }
    return [
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
        child: Text('${report.count} activities match', style: const TextStyle(fontWeight: FontWeight.w600)),
      ),
      _summaryCard('By activity', report.byReason),
      const SizedBox(height: 12),
      _summaryCard('By person', report.byPerson),
      const SizedBox(height: 12),
      _summaryCard('By item', report.byItem),
      const SizedBox(height: 12),
      SectionCard(
        title: 'Activities',
        child: Column(
          children: [
            for (final r in report.rows) ...[
              Opacity(
                opacity: r.reversed ? 0.5 : 1,
                child: ListTile(
                  dense: true,
                  title: Text('${r.label}${r.reversed ? '  (undone)' : ''}',
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text(
                    '${r.itemType} · ${r.itemName}${r.itemSku.isEmpty ? '' : ' · ${r.itemSku}'}\n'
                    '${r.locationName}\n'
                    '${r.personName ?? '—'}'
                    '${r.actorName != null && r.actorId != r.personId ? '  ·  by ${r.actorName}' : ''}'
                    '${r.note == null ? '' : '\n${r.note}'}',
                  ),
                  isThreeLine: true,
                  trailing: Text(_fmtDateTime(r.createdAt),
                      style: Theme.of(context).textTheme.bodySmall),
                ),
              ),
              const Divider(height: 1),
            ],
          ],
        ),
      ),
    ];
  }

  Widget _summaryCard(String title, List<ReportBucket> buckets) {
    final top = buckets.take(8).toList();
    return SectionCard(
      title: title,
      child: top.isEmpty
          ? const Padding(padding: EdgeInsets.all(16), child: Text('Nothing to show.'))
          : Column(
              children: [
                for (final b in top)
                  ListTile(
                    dense: true,
                    title: Text(b.name, overflow: TextOverflow.ellipsis),
                    trailing: Text('${b.count} → ${b.units} units',
                        style: Theme.of(context).textTheme.bodySmall),
                  ),
              ],
            ),
    );
  }

  String? _fmtDate(DateTime? d) => d == null ? null : '${d.year}-${_pad2(d.month)}-${_pad2(d.day)}';
  String _fmtDateTime(DateTime d) {
    final l = d.toLocal();
    return '${_pad2(l.month)}/${_pad2(l.day)} ${_pad2(l.hour)}:${_pad2(l.minute)}';
  }

  String _pad2(int n) => n.toString().padLeft(2, '0');
}
