/// Where an item is and how many: one row of GET /items/where, for search results.
class StockPlace {
  const StockPlace({
    required this.locationId,
    required this.path,
    required this.kind,
    required this.label,
    required this.quantity,
  });

  final String locationId;
  final String path;
  final String kind;
  final String? label;
  final int quantity;

  factory StockPlace.fromJson(Map<String, dynamic> j) => StockPlace(
        locationId: j['location_id'] as String,
        path: (j['path'] as String?) ?? '',
        kind: (j['kind'] as String?) ?? 'area',
        label: j['label'] as String?,
        quantity: (j['quantity'] as num).toInt(),
      );
}

class ItemWhere {
  const ItemWhere({required this.itemId, required this.total, required this.places});
  final String itemId;
  final int total;
  final List<StockPlace> places;

  factory ItemWhere.fromJson(Map<String, dynamic> j) => ItemWhere(
        itemId: j['item_id'] as String,
        total: (j['total'] as num).toInt(),
        places: [
          for (final p in (j['places'] as List? ?? const [])) StockPlace.fromJson(p as Map<String, dynamic>),
        ],
      );
}
