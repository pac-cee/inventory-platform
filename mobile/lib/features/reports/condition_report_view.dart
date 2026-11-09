
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../../models.dart';
import '../../repository.dart';
import 'condition_grouping.dart';
import 'report_pdf.dart';

/// The condition report — what state everything is in right now, grouped by
/// room and category: quantity, condition, % operational and what to do.
///
/// Nothing here is stored. Quantity and % operational fall out of the stock
/// balances, and the condition sentence is a tally of the reasons recorded when
/// units were marked damaged. Mirrors the web Reports → Condition tab.
class ConditionReportView extends StatefulWidget {
  const ConditionReportView({super.key, this.onExportChanged});

  /// Called with a callback that exports the current rows, or null when there
  /// is nothing to export. The parent puts it in the AppBar so both report tabs
  /// share one export button in the same place.
  final ValueChanged<Future<void> Function()?>? onExportChanged;

  @override
  State<ConditionReportView> createState() => _ConditionReportViewState();
}

class _ConditionReportViewState extends State<ConditionReportView> {
  final _repo = const InventoryRepository();

  List<Location> _locations = [];
  List<String> _categories = [];
  bool _loadingOptions = true;

  String? _locationId;
  String? _category;
  bool _faultyOnly = false;
  // Item-first by default, matching web: the report is about what is owned.
  var _mode = GroupMode.item;

