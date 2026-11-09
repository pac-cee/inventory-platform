import 'models.dart';

/// What the Users screen shows: who needs attention first, filtered by what the
/// admin is looking for. Kept out of the widget so the rules can be tested.

enum UserFilter { all, needsApproval, blocked, admins, stockManagers, members }

/// Why a person is in the "attention" group, for the row's badge.
enum UserState { needsApproval, awaitingEmail, blocked, active }

UserState stateOf(Profile p) {
  if (p.awaitingApproval) return p.waitingOnAdmin ? UserState.needsApproval : UserState.awaitingEmail;
  if (p.blocked) return UserState.blocked;
  return UserState.active;
}

bool _matches(Profile p, UserFilter f) => switch (f) {
      UserFilter.all => true,
      UserFilter.needsApproval => p.awaitingApproval,
      UserFilter.blocked => p.blocked && !p.awaitingApproval,
      UserFilter.admins => p.role == 'admin',
      UserFilter.stockManagers => p.role == 'stock_manager',
      UserFilter.members => p.role == 'member',
    };

/// People matching the filter and any typed text (name or email), in the order an
/// admin wants to work through them: people waiting to be let in first, then
/// active people A to Z, then blocked people.
List<Profile> visibleUsers(List<Profile> all, UserFilter filter, String query) {
  final q = query.trim().toLowerCase();
  int rank(Profile p) => switch (stateOf(p)) {
        UserState.needsApproval => 0,
        UserState.awaitingEmail => 1,
        UserState.active => 2,
        UserState.blocked => 3,
      };
  final out = [
    for (final p in all)
      if (_matches(p, filter) &&
          (q.isEmpty || (p.fullName ?? '').toLowerCase().contains(q) || (p.email ?? '').toLowerCase().contains(q)))
        p,
  ]..sort((a, b) {
      final byRank = rank(a).compareTo(rank(b));
      if (byRank != 0) return byRank;
      return (a.fullName ?? '').toLowerCase().compareTo((b.fullName ?? '').toLowerCase());
    });
  return out;
}

class UsersSummary {
  const UsersSummary({required this.total, required this.needsApproval, required this.blocked});
  final int total;
  final int needsApproval;
  final int blocked;
}

UsersSummary summarizeUsers(List<Profile> all) => UsersSummary(
      total: all.length,
      needsApproval: all.where((p) => p.awaitingApproval).length,
      blocked: all.where((p) => p.blocked && !p.awaitingApproval).length,
    );

/// "AU" for "Amina Uwase", "A" for "Amina", "?" for nobody — for the avatar.
String initialsOf(String? name) {
  final parts = (name ?? '').trim().split(RegExp(r'\s+')).where((s) => s.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first[0].toUpperCase();
  return (parts.first[0] + parts.last[0]).toUpperCase();
}
