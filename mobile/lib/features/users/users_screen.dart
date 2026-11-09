import 'package:flutter/material.dart';

import '../../config/api_client.dart';
import '../../models.dart';
import '../../payment_repository.dart';
import '../../repository.dart';
import '../../widgets.dart';
import 'add_user_sheet.dart';
import 'edit_user_sheet.dart';
import 'user_report_sheet.dart';
import '../../config/roles.dart';
import '../../widgets/search_button.dart';
import '../../users_logic.dart';
import '../../config/theme.dart';
import '../../widgets/error_state.dart';

class UsersScreen extends StatefulWidget {
  const UsersScreen({super.key});

  @override
  State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  final _users = const UsersRepository();
  final _payments = const PaymentRepository();

  List<Profile> _profiles = [];
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    // Spinner only for the first load; a refresh keeps the list on screen.
    if (_profiles.isEmpty) setState(() => _loading = true);
    try {
      final profiles = await _users.fetchProfiles();
      if (!mounted) return;
      setState(() {
        _profiles = profiles;
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      if (_profiles.isNotEmpty) {
        // Don't replace a good list with an error page because one refresh failed.
        setState(() => _loading = false);
        _snack("Couldn't refresh users: $e");
        return;
      }
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  Future<void> _refresh() => _load();

  void _snack(String msg) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  /// Pick a role for [p]. A sheet rather than an inline dropdown: on a phone
  /// the dropdown crowded the row and made the list hard to scan, and it left
  /// no room to say what each role can do.
  Future<void> _openRoleSheet(Profile p) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: Text(p.fullName ?? 'User',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: const Text('Choose a role'),
            ),
            const Divider(height: 1),
            // Plain tiles rather than RadioListTile: its groupValue/onChanged
            // are deprecated in this Flutter version, and picking a role
            // closes the sheet anyway, so a radio adds nothing.
            for (final r in kAssignableRoles)
              ListTile(
                leading: Icon(
                  r.value == p.role
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  color: r.value == p.role
                      ? Theme.of(context).colorScheme.primary
                      : Theme.of(context).colorScheme.outline,
                ),
                title: Text(r.label),
                subtitle: Text(r.hint),
                onTap: () => Navigator.of(sheetContext).pop(r.value),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (picked != null) await _changeRole(p, picked);
  }

  Future<void> _changeRole(Profile p, String role) async {
    if (role == p.role) return;
    // Admin is the highest role: a mis-tap in the dropdown must not grant it.
    if (role == 'admin') {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Make this person an admin?'),
          content: Text(
              '${p.fullName ?? 'This user'} will be able to manage users, roles and everything else in the app.'),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Make admin')),
          ],
        ),
      );
      if (ok != true || !mounted) return;
    }
    try {
      final updated = await _users.changeRole(p.id, role);
      if (!mounted) return;
      setState(() {
        final i = _profiles.indexWhere((x) => x.id == p.id);
        if (i != -1) _profiles[i] = updated;
      });
      _snack('${updated.fullName ?? 'User'} is now ${roleLabel(updated.role)}.');
    } catch (e) {
      _snack('$e');
    }
  }

  Future<void> _toggleBlock(Profile p) async {
    final verb = p.awaitingApproval ? 'Approve' : (p.blocked ? 'Unblock' : 'Block');
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('$verb ${p.fullName ?? 'this user'}?'),
        content: Text(p.awaitingApproval
            ? 'They will be able to sign in, and will be emailed that the account is approved.'
            : p.blocked
                ? 'They will be able to sign in and use the app again.'
                : 'They will be signed out and blocked from using the app until unblocked.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(verb)),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      await _users.setBlocked(p.id, !p.blocked);
      await _refresh();
    } catch (e) {
      _snack('$e');
    }
  }

