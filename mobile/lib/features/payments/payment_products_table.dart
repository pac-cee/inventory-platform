import 'package:flutter/material.dart';

import '../../models.dart';
import 'new_request_sheet.dart';


class ProductsTable extends StatelessWidget {
  const ProductsTable({super.key, required this.products});
  final List<PaymentProduct> products;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: cs.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: [
          _TableHeader(cs: cs),
          const Divider(height: 1),
          for (int i = 0; i < products.length; i++) ...[
            if (i > 0) const Divider(height: 1),
            _TableRow(product: products[i]),
          ],
          const Divider(height: 1),
          _TableTotal(products: products),
        ],
      ),
    );
  }
}

class _TableHeader extends StatelessWidget {
  const _TableHeader({required this.cs});
  final ColorScheme cs;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      color: cs.surfaceContainerHighest.withValues(alpha: 0.5),
      child: const Row(
        children: [
          Expanded(
              child: Text('Item',
                  style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600))),
          SizedBox(
              width: 36,
              child: Text('Qty',
                  textAlign: TextAlign.right,
                  style: TextStyle(
                      fontSize: 11, fontWeight: FontWeight.w600))),
          SizedBox(
              width: 72,
              child: Text('Unit (RWF)',
                  textAlign: TextAlign.right,
                  style: TextStyle(
                      fontSize: 11, fontWeight: FontWeight.w600))),
          SizedBox(
              width: 72,
              child: Text('Total (RWF)',
                  textAlign: TextAlign.right,
                  style: TextStyle(
                      fontSize: 11, fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }
}

class _TableRow extends StatelessWidget {
  const _TableRow({required this.product});
  final PaymentProduct product;

  @override
  Widget build(BuildContext context) {
    final lineTotal = product.price * product.quantity;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(product.name,
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w500)),
                if (product.description != null)
                  Text(product.description!,
                      style: const TextStyle(
                          fontSize: 11, color: Colors.grey)),
              ],
            ),
          ),
          SizedBox(
              width: 36,
              child: Text('${product.quantity}',
                  textAlign: TextAlign.right,
                  style: const TextStyle(fontSize: 13))),
          SizedBox(
              width: 72,
              child: Text(formatNum(product.price),
                  textAlign: TextAlign.right,
                  style: const TextStyle(fontSize: 11))),
          SizedBox(
              width: 72,
              child: Text(formatNum(lineTotal),
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }
}

class _TableTotal extends StatelessWidget {
  const _TableTotal({required this.products});
  final List<PaymentProduct> products;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final total =
        products.fold<double>(0, (s, p) => s + p.price * p.quantity);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      color: cs.surfaceContainerHighest.withValues(alpha: 0.3),
      child: Row(
        children: [
          const Expanded(
              child: Text('Total',
                  style: TextStyle(fontWeight: FontWeight.bold))),
          Text(formatRwf(total),
              style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  color: cs.primary)),
        ],
      ),
    );
  }
}
