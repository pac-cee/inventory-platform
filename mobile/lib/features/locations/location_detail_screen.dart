import 'dart:async';

import 'package:flutter/material.dart';

import '../../config/api_client.dart';
import '../../location_rules.dart';
import '../../widgets/location_stock_row.dart';
import '../../models.dart';
import '../../repository.dart';
import '../../widgets.dart';
import '../../box_qr.dart';
import '../items/item_detail_screen.dart';
import '../items/item_qr.dart';
import 'package:share_plus/share_plus.dart';
import '../items/item_photo.dart';
import 'location_editor_dialog.dart';
import 'location_photo.dart';
import '../../widgets/error_state.dart';

class _Data {
  _Data(this.location, this.parent, this.children, this.siblings, this.stockHere, this.summary,
      this.itemById);
  final Location location;
  final Location? parent;
  final List<Location> children;
  final List<Location> siblings; // other sub-locations under the same parent
  final List<StockLevel> stockHere;
  final Map<String, int> summary; // location_id -> units

  /// The catalog, so a row can show the item's picture — stock rows carry only
  /// a name and SKU.
  final Map<String, Item> itemById;
}

class LocationDetailScreen extends StatefulWidget {
  const LocationDetailScreen({super.key, required this.locationId});
  final String locationId;

  @override
  State<LocationDetailScreen> createState() => _LocationDetailScreenState();
}

class _LocationDetailScreenState extends State<LocationDetailScreen> {
  final _repo = const InventoryRepository();
  late Future<_Data> _future;

  /// Items ticked for a batch move. Dragging a ticked item drags the whole
  /// selection; dragging an unticked one moves just that item.
  final Set<String> _selected = <String>{};

  /// Drives auto-scrolling while dragging — a Draggable doesn't scroll its
  /// list, so a sub-location below the fold was unreachable without dropping
  /// the item, scrolling, and starting over.
  final ScrollController _scroll = ScrollController();
  Timer? _autoScroll;

