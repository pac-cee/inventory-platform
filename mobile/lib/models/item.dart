class Item {
  Item({
    required this.id,
    required this.type,
    required this.name,
    required this.model,
    required this.sku,
    this.specification,
    this.unitsPerContainer = 1,
    this.packageLabel,
    this.category,
    this.photoUrl,
    this.hasPhoto = false,
    this.finishable = false,
  });

  final String id;

  /// What kind of thing this is — "Cable". The SKU prefix is built from it.
  final String type;

  /// What this particular item is called.
  final String name;

  /// Model designation. Required; rows predating 0039 read 'Unspecified'.
  final String model;

  /// Machine-assigned, `vrlt-<consonants of type>-<seq>`. Never user-entered.
  final String sku;

  /// Free-text spec adding detail beyond the type/name/model identity.
  final String? specification;

  /// Individual units packed in one container (box/pallet/crate); 1 = loose.
  final int unitsPerContainer;

  /// When set, stock is counted in whole packages (contents not tracked); the
  /// quantity is a package count and the UI shows "5 <packageLabel>s".
  final String? packageLabel;

  /// Grouping for the condition report — "Computer Laptop", "Cables".
  /// Free text; /reports/categories lists what is already in use.
  final String? category;

  /// Link to a picture hosted elsewhere.
  final String? photoUrl;

  /// True when an image was uploaded; the bytes come from /items/:id/photo.
  final bool hasPhoto;

  /// When true, users can permanently "finish" (consume) this item.
  final bool finishable;

  /// True when this item is counted in whole packages.
  bool get isPackaged => packageLabel != null && packageLabel!.isNotEmpty;

  /// How the item names itself under its type: name, and model when it is a
  /// real one rather than the placeholder 0039 backfilled.
  String get itemLabel => model.isEmpty || model == 'Unspecified' ? name : '$name · $model';

  factory Item.fromJson(Map<String, dynamic> json) => Item(
        id: json['id'] as String,
        // Tolerate a server that predates 0039 so an updated app does not
        // crash against an old API: fall back to the name it used to send.
        type: (json['type'] as String?) ?? (json['name'] as String? ?? ''),
        name: json['name'] as String,
        model: (json['model'] as String?) ?? 'Unspecified',
        sku: (json['sku'] as String?) ?? '',
        specification: json['specification'] as String?,
        unitsPerContainer: (json['units_per_container'] as num?)?.toInt() ?? 1,
        packageLabel: json['package_label'] as String?,
        category: json['category'] as String?,
        photoUrl: json['photo_url'] as String?,
        hasPhoto: json['has_photo'] == true,
        finishable: (json['finishable'] as bool?) ?? false,
      );
}

/// Display a raw quantity for an item, respecting package mode:
/// package item → "5 packages"; otherwise the plain number.
String formatItemQuantity(Item item, int quantity) {
  if (item.isPackaged) {
    return '$quantity ${item.packageLabel}${quantity == 1 ? '' : 's'}';
  }
  return '$quantity';
}
