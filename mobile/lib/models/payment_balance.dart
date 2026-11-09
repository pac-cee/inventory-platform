class PaymentBalance {
  const PaymentBalance({
    required this.availableBalance,
    required this.currency,
  });

  final double availableBalance;
  final String currency;

  factory PaymentBalance.fromJson(Map<String, dynamic> json) => PaymentBalance(
        availableBalance:
            double.tryParse('${json['availableBalance']}') ?? 0,
        currency: (json['currency'] as String?) ?? 'RWF',
      );
}
