import 'package:flutter/material.dart';

import '../../config/api_client.dart';
import '../../catalog_logic.dart';
import '../../models.dart';
import '../../search_logic.dart';
import '../../repository.dart';
import 'location_detail_screen.dart';
import 'location_editor_dialog.dart';
import 'location_photo.dart';
import '../../widgets/search_button.dart';
import '../../widgets/error_state.dart';

class _Data {
  _Data(this.locations, this.stock);
  final List<Location> locations;
  final List<StockLevel> stock;
}

class LocationsScreen extends StatefulWidget {
  const LocationsScreen({super.key});

  @override
  State<LocationsScreen> createState() => _LocationsScreenState();
}

class _LocationsScreenState extends State<LocationsScreen> {
  final _repo = const InventoryRepository();
  late Future<_Data> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_Data> _load() async {
    final results = await Future.wait([_repo.fetchLocations(), _repo.fetchStock()]);
    return _Data(results[0] as List<Location>, results[1] as List<StockLevel>);
  }

  Future<void> _refresh() async {
    final f = _load();
    setState(() {
      _future = f;
    });
    await f;
  }

  Future<void> _guard(Future<void> Function() op) async {
    try {
      await op();
      await _refresh();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _addLocation() async {
    final draft = await showLocationEditor(context, title: 'New area'); // only areas are top-level; everything else goes inside one
    if (draft == null) return;
    await _guard(() => _repo.createLocation(
          draft.name, // top-level (no parent)
          photoUrl: draft.photoUrl,
          photoData: draft.photoData,
          kind: draft.kind,
          label: draft.label,
        ));
  }

  Future<void> _edit(Location loc) async {
    final draft = await showLocationEditor(context, title: 'Edit location', existing: loc, parentKind: null);
    if (draft == null) return;
    await _guard(() async {
      await _repo.updateLocation(
        loc.id,
        name: draft.name,
        photoUrl: draft.photoUrl,
        clearPhotoData: draft.clearPhoto,
        kind: draft.kind,
        label: draft.label,
      );
      final data = draft.photoData;
      if (data != null) await _repo.uploadLocationPhoto(loc.id, data);
    });
  }

  Future<void> _remove(Location loc) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Remove "${loc.name}"?'),
        content: const Text('This only works if no stock references it.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Remove')),
        ],
      ),
    );
    if (confirm != true) return;
    await _guard(() => _repo.deleteLocation(loc.id));
  }

  void _openDetail(String id) {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => LocationDetailScreen(locationId: id)))
        .then((_) => _refresh());
  }

  // 'places' = the top-level rooms; 'boxes' = every box, wherever it sits.
  String _view = 'places';
  String _q = '';

  @override
  Widget build(BuildContext context) {
    // Warehouse rights, not "is an admin" — a stock manager has these.
    final canManage = ApiClient.instance.canManageInventory;
    return Scaffold(
      appBar: AppBar(title: const Text('Locations'), actions: const [SearchButton()]),
      floatingActionButton: canManage
          ? FloatingActionButton.extended(
              heroTag: null,
              onPressed: _addLocation,
              icon: const Icon(Icons.add),
              label: const Text('Location'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<_Data>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError && !snap.hasData) {
              return ErrorState(title: "Couldn't load locations", message: '${snap.error}', onRetry: _refresh);
            }
            final data = snap.data!;
            final cs = Theme.of(context).colorScheme;

            final units = <String, int>{};
            for (final s in data.stock) {
              units[s.locationId] = (units[s.locationId] ?? 0) + s.quantity;
            }
            final byId = {for (final l in data.locations) l.id: l};
            final places = topLevelSummaries(data.locations, units);
            final boxes = data.locations.where((l) => l.isBox).toList()
              ..sort((a, b) => locationPathOf(a, byId).compareTo(locationPathOf(b, byId)));
            final totalUnits = units.values.fold(0, (a, b) => a + b);
            if (data.locations.isEmpty) return _scrollMessage('No locations yet.');

            final q = _q.trim();
            final found = q.isEmpty ? const <Location>[] : rankLocations(data.locations, q, limit: 30);

            Widget header = Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${places.length} place${places.length == 1 ? '' : 's'}'
                  '${boxes.isEmpty ? '' : ' · ${boxes.length} box${boxes.length == 1 ? '' : 'es'}'}'
                  ' · $totalUnits units',
                  style: TextStyle(color: cs.onSurfaceVariant),
                ),
                const SizedBox(height: 12),
                TextField(
                  decoration: const InputDecoration(
                    hintText: 'Filter places and boxes…',
                    prefixIcon: Icon(Icons.filter_list),
                    isDense: true,
                  ),
                  onChanged: (v) => setState(() => _q = v),
                ),
                if (q.isEmpty && boxes.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, children: [
                    ChoiceChip(
                      label: Text('Places ${places.length}'),
                      selected: _view == 'places',
                      onSelected: (_) => setState(() => _view = 'places'),
                    ),
                    ChoiceChip(
                      label: Text('Boxes ${boxes.length}'),
                      selected: _view == 'boxes',
                      onSelected: (_) => setState(() => _view = 'boxes'),
                    ),
                  ]),
                ],
                const SizedBox(height: 8),
              ],
            );

            final List<Widget> rows;
            if (q.isNotEmpty) {
              rows = found.isEmpty
                  ? [Padding(padding: const EdgeInsets.all(32), child: Center(child: Text('No place or box matches “$q”.', style: TextStyle(color: cs.onSurfaceVariant))))]
                  : [for (final l in found) _FlatRow(location: l, path: locationPathOf(l, byId), units: units[l.id] ?? 0, onTap: () => _openDetail(l.id))];
            } else if (_view == 'boxes') {
              rows = [for (final l in boxes) _FlatRow(location: l, path: locationPathOf(l, byId), units: units[l.id] ?? 0, onTap: () => _openDetail(l.id))];
            } else {
              rows = [
                for (final p in places)
                  _PlaceCard(
                    summary: p,
                    canManage: canManage,
                    onOpen: () => _openDetail(p.location.id),
                    onEdit: () => _edit(p.location),
                    onDelete: () => _remove(p.location),
                  ),
              ];
            }

            return ListView(
              padding: EdgeInsets.fromLTRB(16, 12, 16, canManage ? 88 : 16),
              physics: const AlwaysScrollableScrollPhysics(),
              children: [header, ...rows],
            );
          },
        ),
      ),
    );
  }

  Widget _scrollMessage(String text) {
    return ListView(
      children: [
        const SizedBox(height: 80),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Center(child: Text(text, textAlign: TextAlign.center)),
        ),
      ],
    );
  }
}

