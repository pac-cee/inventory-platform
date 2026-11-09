import 'package:flutter/material.dart';

import '../../models.dart';
import '../../repository.dart';
import '../../widgets.dart';

import 'add_item_sheet.dart';
import 'category_items_screen.dart';
import '../../catalog_logic.dart';
import '../../config/theme.dart';
import '../../widgets/search_button.dart';
import '../../widgets/error_state.dart';

class _Data {
  _Data(this.items, this.locations, this.quantityByItem);
  final List<Item> items;
  final List<Location> locations;
  final Map<String, int> quantityByItem;
}

class ItemsAdminScreen extends StatefulWidget {
  /// [readOnly] is the member's "Browse items": the same categories, no add or delete.
  const ItemsAdminScreen({super.key, this.readOnly = false});
  final bool readOnly;

  @override
  State<ItemsAdminScreen> createState() => _ItemsAdminScreenState();
}

class _ItemsAdminScreenState extends State<ItemsAdminScreen> {
  final _repo = const InventoryRepository();
  late Future<_Data> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_Data> _load() async {
    final results = await Future.wait([
      _repo.fetchItems(),
      _repo.fetchLocations(),
      _repo.fetchStock(),
    ]);
    final stock = results[2] as List<StockLevel>;
    final quantityByItem = <String, int>{};
    for (final s in stock) {
      quantityByItem[s.itemId] = (quantityByItem[s.itemId] ?? 0) + s.quantity;
    }
    return _Data(results[0] as List<Item>, results[1] as List<Location>, quantityByItem);
  }

  Future<void> _refresh() async {
    final f = _load();
    setState(() {
      _future = f;
    });
    await f;
  }

  Future<void> _openAddSheet(List<Location> locations) async {
    if (locations.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Create a location first (Locations tab).')),
      );
      return;
    }
    final added = await showSlideSheet<bool>(
      context,
      builder: (_) => AddItemSheet(locations: locations),
    );
    if (added == true) await _refresh();
  }

  Future<void> _delete(Item item) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete "${item.name}"?'),
        content: const Text("This can't be undone."),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete')),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      await _repo.deleteItem(item.id);
      await _refresh();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  void _openCategory(String title, List<Item> items, _Data data, {required bool canManage}) {
    Navigator.of(context)
        .push(MaterialPageRoute(
          builder: (_) => CategoryItemsScreen(
            title: title,
            items: items,
            quantityByItem: data.quantityByItem,
            onDelete: canManage ? _delete : null,
            onReturn: _refresh,
          ),
        ))
        .then((_) => _refresh());
  }

  @override
  Widget build(BuildContext context) {
    final canManage = !widget.readOnly;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.readOnly ? 'Browse items' : 'Items'),
        actions: const [SearchButton()],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<_Data>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError && !snap.hasData) {
              return ErrorState(message: '${snap.error}', onRetry: _refresh);
            }
            final data = snap.data!;
            if (data.items.isEmpty) {
              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  const SizedBox(height: 120),
                  Center(child: Text(canManage ? 'No items yet. Tap + to add one.' : 'No items yet.')),
                ],
              );
            }
            final categories = groupByCategory(data.items, data.quantityByItem);
            final cs = Theme.of(context).colorScheme;

            return ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: EdgeInsets.fromLTRB(16, 12, 16, canManage ? 88 : 16),
              children: [
                Text('CATEGORIES', style: TextStyle(fontSize: 11, letterSpacing: 0.6, color: cs.onSurfaceVariant)),
                const SizedBox(height: 8),
                GridView.count(
                  crossAxisCount: 2,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  mainAxisSpacing: 12,
                  crossAxisSpacing: 12,
                  childAspectRatio: 1.55,
                  children: [
                    _CategoryTile(
                      name: 'All items',
                      count: data.items.length,
                      units: data.quantityByItem.values.fold(0, (a, b) => a + b),
                      icon: Icons.apps,
                      onTap: () => _openCategory('All items', data.items, data, canManage: canManage),
                    ),
                    for (final c in categories)
                      _CategoryTile(
                        name: c.name,
                        count: c.items.length,
                        units: c.units,
                        out: c.out,
                        low: c.low,
                        icon: c.name == kUncategorized ? Icons.help_outline : Icons.category_outlined,
                        onTap: () => _openCategory(c.name, c.items, data, canManage: canManage),
                      ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
      floatingActionButton: widget.readOnly
          ? null
          : FutureBuilder<_Data>(
              future: _future,
              builder: (context, snap) => FloatingActionButton.extended(
                heroTag: null,
                onPressed: snap.hasData ? () => _openAddSheet(snap.data!.locations) : null,
                icon: const Icon(Icons.add),
                label: const Text('Add item'),
              ),
            ),
    );
  }
}

/// One category as a tile: its name, how many items and units, and — when
/// something in it is out or low — a coloured badge, so a problem is visible
/// without opening it.
class _CategoryTile extends StatelessWidget {
  const _CategoryTile({
    required this.name,
    required this.count,
    required this.units,
    required this.icon,
    required this.onTap,
    this.out = 0,
    this.low = 0,
  });

  final String name;
  final int count;
  final int units;
  final int out;
  final int low;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tone = out > 0 ? StatusColors.out : (low > 0 ? StatusColors.low : null);
    return Card(
      color: tone?.withValues(alpha: 0.10),
      shape: tone == null
          ? null
          : RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: BorderSide(color: tone.withValues(alpha: 0.45)),
            ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(children: [
                Icon(icon, size: 20, color: cs.onSurfaceVariant),
                const Spacer(),
                if (tone != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(color: tone.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(999)),
                    child: Text(
                      out > 0 ? '$out out' : '$low low',
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: StatusColors.text(context, tone)),
                    ),
                  ),
              ]),
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                Text('$count item${count == 1 ? '' : 's'} · $units units',
                    maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
              ]),
            ],
          ),
        ),
      ),
    );
  }
}
