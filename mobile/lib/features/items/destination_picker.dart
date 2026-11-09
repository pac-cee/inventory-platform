import 'package:flutter/material.dart';

import '../../models.dart';
import '../../move_picker_logic.dart';
import '../../widgets/slide_sheet.dart';

/// Choose where stock is going. Replaces the flat "To" dropdown, where every
/// place showed as a bare name and "Shelf 2" could mean a dozen different shelves.
///
/// Boxes come first with their full path underneath; search matches the whole
/// path; the drill-down below walks Area > Shelf > Level > Box; recent
/// destinations on this device sit on top. Returns the chosen location's id.
Future<String?> pickDestination(
  BuildContext context, {
  required List<Location> all,
  required List<Location> destinations,
  String? currentId,
}) {
  return showSlideSheet<String>(
    context,
    builder: (_) => DestinationPicker(all: all, destinations: destinations, currentId: currentId),
  );
}

class DestinationPicker extends StatefulWidget {
  const DestinationPicker({
    super.key,
    required this.all,
    required this.destinations,
    this.currentId,
    this.recentIds,
  });

  /// Every place (to build paths and walk the tree).
  final List<Location> all;

  /// Where stock may land (leaves and occupied rooms) — the source is already left out.
  final List<Location> destinations;
  final String? currentId;

  /// Recent destinations; null loads them from this device.
  final List<String>? recentIds;

  @override
  State<DestinationPicker> createState() => _DestinationPickerState();
}

class _DestinationPickerState extends State<DestinationPicker> {
  final _search = TextEditingController();
  // The drill-down trail: ids from the top, last = the place being browsed.
  final List<String> _trail = [];
  List<String> _recent = const [];

  late final Map<String, Location> _byId = {for (final l in widget.all) l.id: l};
  late final Set<String> _destIds = {for (final l in widget.destinations) l.id};

  @override
  void initState() {
    super.initState();
    if (widget.recentIds != null) {
      _recent = widget.recentIds!;
    } else {
      RecentDestinations.load().then((ids) {
        if (mounted) setState(() => _recent = ids);
      });
    }
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _choose(Location l) => Navigator.pop(context, l.id);

  Widget _tile(Location l, {bool drill = false}) {
    final where = parentPath(l, _byId);
    final isDest = _destIds.contains(l.id);
    final kids = childrenOf(widget.all, l.id);
    final canDrill = drill && kids.isNotEmpty;
    final boxes = boxesBelow(widget.all, l.id);
    final selected = l.id == widget.currentId;
    return ListTile(
      key: ValueKey('dest-${l.id}'),
      leading: Icon(l.isBox ? Icons.inventory_2_outlined : Icons.folder_outlined),
      title: Text(displayName(l), maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        [
          if (where.isNotEmpty) where,
          if (canDrill && boxes > 0) '$boxes box${boxes == 1 ? '' : 'es'}',
        ].join('  ·  '),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: canDrill
          ? Row(mainAxisSize: MainAxisSize.min, children: [
              if (isDest) TextButton(onPressed: () => _choose(l), child: const Text('Choose')),
              const Icon(Icons.chevron_right),
            ])
          : (selected ? const Icon(Icons.check) : null),
      onTap: canDrill ? () => setState(() => _trail.add(l.id)) : (isDest ? () => _choose(l) : null),
    );
  }

  Widget _header(String text) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Text(text, style: Theme.of(context).textTheme.labelLarge),
      );

  @override
  Widget build(BuildContext context) {
    final query = _search.text.trim();
    final children = <Widget>[];

    if (query.isNotEmpty) {
      final hits = searchDestinations(widget.destinations, _byId, query);
      if (hits.isEmpty) {
        children.add(Padding(
          padding: const EdgeInsets.all(24),
          child: Text('Nothing matches “$query”. Try a shelf, level or box name.', textAlign: TextAlign.center),
        ));
      } else {
        children.addAll(hits.map(_tile));
      }
    } else {
      final recent = [for (final id in _recent) if (_destIds.contains(id)) _byId[id]!];
      if (recent.isNotEmpty && _trail.isEmpty) {
        children.add(_header('Recent'));
        children.addAll(recent.map(_tile));
      }
      final boxes = boxesFirst(widget.destinations, _byId);
      if (boxes.isNotEmpty && _trail.isEmpty) {
        children.add(_header('Boxes'));
        children.addAll(boxes.map(_tile));
      }
      // Browse: Area > Shelf > Level > Box.
      children.add(_header(_trail.isEmpty ? 'Browse' : 'Browse · ${locationPath(_byId[_trail.last]!, _byId)}'));
      if (_trail.isNotEmpty) {
        children.add(ListTile(
          key: const ValueKey('picker-back'),
          leading: const Icon(Icons.arrow_back),
          title: const Text('Back'),
          onTap: () => setState(() => _trail.removeLast()),
        ));
      }
      for (final l in childrenOf(widget.all, _trail.isEmpty ? null : _trail.last)) {
        children.add(_tile(l, drill: true));
      }
    }

    // A ListView, so the sheet scrolls instead of overflowing when it is short
    // or the keyboard is up.
    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
          child: TextField(
            controller: _search,
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.filter_list),
              hintText: 'Search shelf, level or box',
            ),
            onChanged: (_) => setState(() {}),
          ),
        ),
        ...children,
      ],
    );
  }
}
