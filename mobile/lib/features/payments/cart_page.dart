import 'dart:convert';

import 'package:flutter/material.dart';

import '../../models.dart';
import '../../payment_repository.dart';
import 'cart_item_tile.dart';
import 'new_request_sheet.dart' show PaymentDraft, formatRwf;

class CartPage extends StatefulWidget {
  const CartPage({super.key, required this.draft, required this.onSubmitted});
  final PaymentDraft draft;
  final VoidCallback onSubmitted;

  @override
  State<CartPage> createState() => _CartPageState();
}

class _CartPageState extends State<CartPage> {
  final _repo = const PaymentRepository();
  late List<PaymentProduct> _items;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _items = List.from(widget.draft.products);
  }

  double get _total =>
      _items.fold<double>(0, (s, p) => s + p.price * p.quantity);

  void _removeAt(int i) => setState(() => _items.removeAt(i));

  Future<void> _submit() async {
    if (_items.isEmpty) {
      setState(() => _error = 'Cart is empty.');
      return;
    }
    if (widget.draft.locationId == null) {
      setState(() => _error = 'No storage location set. Re-open the request form.');
      return;
    }
    final hasPhone = widget.draft.phone.trim().isNotEmpty;
    final hasBankAccount = widget.draft.bankAccountNumber != null &&
        widget.draft.bankAccountName != null &&
        widget.draft.tinNumber != null;
    if (widget.draft.paymentMethod == 'momo' && !hasPhone) {
      setState(() => _error = 'Recipient phone is required for MoMo.');
      return;
    }
    // BK covers two patterns: paying an employee's phone, or a vendor's bank
    // account (bank account number, account name and TIN together) — one of
    // the two is required.
    if (widget.draft.paymentMethod == 'bk' && !hasPhone && !hasBankAccount) {
      setState(() => _error =
          'Enter a recipient phone, or a bank account number, account name and TIN.');
      return;
    }
    // A Bank of Kigali payment to a phone needs the person's name with the number.
    if (widget.draft.paymentMethod == 'bk' && hasPhone && widget.draft.recipientName.trim().isEmpty) {
      setState(() => _error = 'Enter the recipient\'s name.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await _repo.createPayment(
        paymentMethod: widget.draft.paymentMethod,
        recipientPhone: hasPhone ? widget.draft.phone : null,
        recipientName: widget.draft.paymentMethod == 'bk' && hasPhone ? widget.draft.recipientName.trim() : null,
        bankAccountNumber: hasPhone ? null : widget.draft.bankAccountNumber,
        bankAccountName: hasPhone ? null : widget.draft.bankAccountName,
        tinNumber: hasPhone ? null : widget.draft.tinNumber,
        locationId: widget.draft.locationId!,
        products: _items,
      );
      if (!mounted) return;
      widget.onSubmitted();
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final total = _total;
    return Scaffold(
      appBar: AppBar(title: const Text('Cart')),
      body: Column(
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(_error!,
                  style: const TextStyle(color: Color(0xFFEF4444))),
            ),
          Expanded(
            child: _items.isEmpty
                ? const Center(child: Text('No items yet.'))
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                    itemCount: _items.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) => CartItemTile(
                      // Identity, not position: with an index key, removing an
                      // item re-used the neighbour's state and animated wrongly.
                      key: ObjectKey(_items[i]),
                      product: _items[i],
                      rwf: formatRwf,
                      onRemove: () => _removeAt(i),
                      onPhoto: _items[i].imageBase64 == null
                          ? null
                          : () => _viewPhoto(_items[i].imageBase64!),
                    ),
                  ),
          ),
          // Total and the one Submit button live in a bar under the list, so
          // nothing floats over the amount being approved.
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              decoration: BoxDecoration(
                border: Border(
                  top: BorderSide(
                    color: Theme.of(context).colorScheme.outlineVariant,
                  ),
                ),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Total', style: TextStyle(fontSize: 16)),
                      Text(formatRwf(total),
                          style: const TextStyle(
                              fontSize: 18, fontWeight: FontWeight.bold)),
                    ],
                  ),
                  if (_items.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: _saving ? null : _submit,
                      icon: _saving
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.check),
                      label: const Text('Submit request'),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _viewPhoto(String base64) {
    final bytes = base64Decode(base64.split(',').last);
    showDialog(
      context: context,
      builder: (_) => Dismissible(
        key: const Key('photo'),
        direction: DismissDirection.down,
        onDismissed: (_) => Navigator.of(context).pop(),
        child: Scaffold(
          backgroundColor: Colors.black,
          body: Stack(
            children: [
              Center(
                child: InteractiveViewer(
                  child: Image.memory(bytes, fit: BoxFit.contain),
                ),
              ),
              Positioned(
                top: 40,
                right: 16,
                child: IconButton(
                  tooltip: 'Close',
                  icon: const Icon(Icons.close, color: Colors.white),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
