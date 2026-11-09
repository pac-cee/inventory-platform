import 'package:flutter/material.dart';

import '../features/items/item_detail_screen.dart';
import '../features/items/item_photo.dart';
import '../models.dart';
import 'status_chip.dart';

/// One item as a list row: photo, what it is, how many there are and whether
/// that is healthy. Tapping opens the item. Used by the Dashboard, the low-stock
/// list and the category lists so they all read the same.
class ItemStockTile extends StatelessWidget {
  const ItemStockTile({super.key, required this.item, required this.quantity, this.trailing, this.onReturn});

  final Item item;
  final int quantity;

  /// Extra controls after the status chip (e.g. a manager's delete button).
  final Widget? trailing;

  /// Called when the item screen closes, so the list can refresh.
  final VoidCallback? onReturn;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: ItemThumb(item: item),
      title: Text(item.type, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text('${item.itemLabel} · ${item.sku}', maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('$quantity', style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(width: 8),
          StatusChip(quantity: quantity),
          if (trailing != null) trailing!,
        ],
      ),
      onTap: () => Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => ItemDetailScreen(itemId: item.id)))
          .then((_) => onReturn?.call()),
    );
  }
}