  @override
  void dispose() {
    _autoScroll?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  /// Pan the list while a drag is held near the top or bottom edge, faster the
  /// closer to the edge. Call with null on drag end to stop.
  void _autoScrollFor(Offset? globalPosition) {
    const edge = 120.0;
    const maxStep = 26.0;
    if (globalPosition == null) {
      _autoScroll?.cancel();
      _autoScroll = null;
      return;
    }
    final height = MediaQuery.of(context).size.height;
    final y = globalPosition.dy;
    double step = 0;
    if (y < edge) {
      step = -maxStep * (1 - y / edge);
    } else if (y > height - edge) {
      step = maxStep * (1 - (height - y) / edge);
    }
    if (step == 0) {
      _autoScroll?.cancel();
      _autoScroll = null;
      return;
    }
    _autoScroll ??= Timer.periodic(const Duration(milliseconds: 16), (_) {
      if (!_scroll.hasClients) return;
      final target = (_scroll.offset + _lastStep)
          .clamp(0.0, _scroll.position.maxScrollExtent);
      _scroll.jumpTo(target);
    });
    _lastStep = step;
  }

  double _lastStep = 0;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_Data> _load() async {
    final results = await Future.wait([
      _repo.fetchLocation(widget.locationId),
      _repo.fetchLocations(),
      _repo.fetchStock(),
      _repo.fetchItems(),
    ]);
    final location = results[0] as Location;
    final all = results[1] as List<Location>;
    final stock = results[2] as List<StockLevel>;
    final itemById = {for (final i in results[3] as List<Item>) i.id: i};

    Location? parent;
    if (location.parentId != null) {
      for (final l in all) {
        if (l.id == location.parentId) {
          parent = l;
          break;
        }
      }
    }
    final children = all.where((l) => l.parentId == widget.locationId).toList()
      ..sort((a, b) => a.name.compareTo(b.name));
    final siblings = location.parentId != null
        ? (all
            .where((l) => l.parentId == location.parentId && l.id != location.id)
            .toList()
          ..sort((a, b) => a.name.compareTo(b.name)))
        : <Location>[];
    final summary = <String, int>{};
    for (final s in stock) {
      summary[s.locationId] = (summary[s.locationId] ?? 0) + s.quantity;
    }
    // Hide fully-emptied rows (e.g. after everything was relocated out).
    final stockHere = stock
        .where((s) => s.locationId == widget.locationId)
        .where((s) => s.quantity > 0 || s.capacity > 0 || s.damaged > 0)
        .toList()
      ..sort((a, b) {
        final an = a.slotNo ?? 1 << 30;
        final bn = b.slotNo ?? 1 << 30;
        if (an != bn) return an.compareTo(bn);
        return (a.itemName ?? '').compareTo(b.itemName ?? '');
      });
    return _Data(location, parent, children, siblings, stockHere, summary, itemById);
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

  /// A location row that accepts dropped items and relocates their stock there.
  Widget _destTile(BuildContext context, _Data data, Location dest, {required bool isParent}) {
    return DragTarget<List<String>>(
      onWillAcceptWithDetails: (_) => true,
      onAcceptWithDetails: (det) => _relocate(det.data, dest.id, data, dest.name),
      builder: (context, candidate, rejected) => Container(
        decoration: candidate.isNotEmpty
            ? BoxDecoration(
                color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
              )
            : null,
        child: ListTile(
          leading: Icon(isParent ? Icons.subdirectory_arrow_left : Icons.swap_horiz),
          title: Text(isParent ? '${dest.name}  ·  up one level' : dest.name),
          subtitle: Text('${data.summary[dest.id] ?? 0} units'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _openLocation(dest.id),
        ),
      ),
    );
  }

  /// Put some (or all) of an item that sits on this level into one of the boxes on it. Boxes
  /// are where items really live, so this is how a level's loose stock is split into them.
  Future<void> _moveToBox(dynamic r, _Data data) async {
    final boxes = data.children.where((c) => c.isBox).toList();
    if (boxes.isEmpty) return;
    final available = r.quantity as int;
    var boxId = boxes.first.id;
    final qty = TextEditingController(text: '$available');
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialog) => AlertDialog(
          title: const Text('Move into a box'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('${r.itemName ?? ''} · $available on this level'),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  isExpanded: true,
                  initialValue: boxId,
                  decoration: const InputDecoration(labelText: 'Box'),
                  items: [
                    for (final b in boxes)
                      DropdownMenuItem(
                        value: b.id,
                        child: Text(
                          (b.label?.trim().isNotEmpty ?? false) ? '${b.label!.trim()} (${b.name})' : b.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: (v) => setDialog(() => boxId = v ?? boxId),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: qty,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(labelText: 'How many', helperText: 'Up to $available. The rest stays on the level.'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Move')),
          ],
        ),
      ),
    );
    final n = int.tryParse(qty.text.trim()) ?? 0;
    qty.dispose();
    if (go != true) return;
    if (n < 1 || n > available) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Enter a number from 1 to $available.')));
      }
      return;
    }
    try {
      await _repo.moveStockBetween(
        itemId: r.itemId as String,
        fromLocationId: widget.locationId,
        toLocationId: boxId,
        quantity: n,
      );
      if (mounted) {
        final box = boxes.firstWhere((b) => b.id == boxId);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Moved $n into ${box.name}.')));
      }
      await _refresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  /// Relocate the whole stock of one or several items into another location.
  Future<void> _relocate(List<String> itemIds, String toId, _Data data, String toName) async {
    if (itemIds.isEmpty) return;
    String nameOf(String id) => data.stockHere
        .firstWhere((s) => s.itemId == id, orElse: () => data.stockHere.first)
        .itemName ??
        'Item';
    final what = itemIds.length == 1 ? nameOf(itemIds.first) : '${itemIds.length} items';
    try {
      final res = await _repo.transferStockMany(
        itemIds: itemIds,
        fromLocationId: widget.locationId,
        toLocationId: toId,
      );
      setState(_selected.clear);
      if (mounted) {
        final msg = res.failures.isEmpty
            ? 'Moved $what → $toName'
            : 'Moved ${res.moved} of ${itemIds.length} → $toName. ${res.failures.first}';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      }
      await _refresh();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  /// The box's sticker as an image (QR code), through the share sheet.
  Future<void> _shareBoxLabel(Location box) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final png = await renderQrPng(boxQrData(box.qrToken!));
      if (png == null) {
        messenger.showSnackBar(const SnackBar(content: Text('Could not generate the QR image.')));
        return;
      }
      final safe = box.name.replaceAll(RegExp(r'[^A-Za-z0-9_-]+'), '-');
      await Share.shareXFiles(
        [XFile.fromData(png, mimeType: 'image/png', name: 'box-$safe.png')],
        subject: 'Box label · ${box.label ?? box.name}',
        text: 'Label for ${box.label ?? box.name}',
        fileNameOverrides: ['box-$safe.png'],
      );
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not share the label: $e')));
    }
  }

  Future<void> _addSubLocation() async {
    final here = (await _future).location;
    if (!mounted || !canHoldSubLocations(here.kind)) return; // a box holds nothing below it
    final next = kindsAllowedUnder(here.kind).first;
    final draft = await showLocationEditor(
      context,
      title: 'Add ${kindWord(next).toLowerCase()} to ${here.name}',
      parentKind: here.kind,
    );
    if (draft == null) return;
    await _guard(() => _repo.createLocation(
          draft.name,
          parentId: widget.locationId,
          photoUrl: draft.photoUrl,
          photoData: draft.photoData,
          kind: draft.kind,
          label: draft.label,
        ));
  }

  Future<void> _edit(Location loc, {required String? parentKind}) async {
    final draft = await showLocationEditor(
      context,
      title: 'Edit ${kindWord(loc.kind).toLowerCase()}',
      existing: loc,
      parentKind: parentKind,
    );
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

  Future<void> _remove(Location loc, {bool pop = false}) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Remove "${loc.name}"?'),
        content: const Text(
          'It has to be empty and have no sub-locations. Anything that happened '
          'here stays in the activity report.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Remove')),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      final message = await _repo.deleteLocation(loc.id);
      if (!mounted) return;
      if (message != null) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
      }
      if (pop) {
        Navigator.of(context).pop();
      } else {
        await _refresh();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  void _openLocation(String id) {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => LocationDetailScreen(locationId: id)))
        .then((_) => _refresh());
  }

  @override
  Widget build(BuildContext context) {
    // Warehouse rights, not "is an admin" — a stock manager has these.
    final isAdmin = ApiClient.instance.canManageInventory;
    return Scaffold(
      appBar: AppBar(title: const Text('Location')),
      // The button says what can go here (Shelf in an area, Level on a shelf, Box on a
      // level) and is absent on a box, which is always the last step.
      floatingActionButton: isAdmin
          ? FutureBuilder<_Data>(
              future: _future,
              builder: (context, snap) {
                final here = snap.data?.location;
                // Nothing is added inside a place that has no type yet (it would land at the wrong level).
                if (here == null || !canHoldSubLocations(here.kind) || isOlderUntypedPlace(here.kind, snap.data?.parent?.kind)) {
                  return const SizedBox.shrink();
                }
                return FloatingActionButton.extended(
                  heroTag: null,
                  onPressed: _addSubLocation,
                  icon: const Icon(Icons.add),
                  label: Text(kindWord(kindsAllowedUnder(here.kind).first)),
                );
              },
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<_Data>(
          future: _future,
          builder: (context, snap) {
            // Keep showing the previous data while a refresh is in flight —
            // FutureBuilder retains it, so the spinner is only for the first load.
            // (Otherwise every Take/Return/pull-to-refresh blanked the page and
            // threw away the scroll position.)
            if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              return ErrorState(message: '${snap.error}', onRetry: _refresh);
            }
            final data = snap.data!;
            final hasChildren = data.children.isNotEmpty;
            // The "move to another location" card is only there for a manager with items to move.
            final showMoveCard = isAdmin &&
                data.stockHere.isNotEmpty &&
                (data.parent != null || data.siblings.isNotEmpty);
            // Items here can be relocated (admin) to a sub-location, the parent,
            // or a sibling — any direction.
            final canRelocate = isAdmin &&
                (hasChildren || data.parent != null || data.siblings.isNotEmpty);
            final units = data.stockHere.fold<int>(0, (s, r) => s + r.quantity);

            return ListView(
              controller: _scroll,
              // extra room at the bottom: the add button floats over the end of the list
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                if (data.parent != null)
                  TextButton.icon(
                    style: TextButton.styleFrom(padding: EdgeInsets.zero, alignment: Alignment.centerLeft),
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.arrow_back, size: 16),
                    label: Text(data.parent!.name),
                  ),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(data.location.name, style: Theme.of(context).textTheme.headlineSmall),
                          if (data.location.boxBadge != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Wrap(
                                spacing: 8,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  Chip(
                                    visualDensity: VisualDensity.compact,
                                    avatar: const Icon(Icons.inventory_2_outlined, size: 16),
                                    label: Text(data.location.boxBadge!),
                                  ),
                                  // Managers hand out the stickers.
                                  if (ApiClient.instance.canManageInventory && data.location.qrToken != null)
                                    TextButton.icon(
                                      onPressed: () => _shareBoxLabel(data.location),
                                      icon: const Icon(Icons.qr_code_2, size: 18),
                                      label: const Text('Share label'),
                                    ),
                                ],
                              ),
                            ),
                          const SizedBox(height: 4),
                          Text(
                            hasChildren
                                ? '${data.children.length} sub-location${data.children.length == 1 ? '' : 's'}'
                                : '${data.stockHere.length} items · $units units',
                            style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
                          ),
                        ],
                      ),
                    ),
                    if (isAdmin) ...[
                      IconButton(
                        tooltip: 'Edit',
                        icon: const Icon(Icons.edit_outlined),
                        onPressed: () => _edit(data.location, parentKind: data.parent?.kind),
                      ),
                      IconButton(
                        tooltip: 'Remove location',
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () => _remove(data.location, pop: true),
                      ),
                    ],
                  ],
                ),
                // Places made before the Area > Shelf > Level > Box layout are all stored as
                // "area". Say so, and make fixing it one tap, instead of offering the wrong button.
                if (isAdmin && isOlderUntypedPlace(data.location.kind, data.parent?.kind)) ...[ 
                  const SizedBox(height: 12),
                  Card(
                    margin: EdgeInsets.zero,
                    child: ListTile(
                      leading: const Icon(Icons.info_outline),
                      title: const Text('Set what this place is'),
                      subtitle: Text(
                        'It was made before places had types, so it is treated as an area. Choose '
                        '${kindWord(kindsAllowedUnder(data.parent?.kind).isEmpty ? 'area' : kindsAllowedUnder(data.parent?.kind).first).toLowerCase()} '
                        'so the right things can be added inside it.',
                      ),
                      isThreeLine: true,
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => _edit(data.location, parentKind: data.parent?.kind),
                    ),
                  ),
                ],
                // Shown only when there is one, so a location without a photo
                // looks exactly as it did before.
                if (data.location.hasAnyPhoto) ...[
                  SectionCard(
                    key: const ValueKey('card-photo'),
                    title: 'Photo',
                    collapsible: true,
                    initiallyExpanded: false,
                    summary: 'tap to show',
                    child: LocationPhoto(location: data.location),
                  ),
                  const SizedBox(height: 16),
                ],
                if (hasChildren)
                  SectionCard(
                    title: 'Sub-locations',
                    child: Column(
                      children: [
                        for (final c in data.children)
                          DragTarget<List<String>>(
                            onWillAcceptWithDetails: (_) => isAdmin,
                            onAcceptWithDetails: (det) =>
                                _relocate(det.data, c.id, data, c.name),
                            builder: (context, candidate, rejected) => Container(
                              decoration: candidate.isNotEmpty
                                  ? BoxDecoration(
                                      color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.12),
                                      borderRadius: BorderRadius.circular(8),
                                    )
                                  : null,
                              child: ListTile(
                                contentPadding:
                                    const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                                leading: c.hasAnyPhoto
                                    ? LocationThumb(location: c, size: 56)
                                    : const SizedBox(
                                        width: 56,
                                        height: 56,
                                        child: Icon(Icons.subdirectory_arrow_right),
                                      ),
                                title: Text(c.name),
                                subtitle: Text('${data.summary[c.id] ?? 0} units'),
                                trailing: isAdmin
                                    ? Row(mainAxisSize: MainAxisSize.min, children: [
                                        IconButton(
                                            tooltip: 'Edit location',
                                            icon: const Icon(Icons.edit_outlined),
                                            onPressed: () => _edit(c, parentKind: data.location.kind)),
                                        IconButton(
                                            tooltip: 'Delete location',
                                            icon: const Icon(Icons.delete_outline),
                                            onPressed: () => _remove(c)),
                                      ])
                                    : const Icon(Icons.chevron_right),
                                onTap: () => _openLocation(c.id),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                // Move up to the parent or across to a sibling (drop targets not
                // otherwise shown here). Admin only, when there are items to move.
                if (showMoveCard) ...[
                  const SizedBox(height: 16),
                  // Closed until asked: most visits to a place are to look or to take, not to move it.
                  SectionCard(
                    key: const ValueKey('card-move'),
                    title: 'Move to another location',
                    collapsible: true,
                    initiallyExpanded: false,
                    summary: '${(data.parent != null ? 1 : 0) + data.siblings.length} places',
                    child: Column(
                      children: [
                        if (data.parent != null)
                          _destTile(context, data, data.parent!, isParent: true),
                        for (final sib in data.siblings)
                          _destTile(context, data, sib, isParent: false),
                      ],
                    ),
                  ),
                ],
                if (!hasChildren || data.stockHere.isNotEmpty) ...[
                  // A gap after whatever card comes before (sub-locations or the move card), so the cards never touch.
                  if (hasChildren || showMoveCard) const SizedBox(height: 16),
                  SectionCard(
                    title: hasChildren ? 'Items directly here' : 'Items here',
                    child: data.stockHere.isEmpty
                        ? const Padding(
                            padding: EdgeInsets.all(24),
                            child: Center(child: Text('No items stored here yet.')),
                          )
                        : Column(
                            children: [
                              if (canRelocate)
                                Padding(
                                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                                  child: Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          _selected.isEmpty
                                              ? 'Tick items to move several at once, then long-press and drag onto a location.'
                                              : '${_selected.length} of ${data.stockHere.length} selected',
                                          style: TextStyle(
                                              fontSize: 12,
                                              color: Theme.of(context).colorScheme.onSurfaceVariant),
                                        ),
                                      ),
                                      if (_selected.isNotEmpty)
                                        TextButton(
                                          onPressed: () => setState(_selected.clear),
                                          child: const Text('Clear'),
                                        ),
                                    ],
                                  ),
                                ),
                              for (final r in data.stockHere)
                                Builder(builder: (context) {
                                  final isSelected = _selected.contains(r.itemId);
                                  final it = data.itemById[r.itemId];
                                  final tile = LocationStockRow(
                                    name: r.itemName ?? r.itemId,
                                    sku: r.itemSku,
                                    slotNo: r.slotNo, // the item's number in THIS location: what people point at on the shelf
                                    quantity: r.quantity,
                                    thumb: it != null
                                        ? ItemThumb(item: it, size: 48)
                                        : const SizedBox(width: 48, height: 48),
                                    selected: isSelected,
                                    onMove: canRelocate && data.children.any((c) => c.isBox) && r.quantity > 0
                                        ? () => _moveToBox(r, data)
                                        : null,
                                    onSelectChanged: canRelocate
                                        ? () => setState(() {
                                              if (!_selected.remove(r.itemId)) {
                                                _selected.add(r.itemId);
                                              }
                                            })
                                        : null,
                                    onTap: () => Navigator.of(context)
                                        .push(MaterialPageRoute(
                                            builder: (_) => ItemDetailScreen(itemId: r.itemId, locationId: widget.locationId)))
                                        .then((_) => _refresh()),
                                  );
                                  // Draggable only where relocation makes sense: an
                                  // admin viewing a parent that has sub-locations.
                                  if (!canRelocate) return tile;
                                  // Dragging a ticked row carries the whole
                                  // selection; an unticked one moves alone.
                                  final payload =
                                      isSelected ? _selected.toList() : <String>[r.itemId];
                                  final label = payload.length > 1
                                      ? '${payload.length} items'
                                      : (r.itemName ?? 'Item');
                                  return LongPressDraggable<List<String>>(
                                    data: payload,
                                    onDragUpdate: (d) => _autoScrollFor(d.globalPosition),
                                    onDragEnd: (_) => _autoScrollFor(null),
                                    onDraggableCanceled: (_, __) => _autoScrollFor(null),
                                    feedback: Material(
                                      elevation: 4,
                                      borderRadius: BorderRadius.circular(8),
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                                          const Icon(Icons.drag_indicator, size: 18),
                                          const SizedBox(width: 8),
                                          Text(label),
                                        ]),
                                      ),
                                    ),
                                    childWhenDragging: Opacity(opacity: 0.4, child: tile),
                                    child: tile,
                                  );
                                }),
                            ],
                          ),
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}