  List<ConditionRow>? _rows;
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
        _repo.fetchCategories(),
      ]);
      if (!mounted) return;
      setState(() {
        _locations = results[0] as List<Location>;
        _categories = results[1] as List<String>;
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

  /// "Room › Shelf" so a nested location is identifiable in a flat dropdown.
  String _label(Location l) {
    final parent = l.parentId;
    if (parent == null) return l.name;
    final match = _locations.where((p) => p.id == parent);
    if (match.isEmpty) return l.name;
    return '${_label(match.first)} › ${l.name}';
  }

  Future<void> _run() async {
    setState(() {
      _running = true;
      _error = null;
    });
    try {
      final rows = await _repo.fetchConditionReport(
        locationId: _locationId,
        category: _category,
        faultyOnly: _faultyOnly,
      );
      if (!mounted) return;
      setState(() {
        _rows = rows;
        _running = false;
      });
      _publishExport();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _running = false;
      });
      _publishExport();
    }
  }

  /// Hand the parent an export callback once there is something to export, and
  /// null when there is not, so the shared AppBar button appears and disappears
  /// with the results.
  void _publishExport() {
    final rows = _rows;
    widget.onExportChanged?.call(
      (rows != null && rows.isNotEmpty) ? sharePdf : null,
    );
  }

  @override
  void dispose() {
    // The parent must not keep a callback into a disposed State.
    widget.onExportChanged?.call(null);
    super.dispose();
  }

  /// One decimal place, with a trailing `.0` dropped — what the web prints,
  /// where JavaScript formats 100 as "100" and 32.1 as "32.1".
  static String _pct(double v) {
    final s = v.toStringAsFixed(1);
    return s.endsWith('.0') ? s.substring(0, s.length - 2) : s;
  }

  Future<void> sharePdf() async {
    final rows = _rows;
    if (rows == null || rows.isEmpty) return;

    // Column order and nesting mirror the web's condition-pdf.ts exactly, so a
    // report exported from the phone is the same document as one exported from
    // the dashboard.
    const head = [
      'Category',
      'Item type',
      'Name',
      'Model',
      'SKU',
      'Specification',
      'Location',
      'Quantity',
      'Condition',
      '% Operational',
      'Recommendation',
    ];

    final lines = groupVariants(rows, _mode);
    final rooms = <String, ({String name, List<GroupedRow> lines})>{};
    for (final r in lines) {
      // Reproduces the web's condition-report.tsx exactly: item mode has no
      // room dimension, so everything lands in one bucket, and that bucket
      // takes its name from whichever row created it.
      final bucket = _mode == GroupMode.item ? 'all' : r.roomId;
      final room = rooms.putIfAbsent(
        bucket,
        () => (name: r.roomName, lines: <GroupedRow>[]),
      );
      room.lines.add(r);
    }

    final sections = <PdfSection>[];
    for (final room in rooms.values) {
      final byCategory = <String, List<GroupedRow>>{};
      for (final l in room.lines) {
        byCategory.putIfAbsent(l.category ?? 'Uncategorised', () => []).add(l);
      }
      final out = <PdfRow>[];
      for (final cat in byCategory.entries) {
        // Category is written once per block, as on paper.
        var first = true;
        for (final nameGroup in nestByName(cat.value)) {
          final multi = nameGroup.lines.length > 1;
          if (multi) {
            // A type covering several items gets its own shaded heading row
            // carrying the combined total; its parts follow beneath.
            out.add(PdfRow([
              first ? cat.key : '',
              nameGroup.name,
              nameGroup.lines.map((l) => l.name).join(' - '),
              nameGroup.lines.map((l) => l.model).join(' - '),
              nameGroup.lines.map((l) => l.skuText).join(' - '),
              '',
              '',
              '${nameGroup.total}',
              '',
              '${_pct(nameGroup.percentOperational)} %',
              '',
            ], heading: true));
            first = false;
          }
          for (final r in nameGroup.lines) {
            out.add(PdfRow([
              !multi && first ? cat.key : '',
              multi ? '' : r.type,
              r.name,
              r.model,
              r.skuText,
              r.variantsText,
              r.locationsText,
              '${r.total}',
              r.conditionText,
              '${_pct(r.percentOperational)} %',
              r.recommendationText.isEmpty ? '-' : r.recommendationText,
            ]));
            if (!multi) first = false;
          }
        }
      }
      sections.add(PdfSection(title: room.name, rows: out));
    }

    final bytes = await buildReportPdf(
      title: ReportLetterhead.conditionTitle,
      head: head,
      sections: sections,
      // Quantity and % Operational, as on the web.
      rightAligned: const [7, 9],
    );
    final d = DateTime.now();
    final stamp =
        '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    await Share.shareXFiles(
      [
        XFile.fromData(bytes,
            mimeType: 'application/pdf', name: 'condition-report-$stamp.pdf')
      ],
      subject: 'Condition Report',
    );
  }

  /// Red when most units are down, amber when some are.
  Color _tone(BuildContext context, double pct) {
    final scheme = Theme.of(context).colorScheme;
    if (pct >= 100) return scheme.onSurfaceVariant;
    if (pct >= 50) return Colors.orange.shade700;
    return scheme.error;
  }

  @override
  Widget build(BuildContext context) {
    if (_loadingOptions) {
      return const Center(child: CircularProgressIndicator());
    }
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        _buildFilters(),
        const SizedBox(height: 12),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text('$_error', style: const TextStyle(color: Colors.redAccent)),
          ),
        if (_rows != null) ..._buildResults(_rows!),
      ],
    );
  }

  Widget _buildFilters() {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DropdownButtonFormField<String?>(
              initialValue: _locationId,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Room or location',
                helperText: 'A room includes everything shelved inside it.',
                helperMaxLines: 2,
              ),
              items: [
                const DropdownMenuItem(value: null, child: Text('Everywhere')),
                for (final l in _locations)
                  DropdownMenuItem(value: l.id, child: Text(_label(l))),
              ],
              onChanged: (v) => setState(() => _locationId = v),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String?>(
              initialValue: _category,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Category'),
              items: [
                const DropdownMenuItem(value: null, child: Text('All categories')),
                for (final c in _categories)
                  DropdownMenuItem(value: c, child: Text(c)),
              ],
              onChanged: (v) => setState(() => _category = v),
            ),
            const SizedBox(height: 4),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _faultyOnly,
              onChanged: (v) => setState(() => _faultyOnly = v),
              title: const Text('Only what needs attention'),
              subtitle: Text(
                'Hide items with nothing wrong.',
                style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurfaceVariant),
              ),
            ),
            const SizedBox(height: 4),
            // Item-first, or the room-by-room sheet.
            SegmentedButton<GroupMode>(
              segments: const [
                ButtonSegment(value: GroupMode.item, label: Text('By item')),
                ButtonSegment(value: GroupMode.location, label: Text('By location')),
              ],
              selected: {_mode},
              onSelectionChanged: (v) => setState(() => _mode = v.first),
            ),
            const SizedBox(height: 4),
            Text(
              _mode == GroupMode.item
                  ? 'One line per item, added up across every location.'
                  : 'One line per item per place, grouped by room.',
              style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _running ? null : _run,
              child: Text(_running ? 'Running…' : 'Run report'),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildResults(List<ConditionRow> rows) {
    if (rows.isEmpty) {
      return const [
        Padding(
          padding: EdgeInsets.all(24),
          child: Center(child: Text('Nothing stocked matches those filters.')),
        ),
      ];
    }

    final theme = Theme.of(context);
    final units = rows.fold<int>(0, (n, r) => n + r.total);
    final operational = rows.fold<int>(0, (n, r) => n + r.operational);
    final pct = units > 0 ? (operational / units) * 100 : 0.0;

    // Variants collapse into lines first, then group. In item mode there is no
    // room dimension, so everything lands in one bucket.
    final lines = groupVariants(rows, _mode);
    final rooms = <String, ({String name, Map<String, List<GroupedRow>> categories})>{};
    for (final r in lines) {
      final bucket = _mode == GroupMode.item ? 'all' : r.roomId;
      final room = rooms.putIfAbsent(
        bucket,
        () => (
          name: _mode == GroupMode.item ? 'All items' : r.roomName,
          categories: <String, List<GroupedRow>>{}
        ),
      );
      room.categories.putIfAbsent(r.category ?? 'Uncategorised', () => []).add(r);
    }

    return [
      Card(
        child: ListTile(
          title: Text('$units units across ${lines.length} lines'),
          subtitle: Text(
            '${pct.toStringAsFixed(1)}% operational'
            '${units - operational > 0 ? ' · ${units - operational} out of service' : ''}',
          ),
        ),
      ),
      for (final entry in rooms.entries) ...[
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 16, 4, 8),
          child: Text(
            entry.value.name,
            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
          ),
        ),
        for (final cat in entry.value.categories.entries) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 8, 4, 4),
            child: Text(
              cat.key.toUpperCase(),
              style: theme.textTheme.labelSmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant, letterSpacing: 0.6),
            ),
          ),
          for (final g in nestByName(cat.value)) ...[
            // A name covering several SKUs gets a heading with the combined
            // total; each SKU keeps its own card and its own numbers, because
            // different SKUs are different items.
            if (g.lines.length > 1)
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 6, 4, 2),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(g.name,
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                    ),
                    Text('${g.total}',
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(width: 8),
                    Text('${g.percentOperational.toStringAsFixed(1)}%',
                        style: TextStyle(
                            fontSize: 12,
                            color: _tone(context, g.percentOperational))),
                  ],
                ),
              ),
            for (final r in g.lines) _buildRow(r, nested: g.lines.length > 1),
          ],
        ],
      ],
    ];
  }

  Widget _buildRow(GroupedRow r, {bool nested = false}) {
    final theme = Theme.of(context);
    final pct = r.percentOperational;
    final recommendation = r.recommendationText;
    return Card(
      margin: EdgeInsets.fromLTRB(nested ? 12 : 0, 4, 0, 4),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (!nested)
                        Text(r.type,
                            style: const TextStyle(fontWeight: FontWeight.w600)),
                      // Name and model are what separate two items of one type.
                      Text('${r.itemText} · ${r.skuText}',
                          style: TextStyle(
                              fontSize: nested ? 13 : 12,
                              fontWeight: nested ? FontWeight.w600 : FontWeight.w400,
                              color: nested ? null : theme.colorScheme.onSurfaceVariant)),
                      Text(r.variantsText,
                          style: TextStyle(
                              fontSize: 12,
                              color: theme.colorScheme.onSurfaceVariant)),
                      // In item mode this is the only place location appears.
                      Text(r.locationsText,
                          style: TextStyle(
                              fontSize: 12,
                              color: theme.colorScheme.onSurfaceVariant)),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('${r.total}',
                        style: const TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 18)),
                    Text('${pct.toStringAsFixed(1)}%',
                        style: TextStyle(
                            fontSize: 12, color: _tone(context, pct))),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(r.conditionText, style: const TextStyle(fontSize: 13)),
            if (r.inUse > 0)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text('${r.inUse} in use',
                    style: TextStyle(
                        fontSize: 12, color: theme.colorScheme.onSurfaceVariant)),
              ),
            if (recommendation.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.build_outlined,
                        size: 14, color: theme.colorScheme.onSurfaceVariant),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(recommendation,
                          style: TextStyle(
                              fontSize: 12,
                              color: theme.colorScheme.onSurfaceVariant)),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
