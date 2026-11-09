class PaymentProduct {
  PaymentProduct({
    required this.name,
    this.type,
    this.model,
    this.sku,
    this.specification,
    this.description,
    required this.quantity,
    required this.price,
    this.imageBase64,
  });

  final String name;
  /// Item type and model, carried so an approved purchase can create a
  /// properly shaped catalog item. The SKU is assigned then, not here.
  final String? type;
  final String? model;
  final String? sku;
  final String? specification;
  final String? description;
  final int quantity;
  final double price;
  final String? imageBase64;

  factory PaymentProduct.fromJson(Map<String, dynamic> json) => PaymentProduct(
        name: json['name'] as String,
        type: json['type'] as String?,
        model: json['model'] as String?,
        sku: json['sku'] as String?,
        specification: json['specification'] as String?,
        description: json['description'] as String?,
        quantity: (json['quantity'] as num).toInt(),
        price: (json['price'] as num).toDouble(),
        imageBase64: json['item_photo_base64'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'name': name,
        if (type != null && type!.isNotEmpty) 'type': type,
        if (model != null && model!.isNotEmpty) 'model': model,
        if (sku != null && sku!.isNotEmpty) 'sku': sku,
        if (specification != null && specification!.isNotEmpty)
          'specification': specification,
        if (description != null && description!.isNotEmpty)
          'description': description,
        'quantity': quantity,
        'price': price,
        'image_base64': imageBase64,
      };
}
