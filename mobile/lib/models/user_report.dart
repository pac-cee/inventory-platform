class UserReport {
  const UserReport({
    required this.dailySpent,
    required this.monthlySpent,
    required this.lifetimeSpent,
    required this.recentTransactions,
  });

  final double dailySpent;
  final double monthlySpent;
  final double lifetimeSpent;
  final List<ReportTransaction> recentTransactions;

  factory UserReport.fromJson(Map<String, dynamic> json) => UserReport(
        dailySpent: (json['daily_spent'] as num?)?.toDouble() ?? 0.0,
        monthlySpent: (json['monthly_spent'] as num?)?.toDouble() ?? 0.0,
        lifetimeSpent: (json['lifetime_spent'] as num?)?.toDouble() ?? 0.0,
        recentTransactions: (json['recent_transactions'] as List<dynamic>? ?? [])
            .map((e) => ReportTransaction.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class ReportTransaction {
  const ReportTransaction({
    required this.id,
    required this.amount,
    required this.status,
    required this.createdAt,
    required this.recipientPhone,
    this.locationName,
    required this.products,
  });

  final String id;
  final double amount;
  final String status;
  final DateTime createdAt;
  final String recipientPhone;
  final String? locationName;
  final List<ReportProduct> products;

  factory ReportTransaction.fromJson(Map<String, dynamic> json) => ReportTransaction(
        id: json['id'] as String,
        amount: (json['amount'] as num?)?.toDouble() ?? 0.0,
        status: (json['status'] as String?) ?? '',
        createdAt: DateTime.tryParse(json['created_at'] as String? ?? '') ?? DateTime.now(),
        recipientPhone: (json['recipient_phone'] as String?) ?? '',
        locationName: json['location_name'] as String?,
        products: (json['products'] as List<dynamic>? ?? [])
            .map((e) => ReportProduct.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class ReportProduct {
  const ReportProduct({
    required this.name,
    required this.quantity,
    required this.price,
  });

  final String name;
  final int quantity;
  final double price;

  factory ReportProduct.fromJson(Map<String, dynamic> json) => ReportProduct(
        name: (json['name'] as String?) ?? '',
        quantity: (json['quantity'] as num?)?.toInt() ?? 0,
        price: (json['price'] as num?)?.toDouble() ?? 0.0,
      );
}
