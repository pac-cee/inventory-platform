import 'package:flutter/material.dart';

import '../../config/api_client.dart';
import '../../models.dart';
import '../../repository.dart';

const _kinds = ['upgrade', 'replace', 'maintenance', 'other'];

/// Suggested changes for an item that still works.
///
/// Separate from marking stock damaged: nothing here changes a count. Anyone
/// can raise one; only an admin closes one.
class SuggestionsCard extends StatefulWidget {
  const SuggestionsCard({
    super.key,
    required this.item,
    required this.locations,
    required this.onChanged,
  });

  final Item item;

  /// Places this item is stocked, so a suggestion can be scoped to one.
  final List<Location> locations;
  final Future<void> Function() onChanged;

  @override
  State<SuggestionsCard> createState() => _SuggestionsCardState();
}

class _SuggestionsCardState extends State<SuggestionsCard> {
  final _repo = const InventoryRepository();
  List<Suggestion> _open = [];
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final list = await _repo.fetchSuggestions(widget.item.id);
      if (!mounted) return;
      setState(() {
        _open = list;
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

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
      await _load();
      await widget.onChanged();
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _add() async {
    final noteCtl = TextEditingController();
    final unitsCtl = TextEditingController();
    var kind = 'upgrade';
    String? locationId;

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Suggest a change'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: noteCtl,
                  autofocus: true,
                  decoration: const InputDecoration(
                    labelText: 'What should be done?',
                    hintText: 'e.g. Upgrade to 16GB RAM',
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  isExpanded: true,
                  initialValue: kind,
                  decoration: const InputDecoration(labelText: 'Kind'),
                  items: [
                    for (final k in _kinds)
                      DropdownMenuItem(
                        value: k,
                        child: Text(k[0].toUpperCase() + k.substring(1)),
                      ),
                  ],
                  onChanged: (v) => setDialogState(() => kind = v ?? 'upgrade'),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String?>(
                  initialValue: locationId,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Where'),
                  items: [
                    const DropdownMenuItem(value: null, child: Text('Anywhere')),
                    for (final l in widget.locations)
                      DropdownMenuItem(
                          value: l.id,
                          child: Text(l.name,
                              maxLines: 1, overflow: TextOverflow.ellipsis)),
                  ],
                  onChanged: (v) => setDialogState(() => locationId = v),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: unitsCtl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Units (optional)',
                    hintText: 'All of them',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Add')),
          ],
        ),
      ),
    );
    if (saved != true) return;
    final note = noteCtl.text.trim();
    if (note.length < 3) {
      setState(() => _error = 'Say what should be done.');
      return;
    }
    await _run(() => _repo.addSuggestion(
          itemId: widget.item.id,
          note: note,
          kind: kind,
          locationId: locationId,
          units: int.tryParse(unitsCtl.text.trim()),
        ));
  }

  Future<void> _resolve(Suggestion s) async {
    final ctl = TextEditingController();
    final done = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Mark as done'),
        content: TextField(
          controller: ctl,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'What was done? (optional)'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Done')),
        ],
      ),
    );
    if (done != true) return;
    await _run(() => _repo.resolveSuggestion(s.id, resolution: ctl.text.trim()));
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // Resolving a suggestion is warehouse work, not an admin-only act.
    final isAdmin = ApiClient.instance.canManageInventory;
    final myId = ApiClient.instance.currentUserId;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text('Suggested changes',
                      style: TextStyle(fontWeight: FontWeight.w600)),
                ),
                TextButton.icon(
                  onPressed: _busy ? null : _add,
                  icon: const Icon(Icons.lightbulb_outline, size: 18),
                  label: const Text('Suggest'),
                ),
              ],
            ),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(12),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_open.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  'Nothing suggested. Use this for work worth doing on something '
                  'that still works, rather than damage.',
                  style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                ),
              )
            else
              for (final s in _open)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(s.note, style: const TextStyle(fontSize: 14)),
                  subtitle: Text(
                    [
                      s.kind,
                      if (s.units != null) '${s.units} units',
                      if (s.locationName.isNotEmpty) s.locationName else 'anywhere',
                      if (s.createdByName.isNotEmpty) s.createdByName,
                    ].join(' · '),
                    style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (isAdmin)
                        IconButton(
                          tooltip: 'Mark as done',
                          icon: const Icon(Icons.check, size: 20),
                          onPressed: _busy ? null : () => _resolve(s),
                        ),
                      if (isAdmin || s.createdBy == myId)
                        IconButton(
                          tooltip: 'Withdraw',
                          icon: const Icon(Icons.close, size: 20),
                          onPressed:
                              _busy ? null : () => _run(() => _repo.removeSuggestion(s.id)),
                        ),
                    ],
                  ),
                ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(_error!, style: TextStyle(fontSize: 12, color: scheme.error)),
              ),
          ],
        ),
      ),
    );
  }
}