  Future<void> _delete(Profile p) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete ${p.fullName ?? 'this user'}?'),
        content: const Text('This permanently removes the account.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete')),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      await _users.deleteUser(p.id);
      await _refresh();
    } catch (e) {
      _snack('$e');
    }
  }

  Future<void> _togglePaymentPermission(Profile p) async {
    final newValue = !p.hasPaymentPermission;
    try {
      await _payments.togglePaymentPermission(p.id, newValue);
      if (!mounted) return;
      setState(() {
        final i = _profiles.indexWhere((x) => x.id == p.id);
        if (i != -1) {
          final old = _profiles[i];
          _profiles[i] = Profile(
            id: old.id,
            role: old.role,
            fullName: old.fullName,
            blocked: old.blocked,
            // Carried through: rebuilding without it would default the row back
            // to 'approved' and drop the waiting badge on a payment toggle.
            approvalStatus: old.approvalStatus,
            email: old.email,
            emailConfirmed: old.emailConfirmed,
            hasPaymentPermission: newValue,
            dailyLimit: old.dailyLimit,
            monthlyLimit: old.monthlyLimit,
            perTransactionLimit: old.perTransactionLimit,
            createdAt: old.createdAt,
          );
        }
      });
      _snack(newValue
          ? '${p.fullName ?? 'User'} can now make payments.'
          : '${p.fullName ?? 'User'} payment access removed.');
    } catch (e) {
      _snack('$e');
    }
  }

  Future<void> _openReportSheet(Profile p) async {
    await showSlideSheet<void>(
      context,
      builder: (_) => UserReportSheet(profile: p),
    );
  }

  Future<void> _openAddSheet() async {
    final added = await showSlideSheet<bool>(
      context,
      builder: (_) => const AddUserSheet(),
    );
    if (added == true) await _refresh();
  }

  Future<void> _openEditSheet(Profile p) async {
    final updated = await showSlideSheet<Profile>(
      context,
      builder: (_) => EditUserSheet(profile: p),
    );
    if (updated == null || !mounted) return;
    setState(() {
      final i = _profiles.indexWhere((x) => x.id == updated.id);
      if (i != -1) _profiles[i] = updated;
    });
    _snack('${updated.fullName ?? 'User'} updated.');
  }

  UserFilter _filter = UserFilter.all;
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final myId = ApiClient.instance.currentUserId;
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Users'), actions: const [SearchButton()]),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: null,
        onPressed: _openAddSheet,
        icon: const Icon(Icons.person_add_alt),
        label: const Text('Add user'),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: Builder(
          builder: (context) {
            if (_loading) {
              return const Center(child: CircularProgressIndicator());
            }
            if (_error != null) {
              return ErrorState(message: '$_error', onRetry: _refresh);
            }
            final all = _profiles;
            if (all.isEmpty) {
              return ListView(children: const [SizedBox(height: 80), Center(child: Text('No users found.'))]);
            }
            final summary = summarizeUsers(all);
            final shown = visibleUsers(all, _filter, _q);

            Widget chip(String label, UserFilter f, {int? count}) => ChoiceChip(
                  label: Text(count == null ? label : '$label $count'),
                  selected: _filter == f,
                  onSelected: (_) => setState(() => _filter = f),
                );

            return ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 88),
              children: [
                Text(
                  '${summary.total} people'
                  '${summary.needsApproval > 0 ? ' · ${summary.needsApproval} waiting to join' : ''}'
                  '${summary.blocked > 0 ? ' · ${summary.blocked} blocked' : ''}',
                  style: TextStyle(color: cs.onSurfaceVariant),
                ),
                const SizedBox(height: 12),
                TextField(
                  decoration: const InputDecoration(
                    hintText: 'Filter by name or email…',
                    prefixIcon: Icon(Icons.filter_list),
                    isDense: true,
                  ),
                  onChanged: (v) => setState(() => _q = v),
                ),
                const SizedBox(height: 8),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(children: [
                    chip('All', UserFilter.all),
                    const SizedBox(width: 8),
                    if (summary.needsApproval > 0) ...[
                      chip('To approve', UserFilter.needsApproval, count: summary.needsApproval),
                      const SizedBox(width: 8),
                    ],
                    chip('Admins', UserFilter.admins),
                    const SizedBox(width: 8),
                    chip('Stock managers', UserFilter.stockManagers),
                    const SizedBox(width: 8),
                    chip('Members', UserFilter.members),
                    const SizedBox(width: 8),
                    if (summary.blocked > 0) chip('Blocked', UserFilter.blocked, count: summary.blocked),
                  ]),
                ),
                const SizedBox(height: 8),
                if (shown.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 40),
                    child: Center(child: Text('No one matches.', style: TextStyle(color: cs.onSurfaceVariant))),
                  ),
                for (final p in shown) _userCard(context, p, isSelf: p.id == myId),
              ],
            );
          },
        ),
      ),
    );
  }

  /// One person as a card: avatar, name, role, a coloured state badge, and what
  /// they can do. Someone waiting to join gets an Approve button right on the
  /// card — it is the job an admin opens this screen for.
  Widget _userCard(BuildContext context, Profile p, {required bool isSelf}) {
    final cs = Theme.of(context).colorScheme;
    final state = stateOf(p);
    final (badge, badgeColor) = switch (state) {
      UserState.needsApproval => ('Waiting to join', StatusColors.low),
      UserState.awaitingEmail => ('Awaiting their email', cs.onSurfaceVariant),
      UserState.blocked => ('Blocked', StatusColors.out),
      UserState.active => (null, null),
    };
    return Card(
      margin: const EdgeInsets.only(top: 8),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 4, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              CircleAvatar(
                backgroundColor: cs.primaryContainer,
                foregroundColor: cs.onPrimaryContainer,
                child: Text(initialsOf(p.fullName)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(p.fullName ?? '—', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text(
                    [
                      roleLabel(p.role),
                      isSelf ? 'You' : 'Joined ${_date(p.createdAt)}',
                    ].join(' · '),
                    style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant),
                  ),
                ]),
              ),
              if (!isSelf) _menu(context, p),
            ]),
            if (badge != null || p.hasPaymentPermission)
              Padding(
                padding: const EdgeInsets.only(top: 8, right: 8),
                child: Wrap(spacing: 6, runSpacing: 4, children: [
                  if (badge != null) _Pill(badge, badgeColor!),
                  if (p.hasPaymentPermission) const _Pill('Can request payments', StatusColors.ok),
                ]),
              ),
            if (state == UserState.needsApproval && !isSelf)
              Padding(
                padding: const EdgeInsets.only(top: 8, right: 8),
                child: FilledButton.tonalIcon(
                  onPressed: () => _toggleBlock(p),
                  icon: const Icon(Icons.check, size: 18),
                  label: const Text('Approve'),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _menu(BuildContext context, Profile p) {
    return PopupMenuButton<_UserAction>(
      icon: Icon(Icons.more_vert, color: Theme.of(context).colorScheme.primary),
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      padding: EdgeInsets.zero,
      onSelected: (action) {
        switch (action) {
          case _UserAction.role:
            _openRoleSheet(p);
          case _UserAction.report:
            _openReportSheet(p);
          case _UserAction.edit:
            _openEditSheet(p);
          case _UserAction.block:
            _toggleBlock(p);
          case _UserAction.payment:
            _togglePaymentPermission(p);
          case _UserAction.delete:
            _delete(p);
        }
      },
      itemBuilder: (_) => [
        const PopupMenuItem(
          value: _UserAction.role,
          child: ListTile(leading: Icon(Icons.badge_outlined), title: Text('Change role'), contentPadding: EdgeInsets.zero),
        ),
        const PopupMenuItem(
          value: _UserAction.report,
          child: ListTile(leading: Icon(Icons.bar_chart_rounded), title: Text('View report'), contentPadding: EdgeInsets.zero),
        ),
        const PopupMenuItem(
          value: _UserAction.edit,
          child: ListTile(leading: Icon(Icons.edit_outlined), title: Text('Edit'), contentPadding: EdgeInsets.zero),
        ),
        PopupMenuItem(
          value: _UserAction.block,
          child: ListTile(
            leading: Icon(
              p.blocked ? Icons.check_circle_outline : Icons.block,
              color: p.blocked ? const Color(0xFF10B981) : const Color(0xFFF59E0B),
            ),
            title: Text(p.awaitingApproval ? 'Approve' : (p.blocked ? 'Unblock' : 'Block')),
            contentPadding: EdgeInsets.zero,
          ),
        ),
        PopupMenuItem(
          value: _UserAction.payment,
          child: ListTile(
            leading: Icon(
              p.hasPaymentPermission ? Icons.account_balance_wallet : Icons.account_balance_wallet_outlined,
              color: p.hasPaymentPermission ? const Color(0xFF10B981) : null,
            ),
            title: Text(p.hasPaymentPermission ? 'Revoke payments' : 'Grant payments'),
            contentPadding: EdgeInsets.zero,
          ),
        ),
        const PopupMenuItem(
          value: _UserAction.delete,
          child: ListTile(
            leading: Icon(Icons.delete_outline, color: Color(0xFFEF4444)),
            title: Text('Delete', style: TextStyle(color: Color(0xFFEF4444))),
            contentPadding: EdgeInsets.zero,
          ),
        ),
      ],
    );
  }
}

/// A small coloured label: a state ("Blocked") or a permission.
class _Pill extends StatelessWidget {
  const _Pill(this.text, this.color);
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(999)),
        child: Text(text, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: StatusColors.text(context, color))),
      );
}

enum _UserAction { role, report, edit, block, payment, delete }

String _date(DateTime? dt) {
  if (dt == null) return '—';
  final d = dt.toLocal();
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}
