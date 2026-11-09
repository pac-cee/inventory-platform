import 'payment_product.dart';

enum PaymentStatus { pending, processing, completed, failed }

PaymentStatus _statusFrom(String s) {
  switch (s) {
    case 'processing':
      return PaymentStatus.processing;
    case 'completed':
      return PaymentStatus.completed;
    case 'failed':
      return PaymentStatus.failed;
    default:
      return PaymentStatus.pending;
  }
}

class PaymentTransaction {
  PaymentTransaction({
    required this.id,
    this.recipientPhone,
    this.recipientName,
    required this.amount,
    required this.status,
    required this.locationId,
    required this.createdAt,
    this.createdByName,
    this.locationName,
    this.products = const [],
    this.receiptPhoto,
    this.paymentMethod = 'momo',
    this.paymentMetadata,
  });

  final String id;
  // Null for Bank of Kigali transactions — see paymentMetadata instead.
  final String? recipientPhone;

  /// Who a Bank of Kigali phone payment is for; null on older payments.
  final String? recipientName;
  final double amount;
  final PaymentStatus status;
  final String locationId;
  final DateTime createdAt;
  final String? createdByName;
  final String? locationName;
  final List<PaymentProduct> products;
  final String? receiptPhoto;
  final String paymentMethod; // 'momo' | 'bk'
  final Map<String, dynamic>? paymentMetadata;

  String? get bankAccountNumber => paymentMetadata?['bankAccountNumber'] as String?;
  String? get bankAccountName => paymentMetadata?['bankAccountName'] as String?;
  String? get tinNumber => paymentMetadata?['tinNumber'] as String?;

  /// True for BK's vendor-payment pattern (bank account destination). False
  /// for both MoMo and BK's employee-reimbursement pattern (phone
  /// destination) — those two look the same to the UI, just a phone number.
  bool get isBankAccountPayment => bankAccountNumber != null;

  /// A short "who this is going to" label regardless of payment method, for
  /// list rows/summaries that only have room for one line.
  String get recipientLabel => isBankAccountPayment
      ? (bankAccountName ?? bankAccountNumber ?? 'Bank of Kigali')
      : (recipientName?.isNotEmpty ?? false ? recipientName! : (recipientPhone ?? '—'));

  factory PaymentTransaction.fromJson(Map<String, dynamic> json) {
    final profile = json['profiles'] as Map<String, dynamic>?;
    final location = json['locations'] as Map<String, dynamic>?;
    final raw = json['transaction_products'] as List<dynamic>? ?? [];
    return PaymentTransaction(
      id: json['id'] as String,
      recipientPhone: json['recipient_phone'] as String?,
      recipientName: json['recipient_name'] as String?,
      amount: (json['amount'] as num).toDouble(),
      status: _statusFrom((json['status'] as String?) ?? 'pending'),
      locationId: json['location_id'] as String,
      createdAt: DateTime.parse(json['created_at'] as String),
      createdByName: profile?['full_name'] as String?,
      locationName: location?['name'] as String?,
      products: raw
          .map((e) => PaymentProduct.fromJson(e as Map<String, dynamic>))
          .toList(),
      receiptPhoto: json['receipt_base64'] as String?,
      paymentMethod: (json['payment_method'] as String?) ?? 'momo',
      paymentMetadata: json['payment_metadata'] as Map<String, dynamic>?,
    );
  }
}
