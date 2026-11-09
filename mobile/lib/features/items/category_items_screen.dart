import 'package:flutter/material.dart';

import '../../models.dart';
import '../../search_logic.dart';
import '../../widgets/item_stock_tile.dart';

/// The items of one category (or all of them), with a search that stays inside
/// the category — so a long catalog never has to be scrolled to find a cable.
class CategoryItemsScreen extends StatefulWidget {
  const CategoryItemsScreen({
    super.key,
    required this.title,
    required this.items,
    required this.quantityByItem,
    this.onDelete,
    this.onReturn,
  });

  final String title;
  final List<Item> items;
  final Map<String, int> quantityByItem;

  /// Managers get a delete button on each row; others get none.
  final Future<void> Function(Item item)? onDelete;

  /// Called when an item screen or a delete finished, so the caller can reload.
  final VoidCallback? onReturn;

  @override
  State<CategoryItemsScreen> createState() => _CategoryItemsScreenState();
}

class _CategoryItemsScreenState extends State<CategoryItemsScreen> {
  String _q = '';
  late List<Item> _items = widget.items;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final q = _q.trim();
    final shown = q.isEmpty ? _items : rankItems(_items, q, limit: _items.length);

    return Scaffold(
      appBar: AppBar(title: Text('${widget.title} (${_items.length})')),
      body: Column(
        children: [
          if (_items.length > 6)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: TextField(
                decoration: InputDecoration(
                  hintText: 'Search in ${widget.title}…',
                  prefixIcon: const Icon(Icons.search),
                  isDense: true,
                ),
                onChanged: (v) => setState(() => _q = v),
              ),
            ),
          Expanded(
            child: shown.isEmpty
                ? Center(
                    child: Text(q.isEmpty ? 'No items here.' : 'No match for “$q”.',
                        style: TextStyle(color: cs.onSurfaceVariant)))
                : ListView.separated(
                    keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                    itemCount: shown.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) {
                      final item = shown[i];
                      return ItemStockTile(
                        item: item,
                        quantity: widget.quantityByItem[item.id] ?? 0,
                        onReturn: widget.onReturn,
                        trailing: widget.onDelete == null
                            ? null
                            : IconButton(
                                tooltip: 'Delete item',
                                icon: const Icon(Icons.delete_outline),
                                onPressed: () async {
                                  await widget.onDelete!(item);
                                  // The caller reloads; drop it from this view too.
                                  if (mounted) setState(() => _items = _items.where((x) => x.id != item.id).toList());
                                },
                              ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
