import 'package:flutter/material.dart';

import '../../catalog_logic.dart';
import '../../models.dart';
import '../../widgets/item_stock_tile.dart';

/// Everything that is out or running low, most urgent first, filterable. The
/// Dashboard shows the top few; this is the whole scrollable list.
class LowStockScreen extends StatefulWidget {
  const LowStockScreen({super.key, required this.rows});
  final List<StockRow> rows;

  @override
  State<LowStockScreen> createState() => _LowStockScreenState();
}

class _LowStockScreenState extends State<LowStockScreen> {
  StockStatus? _only; // null = both

  @override
  Widget build(BuildContext context) {
    final rows = _only == null ? widget.rows : widget.rows.where((r) => r.status == _only).toList();
    final out = widget.rows.where((r) => r.status == StockStatus.out).length;
    final low = widget.rows.length - out;
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: Text('Needs restock (${widget.rows.length})')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Wrap(spacing: 8, children: [
              ChoiceChip(label: Text('All ${widget.rows.length}'), selected: _only == null, onSelected: (_) => setState(() => _only = null)),
              ChoiceChip(label: Text('Out of stock $out'), selected: _only == StockStatus.out, onSelected: (_) => setState(() => _only = StockStatus.out)),
              ChoiceChip(label: Text('Low $low'), selected: _only == StockStatus.low, onSelected: (_) => setState(() => _only = StockStatus.low)),
            ]),
          ),
          Expanded(
            child: rows.isEmpty
                ? Center(child: Text('Nothing here.', style: TextStyle(color: cs.onSurfaceVariant)))
                : ListView.separated(
                    itemCount: rows.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) => ItemStockTile(item: rows[i].item, quantity: rows[i].quantity),
                  ),
          ),
        ],
      ),
    );
  }
}
