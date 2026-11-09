import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/models.dart';
import 'package:inventory_mobile/users_logic.dart';

Profile p(String id, String name,
        {String role = 'member', bool blocked = false, String approval = 'approved', bool? emailOk, String? email}) =>
    Profile(id: id, role: role, fullName: name, blocked: blocked, approvalStatus: approval, emailConfirmed: emailOk, email: email);

void main() {
  final people = [
    p('1', 'Zed'),
    p('2', 'Amina', role: 'admin', email: 'amina@verlet.co'),
    p('3', 'Brian', blocked: true),
    p('4', 'Chloé', approval: 'pending', blocked: true, emailOk: true),
    p('5', 'Dan', approval: 'pending', blocked: true, emailOk: false),
    p('6', 'Eve', role: 'stock_manager'),
  ];

  test('stateOf tells apart waiting-on-admin, waiting-on-their-email, blocked and active', () {
    expect(stateOf(people[3]), UserState.needsApproval);
    expect(stateOf(people[4]), UserState.awaitingEmail);
    expect(stateOf(people[2]), UserState.blocked);
    expect(stateOf(people[0]), UserState.active);
  });

  test('the order is: waiting for approval, waiting on email, active A-Z, blocked', () {
    expect(visibleUsers(people, UserFilter.all, '').map((x) => x.fullName), ['Chloé', 'Dan', 'Amina', 'Eve', 'Zed', 'Brian']);
  });

  test('filters by what the admin is looking for', () {
    expect(visibleUsers(people, UserFilter.needsApproval, '').map((x) => x.id), ['4', '5']);
    expect(visibleUsers(people, UserFilter.blocked, '').map((x) => x.id), ['3']); // a pending person is not "blocked"
    expect(visibleUsers(people, UserFilter.admins, '').map((x) => x.id), ['2']);
    expect(visibleUsers(people, UserFilter.stockManagers, '').map((x) => x.id), ['6']);
    expect(visibleUsers(people, UserFilter.members, '').map((x) => x.id), ['4', '5', '1', '3']);
  });

  test('searches name or email, ignoring case, together with a filter', () {
    expect(visibleUsers(people, UserFilter.all, 'AMINA').map((x) => x.id), ['2']);
    expect(visibleUsers(people, UserFilter.all, 'verlet.co').map((x) => x.id), ['2']);
    expect(visibleUsers(people, UserFilter.blocked, 'amina'), isEmpty);
  });

  test('summarizeUsers counts everyone, those to approve, and those blocked', () {
    final s = summarizeUsers(people);
    expect((s.total, s.needsApproval, s.blocked), (6, 2, 1));
  });

  test('initialsOf', () {
    expect(initialsOf('Amina Uwase'), 'AU');
    expect(initialsOf('  amina '), 'A');
    expect(initialsOf('Jean Paul Habimana'), 'JH');
    expect(initialsOf(null), '?');
    expect(initialsOf('   '), '?');
  });
}
