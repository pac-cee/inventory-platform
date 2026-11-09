import 'package:flutter/material.dart';

import 'status_chip.dart';

/// One item as it sits in a location: [tick] · photo · name over (#number · SKU) over its
/// status, and how many on the right.
///
/// Built as a plain row, NOT a ListTile: a ListTile gives its leading and trailing parts as
/// much room as they ask for, and with a checkbox, a number and a photo on one side and a
/// count and a chip on the other there was no width left for the name, which wrapped one
/// letter per line on a phone. Here the name always gets whatever the fixed parts leave.
class LocationStockRow extends StatelessWidget {
  const LocationStockRow({
    super.key,
    required this.name,
    required this.quantity,
    required this.thumb,
    this.sku,
    this.slotNo,
    this.selected = false,
    this.onSelectChanged,
    this.onTap,
    this.onMove,
  });

  final String name;
  final String? sku;
  final int? slotNo;
  final int quantity;
  final Widget thumb;
  final bool selected;

  /// When set, a tick box is shown first (managers who can move items).
  final VoidCallback? onSelectChanged;
  final VoidCallback? onTap;

  /// When set, a "move to a box" button follows the count (a level that has boxes on it).
  final VoidCallback? onMove;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final detail = [
      if (slotNo != null) '#$slotNo',
      if (sku != null && sku!.isNotEmpty) sku!,
    ].join(' · ');

    return Material(
      color: selected ? cs.primary.withValues(alpha: 0.08) : Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              if (onSelectChanged != null)
                SizedBox(
                  width: 40,
                  child: Checkbox(value: selected, onChanged: (_) => onSelectChanged!()),
                ),
              thumb,
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, maxLines: 2, overflow: TextOverflow.ellipsis),
                    if (detail.isNotEmpty)
                      Text(
                        detail,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant),
                      ),
                    // Under the name, not beside the count: a chip beside it left the name
                    // about 70 pixels on a small phone.
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: StatusChip(quantity: quantity),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text('$quantity', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
              if (onMove != null)
                IconButton(
                  tooltip: 'Move to a box',
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.move_to_inbox_outlined),
                  onPressed: onMove,
                ),
            ],
          ),
        ),
      ),
    );
  }
}
