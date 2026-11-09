/// Items at or below this total quantity are flagged "low stock".
const int lowStockThreshold = 10;

enum StockStatus { out, low, ok }

StockStatus statusForQuantity(int quantity) {
  if (quantity <= 0) return StockStatus.out;
  if (quantity <= lowStockThreshold) return StockStatus.low;
  return StockStatus.ok;
}

class StockLevel {
  StockLevel({
    required this.itemId,
    required this.locationId,
    required this.quantity,
    this.damaged = 0,
    this.capacity = 0,
    this.slotNo,
    this.containerLabel,
    this.itemType,
    this.itemName,
    this.itemModel,
    this.itemSku,
    this.locationName,
  });

  final String itemId;
  final String locationId;
  final int quantity;

  /// Damaged units — present and part of the total, but not accessible.
  final int damaged;
  final int capacity;

  /// This item's number within its location (0036) — what people point at on
  /// the shelf. Counts from 1 per location, so the same item can be #2 here and
  /// #7 elsewhere. Null only for stock that predates the numbering.
  final int? slotNo;

  /// Optional container label at this location ("box", "pallet", "crate").
  final String? containerLabel;
  final String? itemType;
  final String? itemName;
  final String? itemModel;
  final String? itemSku;

  /// How a stock row names its item: the type, falling back to the name.
  String get itemLabel => (itemType?.isNotEmpty ?? false) ? itemType! : (itemName ?? '—');
  final String? locationName;

  factory StockLevel.fromJson(Map<String, dynamic> json) {
    final items = json['items'] as Map<String, dynamic>?;
    final locations = json['locations'] as Map<String, dynamic>?;
    return StockLevel(
      itemId: json['item_id'] as String,
      locationId: json['location_id'] as String,
      quantity: (json['quantity'] as num).toInt(),
      damaged: (json['damaged'] as num?)?.toInt() ?? 0,
      capacity: (json['capacity'] as num?)?.toInt() ?? 0,
      slotNo: (json['slot_no'] as num?)?.toInt(),
      containerLabel: json['container_label'] as String?,
      itemType: items?['type'] as String?,
      itemName: items?['name'] as String?,
      itemModel: items?['model'] as String?,
      itemSku: items?['sku'] as String?,
      locationName: locations?['name'] as String?,
    );
  }
}