/// A top-level place as a card: photo (or an icon), name, units including
/// everything nested inside it, and how many sub-locations. Edit and delete live
/// in a "more" menu, away from the tap target that opens the place.
class _PlaceCard extends StatelessWidget {
  const _PlaceCard({
    required this.summary,
    required this.canManage,
    required this.onOpen,
    required this.onEdit,
    required this.onDelete,
  });

  final LocationSummary summary;
  final bool canManage;
  final VoidCallback onOpen;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final loc = summary.location;
    final sub = subLocationText(summary.subLocations);
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              loc.hasAnyPhoto
                  ? LocationThumb(location: loc, size: 64)
                  : Container(
                      width: 64,
                      height: 64,
                      decoration: BoxDecoration(color: cs.surfaceContainerHighest, borderRadius: BorderRadius.circular(10)),
                      child: Icon(loc.isBox ? Icons.inventory_2_outlined : Icons.warehouse_outlined, color: cs.onSurfaceVariant),
                    ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(loc.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                    if (loc.boxBadge != null) Text(loc.boxBadge!, style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
                    const SizedBox(height: 4),
                    Text(
                      [ '${summary.units} units', if (sub.isNotEmpty) sub ].join(' · '),
                      style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
              if (canManage)
                PopupMenuButton<String>(
                  tooltip: 'More',
                  onSelected: (v) => v == 'edit' ? onEdit() : onDelete(),
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'edit', child: ListTile(leading: Icon(Icons.edit_outlined), title: Text('Edit'), dense: true)),
                    PopupMenuItem(value: 'delete', child: ListTile(leading: Icon(Icons.delete_outline), title: Text('Delete'), dense: true)),
                  ],
                )
              else
                const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}

/// A flat row for search results and the Boxes view: what it is, where it sits
/// (the full path, so two "Shelf 2"s are told apart) and how much is in it.
class _FlatRow extends StatelessWidget {
  const _FlatRow({required this.location, required this.path, required this.units, required this.onTap});

  final Location location;
  final String path;
  final int units;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final title = location.isBox && (location.label?.isNotEmpty ?? false) ? location.label! : location.name;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(location.isBox ? Icons.inventory_2_outlined : Icons.warehouse_outlined, color: cs.onSurfaceVariant),
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text(path, maxLines: 2, overflow: TextOverflow.ellipsis),
        trailing: Text('$units', style: const TextStyle(fontWeight: FontWeight.w600)),
        onTap: onTap,
      ),
    );
  }
}
