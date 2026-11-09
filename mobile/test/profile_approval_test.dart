import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/models/profile.dart';

/// A self-registered account arrives blocked AND pending. The badge and the
/// menu key off `awaitingApproval`, so parsing it wrong silently turns "waiting
/// for approval" back into a plain "blocked" that nobody asked for.
void main() {
  Map<String, dynamic> json({
    String? status,
    bool blocked = false,
    bool? emailConfirmed,
  }) =>
      {
        'id': 'u1',
        'role': 'member',
        'full_name': 'Someone',
        'blocked': blocked,
        if (status != null) 'approval_status': status,
        if (emailConfirmed != null) 'email_confirmed': emailConfirmed,
      };

  group('Profile.approvalStatus', () {
    test('reads a pending account as awaiting approval', () {
      final p = Profile.fromJson(json(status: 'pending', blocked: true));
      expect(p.approvalStatus, 'pending');
      expect(p.awaitingApproval, isTrue);
      expect(p.blocked, isTrue);
    });

    test('an approved account is not awaiting anything', () {
      final p = Profile.fromJson(json(status: 'approved'));
      expect(p.awaitingApproval, isFalse);
    });

    test('a blocked but approved account is blocked, not waiting', () {
      final p = Profile.fromJson(json(status: 'approved', blocked: true));
      expect(p.blocked, isTrue);
      expect(p.awaitingApproval, isFalse);
    });

    test('an API that does not send the field means approved', () {
      // Older responses, and every account created before the gate existed.
      final p = Profile.fromJson(json());
      expect(p.approvalStatus, 'approved');
      expect(p.awaitingApproval, isFalse);
    });

    test('defaults to approved when constructed directly', () {
      expect(Profile(id: 'u1', role: 'member').awaitingApproval, isFalse);
    });
  });

  group('Profile.waitingOnAdmin', () {
    test('a confirmed address means the admin is the one holding it up', () {
      final p = Profile.fromJson(
          json(status: 'pending', blocked: true, emailConfirmed: true));
      expect(p.waitingOnAdmin, isTrue);
    });

    test('an unconfirmed address means the wait is on them', () {
      final p = Profile.fromJson(
          json(status: 'pending', blocked: true, emailConfirmed: false));
      expect(p.awaitingApproval, isTrue);
      expect(p.waitingOnAdmin, isFalse);
    });

    test('a member cannot see the flag, so it does not claim they are late', () {
      // Members are not sent email_confirmed at all.
      final p = Profile.fromJson(json(status: 'pending', blocked: true));
      expect(p.emailConfirmed, isNull);
      expect(p.waitingOnAdmin, isTrue);
    });

    test('an approved account is waiting on nobody', () {
      expect(Profile.fromJson(json(status: 'approved')).waitingOnAdmin, isFalse);
    });
  });
}
