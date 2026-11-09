import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/models.dart';

Map<String, dynamic> json({String? name}) => {
      'id': 't1',
      'user_id': 'u1',
      'recipient_phone': '0788123456',
      if (name != null) 'recipient_name': name,
      'amount': 500,
      'status': 'pending',
      'location_id': 'l1',
      'created_at': '2026-10-29T08:00:00.000Z',
      'payment_method': 'bk',
    };

void main() {
  test('a BK phone payment reads as the person\'s name when it has one', () {
    final tx = PaymentTransaction.fromJson(json(name: 'Amina Uwase'));
    expect(tx.recipientName, 'Amina Uwase');
    expect(tx.recipientLabel, 'Amina Uwase');
  });
  test('older payments, with no name, still read as the phone number', () {
    final tx = PaymentTransaction.fromJson(json());
    expect(tx.recipientName, isNull);
    expect(tx.recipientLabel, '0788123456');
  });
}
