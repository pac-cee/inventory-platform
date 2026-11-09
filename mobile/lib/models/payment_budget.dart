class PaymentBudget {
  const PaymentBudget({
    required this.allocatedAmount,
    required this.remainingAmount,
    required this.month,
    required this.year,
  });

  final double allocatedAmount;
  final double remainingAmount;
  final int month;
  final int year;

  double get usedAmount => allocatedAmount - remainingAmount;
  double get utilizationPct =>
      allocatedAmount > 0 ? (usedAmount / allocatedAmount) * 100 : 0;

  factory PaymentBudget.fromJson(Map<String, dynamic> json) => PaymentBudget(
        allocatedAmount: (json['allocated_amount'] as num).toDouble(),
        remainingAmount: (json['remaining_amount'] as num).toDouble(),
        month: (json['month'] as num).toInt(),
        year: (json['year'] as num).toInt(),
      );
}
