class Profile {
  Profile({
    required this.id,
    required this.role,
    this.fullName,
    this.blocked = false,
    this.approvalStatus = 'approved',
    this.email,
    this.emailConfirmed,
    this.hasPaymentPermission = false,
    this.dailyLimit = 0,
    this.monthlyLimit = 0,
    this.perTransactionLimit = 0,
    this.createdAt,
  });

  final String id;
  final String role; // 'member' | 'admin'
  final String? fullName;
  final bool blocked;

  /// 'pending' until an admin lets a self-registered account in; 'approved'
  /// for everything an admin created and everything from before the gate.
  final String approvalStatus;

  /// Admin-only, so null for a member reading the list.
  final String? email;
  final bool? emailConfirmed;
  final bool hasPaymentPermission;
  final double dailyLimit;
  final double monthlyLimit;
  final double perTransactionLimit;
  final DateTime? createdAt;

  /// Registered themselves and not yet approved. `blocked` is true as well.
  bool get awaitingApproval => approvalStatus == 'pending';

  /// Whose move it is. Once the address is confirmed the only thing left is an
  /// admin approving; before that, approving would let an unproven address in.
  bool get waitingOnAdmin => awaitingApproval && emailConfirmed != false;

  factory Profile.fromJson(Map<String, dynamic> json) => Profile(
        id: json['id'] as String,
        role: (json['role'] as String?) ?? 'member',
        fullName: json['full_name'] as String?,
        blocked: (json['blocked'] as bool?) ?? false,
        approvalStatus: (json['approval_status'] as String?) ?? 'approved',
        email: json['email'] as String?,
        emailConfirmed: json['email_confirmed'] as bool?,
        hasPaymentPermission:
            (json['has_payment_permission'] as bool?) ?? false,
        dailyLimit: (json['daily_limit'] as num?)?.toDouble() ?? 0,
        monthlyLimit: (json['monthly_limit'] as num?)?.toDouble() ?? 0,
        perTransactionLimit:
            (json['per_transaction_limit'] as num?)?.toDouble() ?? 0,
        createdAt: json['created_at'] != null
            ? DateTime.tryParse(json['created_at'] as String)
            : null,
      );
}
