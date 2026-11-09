import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/config/roles.dart';

/// Mirrors web/src/lib/roles.test.ts and the API guards. If these three drift,
/// a client offers buttons the server refuses — or hides ones it would allow.

void main() {
  group('canManageInventory — mirrors requireInventoryManager', () {
    test('an admin runs the warehouse', () {
      expect(canManageInventory(role: roleAdmin), isTrue);
    });

    test('a stock manager runs the warehouse', () {
      expect(canManageInventory(role: roleStockManager), isTrue);
    });

    test('a member granted the flag runs it without the role', () {
      expect(
        canManageInventory(role: roleMember, canManageInventoryFlag: true),
        isTrue,
      );
    });

    test('a plain member does not', () {
      expect(canManageInventory(role: roleMember), isFalse);
      expect(canManageInventory(role: null), isFalse);
    });
  });

  group('canApprovePayments — the warehouse is not authority over money', () {
    test('a stock manager cannot approve, however inventory is granted', () {
      expect(canApprovePayments(role: roleStockManager), isFalse);
      expect(canApprovePayments(role: roleMember), isFalse);
    });

    test('an admin and a cashier can', () {
      expect(canApprovePayments(role: roleAdmin), isTrue);
      expect(canApprovePayments(role: roleMember, fallbackRole: 'cashier'), isTrue);
    });
  });

  group('isAdminRole stays narrow', () {
    test('only the admin role', () {
      expect(isAdminRole(roleAdmin), isTrue);
      expect(isAdminRole(roleStockManager), isFalse);
      expect(isAdminRole(roleMember), isFalse);
    });
  });

  group('isKnownRole guards the role dropdown', () {
    // A DropdownButton whose value is absent from its items throws and takes
    // the whole Users screen down — which is exactly what stock_manager did
    // before it was added to the list.
    test('knows every assignable role', () {
      for (final r in kAssignableRoles) {
        expect(isKnownRole(r.value), isTrue, reason: r.value);
      }
    });

    test('stock_manager is assignable, so the dropdown can show it', () {
      expect(isKnownRole(roleStockManager), isTrue);
      expect(kAssignableRoles.map((r) => r.value), contains(roleStockManager));
    });

    test('a role from a newer server is not known, and must not be selected', () {
      expect(isKnownRole('auditor'), isFalse);
      expect(isKnownRole(null), isFalse);
    });
  });

  group('roleLabel', () {
    test('renders the assignable roles', () {
      expect(roleLabel(roleAdmin), 'Admin');
      expect(roleLabel(roleStockManager), 'Stock manager');
      expect(roleLabel(roleMember), 'Member');
    });

    test('shows an unrecognised role as-is rather than mislabelling it', () {
      expect(roleLabel('auditor'), 'auditor');
      expect(roleLabel(null), 'Member');
    });
  });

  group('the assignable list', () {
    test('offers the three roles the API accepts, in order', () {
      expect(
        kAssignableRoles.map((r) => r.value).toList(),
        [roleMember, roleStockManager, roleAdmin],
      );
    });

    test('says what the stock manager cannot do, since that is the point', () {
      final sm = kAssignableRoles.firstWhere((r) => r.value == roleStockManager);
      expect(sm.hint.toLowerCase(), contains('cannot approve payments'));
    });
  });
}
