/// Who may do what, in one place — the mobile counterpart of the web's
/// `web/src/lib/roles.ts`, and a mirror of the API guards in
/// `supabase/api/src/middleware/auth.ts`:
///
///   canManageInventory  <->  requireInventoryManager
///   isAdminRole         <->  requireAdmin
///   canApprovePayments  <->  requireAdminOrCashier
///
/// Running the warehouse and running the money are separate capabilities. Ask
/// the one you mean rather than asking "is an admin" and hoping.
library;

const String roleMember = 'member';
const String roleAdmin = 'admin';
const String roleStockManager = 'stock_manager';

/// The roles an admin can assign, in the order they should be offered.
const List<({String value, String label, String hint})> kAssignableRoles = [
  (value: roleMember, label: 'Member', hint: 'Takes and returns stock.'),
  (
    value: roleStockManager,
    label: 'Stock manager',
    hint: 'Adds items, locations and stock. Cannot approve payments.',
  ),
  (
    value: roleAdmin,
    label: 'Admin',
    hint: 'Everything, including users and payment approval.',
  ),
];

/// True when the API might hand us a role this build has never heard of.
///
/// A `DropdownButton` whose value is absent from its items throws and takes the
/// whole screen down, so every picker has to ask this first.
bool isKnownRole(String? role) =>
    kAssignableRoles.any((r) => r.value == role);

/// How a role reads in the UI.
String roleLabel(String? role) {
  for (final r in kAssignableRoles) {
    if (r.value == role) return r.label;
  }
  // An unrecognised role is shown as-is rather than silently relabelled — a
  // newer server is a real possibility, and hiding it would be worse.
  return role == null || role.isEmpty ? 'Member' : role;
}

/// Full run of the place: users, roles, budgets, payment approval.
bool isAdminRole(String? role) => role == roleAdmin;

/// Add, edit and remove items, locations and stock, and read the stock reports.
///
/// A stock manager has this by role; a member can be granted it individually
/// through `can_manage_inventory`. Says nothing about money.
bool canManageInventory({String? role, bool canManageInventoryFlag = false}) =>
    isAdminRole(role) || role == roleStockManager || canManageInventoryFlag;

/// Approve or reject someone's payment request. Deliberately excludes
/// stock_manager: running the warehouse is not authority to release money.
bool canApprovePayments({String? role, String? fallbackRole}) =>
    isAdminRole(role) || fallbackRole == 'cashier';
