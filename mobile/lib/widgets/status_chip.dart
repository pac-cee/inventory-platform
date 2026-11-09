import 'package:flutter/material.dart';

import '../config/theme.dart';
import '../models.dart';

class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.quantity});
  final int quantity;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (statusForQuantity(quantity)) {
      StockStatus.out => ('Out of stock', StatusColors.out),
      StockStatus.low => ('Low', StatusColors.low),
      StockStatus.ok => ('In stock', StatusColors.ok),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: StatusColors.text(context, color)),
      ),
    );
  }
}
