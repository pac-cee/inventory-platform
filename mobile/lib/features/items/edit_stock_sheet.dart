import 'package:flutter/material.dart';

import '../../config/theme.dart';
import '../../models.dart';
import '../../repository.dart';

class EditStockSheet extends StatefulWidget {
  const EditStockSheet({
    super.key,
    required this.itemId,
    required this.stock,
  });

  final String itemId;
  final List<StockLevel> stock;

  @override
  State<EditStockSheet> createState() => _EditStockSheetState();
}

class _EditStockSheetState extends State<EditStockSheet> {
  final _repo = const InventoryRepository();
  late String _locationId = widget.stock.first.locationId;
  late final TextEditingController _qty;
  late final TextEditingController _cap;
  bool _saving = false;
  String? _error;

  StockLevel get _current =>
      widget.stock.firstWhere((s) => s.locationId == _locationId);

  @override
  void initState() {
    super.initState();
    _qty = TextEditingController(text: '${_current.quantity}');
    _cap = TextEditingController(text: '${_current.capacity}');
  }

  void _syncToLocation() {
    _qty.text = '${_current.quantity}';
    _cap.text = '${_current.capacity}';
  }

  @override
  void dispose() {
    _qty.dispose();
    _cap.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final quantity = int.tryParse(_qty.text) ?? -1;
    final capacity = int.tryParse(_cap.text) ?? -1;
    if (quantity < 0 || capacity < 0) {
      setState(() => _error = "Numbers can't be negative.");
      return;
    }
    if (quantity > capacity) {
      setState(() => _error = "Quantity can't exceed the total.");
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await _repo.adjustStock(
        itemId: widget.itemId,
        locationId: _locationId,
        quantity: quantity,
        capacity: capacity,
      );
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      setState(() {
        _saving = false;
        _error = '$e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Edit stock numbers',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            isExpanded: true,
            initialValue: _locationId,
            decoration: const InputDecoration(labelText: 'Location'),
            items: [
              for (final s in widget.stock)
                DropdownMenuItem(
                    value: s.locationId,
                    child: Text(s.locationName ?? s.locationId,
                        maxLines: 1, overflow: TextOverflow.ellipsis)),
            ],
            onChanged: (v) {
              if (v == null) return;
              setState(() {
                _locationId = v;
                _syncToLocation();
              });
            },
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _qty,
                  keyboardType: TextInputType.number,
                  decoration:
                      const InputDecoration(labelText: 'Current quantity'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _cap,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Total'),
                ),
              ),
            ],
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(_error!,
                  style: const TextStyle(color: StatusColors.out)),
            ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'Saving…' : 'Save stock numbers'),
          ),
        ],
      ),
    );
  }
}
