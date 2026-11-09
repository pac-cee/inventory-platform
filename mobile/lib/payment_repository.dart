import 'dart:typed_data';

import 'config/api_client.dart';
import 'config/paging.dart';
import 'models.dart';

class PaymentRepository {
  const PaymentRepository();

  Future<List<PaymentTransaction>> fetchTransactions({String? userId}) async {
    final q = userId != null ? '&userId=$userId' : '';
    final data = await api.get('/payments/transactions?limit=100$q') as List<dynamic>;
    return data
        .map((e) => PaymentTransaction.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Every payment, paging through the whole list (admins and cashiers get
  /// everyone's) — for the report, which must not silently stop at 100.
  Future<List<PaymentTransaction>> fetchAllTransactions() => fetchAllPages((limit, offset) async {
        final data = await api.get('/payments/transactions?limit=$limit&offset=$offset') as List<dynamic>;
        return data.map((e) => PaymentTransaction.fromJson(e as Map<String, dynamic>)).toList();
      });

  Future<PaymentBalance?> fetchBalance() async {
    try {
      final data = await api.get('/payments/balance') as Map<String, dynamic>;
      return PaymentBalance.fromJson(data);
    } catch (_) {
      return null;
    }
  }

  Future<PaymentBudget?> fetchBudget() async {
    try {
      final data = await api.get('/payments/budgets') as Map<String, dynamic>;
      return PaymentBudget.fromJson(data);
    } catch (_) {
      return null;
    }
  }

  Future<PaymentBudget> setBudget(double amount) async {
    final data = await api.post('/payments/budgets', {
      'allocated_amount': amount,
    }) as Map<String, dynamic>;
    return PaymentBudget.fromJson(data);
  }

  /// Approves or rejects a request and returns the status the backend
  /// reports. An approved BK transfer can still be `processing` (HTTP 202):
  /// the provider confirms asynchronously, so callers must show this status,
  /// not assume `completed`. Anything unrecognised after an approval is
  /// treated as `processing` — never claim money moved when we don't know.
  Future<PaymentStatus> resolvePayment({
    required String id,
    required bool approve,
  }) async {
    final body = await api.post('/payments/resolve', {
      'id': id,
      'status': approve ? 'approved' : 'rejected',
    });
    if (!approve) return PaymentStatus.failed;
    final status = body is Map ? body['status'] : null;
    switch (status) {
      case 'completed':
        return PaymentStatus.completed;
      case 'failed':
        return PaymentStatus.failed;
      default:
        return PaymentStatus.processing;
    }
  }

  Future<void> setPaymentLimits(
    String userId, {
    required double dailyLimit,
    required double monthlyLimit,
    required double perTransactionLimit,
  }) async {
    await api.patch('/payments/profiles/$userId/payment-settings', {
      'daily_limit': dailyLimit,
      'monthly_limit': monthlyLimit,
      'per_transaction_limit': perTransactionLimit,
    });
  }

  Future<void> togglePaymentPermission(String userId, bool value) async {
    await api.patch(
      '/payments/profiles/$userId/payment-settings',
      {'has_payment_permission': value},
    );
  }

  Future<UserReport> fetchUserReport(String userId) async {
    final data = await api.get('/payments/reports/user/$userId') as Map<String, dynamic>;
    return UserReport.fromJson(data);
  }

  Future<String> exportReportCsv() => api.getRaw('/payments/reports/export');

  Future<String> createPayment({
    String paymentMethod = 'momo',
    String? recipientPhone,
    String? recipientName,
    String? bankAccountNumber,
    String? bankAccountName,
    String? tinNumber,
    required String locationId,
    required List<PaymentProduct> products,
  }) async {
    final data = await api.post('/payments/request', {
      'payment_method': paymentMethod,
      if (recipientPhone != null) 'recipient_phone': recipientPhone,
      if (recipientName != null && recipientName.isNotEmpty) 'recipient_name': recipientName,
      // BK covers two patterns (see cart_page.dart) — only send
      // payment_metadata for the bank-account one; the phone-only pattern
      // relies on recipient_phone above, same as MoMo.
      if (bankAccountNumber != null)
        'payment_metadata': {
          'bankAccountNumber': bankAccountNumber,
          'bankAccountName': bankAccountName,
          'tinNumber': tinNumber,
        },
      'location_id': locationId,
      'products': products.map((p) => p.toJson()).toList(),
      'receipt_base64': null,
    }) as Map<String, dynamic>;
    return data['transactionId'] as String;
  }

  /// Upload the purchased-item receipt photo for an approved transaction.
  /// The backend endpoint is multer-based (multipart/form-data), not JSON.
  Future<void> uploadReceipt(
    String id,
    Uint8List bytes, {
    String filename = 'receipt.jpg',
    String contentType = 'image/jpeg',
  }) async {
    await api.patchMultipart(
      '/payments/transactions/$id/receipt',
      bytes: bytes,
      filename: filename,
      contentType: contentType,
    );
  }
}
