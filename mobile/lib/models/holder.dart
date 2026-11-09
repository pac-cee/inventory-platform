/// A person currently holding an item (net quantity checked out).
class Holder {
  Holder({required this.userId, required this.fullName, required this.quantity});

  final String userId;
  final String fullName;
  final int quantity;

  factory Holder.fromJson(Map<String, dynamic> json) => Holder(
        userId: json['user_id'] as String,
        fullName: (json['full_name'] as String?) ?? '',
        quantity: (json['quantity'] as num).toInt(),
      );
}
