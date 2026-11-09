import 'dart:convert';

import 'package:flutter/material.dart';

import '../../models.dart';

class CartItemTile extends StatelessWidget {
  const CartItemTile({
    super.key,
    required this.product,
    required this.rwf,
    required this.onRemove,
    this.onPhoto,
  });
  final PaymentProduct product;
  final String Function(double) rwf;
  final VoidCallback onRemove;
  final VoidCallback? onPhoto;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: onPhoto == null
          ? const Icon(Icons.inventory_2_outlined)
          : GestureDetector(
              onTap: onPhoto,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.memory(
                  base64Decode(product.imageBase64!.split(',').last),
                  width: 44,
                  height: 44,
                  fit: BoxFit.cover,
                ),
              ),
            ),
      title: Text(product.name,
          style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(
          '${product.quantity} × ${rwf(product.price)}  ·  ${rwf(product.price * product.quantity)}'),
      trailing: IconButton(
        tooltip: 'Remove from cart',
        icon: const Icon(Icons.close, size: 18),
        onPressed: onRemove,
      ),
    );
  }
}
