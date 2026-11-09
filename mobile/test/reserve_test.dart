import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/models.dart';
import 'package:inventory_mobile/reserve_window.dart';

void main() {
  // Wednesday 21 Oct 2026, 10:00 (local).
  final now = DateTime(2026, 10, 21, 10);

  group('reserveWindow', () {
    test('"from today" starts right now, so the units are held straight away', () {
      final w = reserveWindow(DateTime(2026, 10, 21), DateTime(2026, 10, 23), now: now);
      expect(w.error, isNull);
      expect(DateTime.parse(w.startsAt!).toLocal(), now);
    });

    test('a later start is the beginning of that day; the last day runs to 23:59', () {
      final w = reserveWindow(DateTime(2026, 10, 25), DateTime(2026, 10, 27), now: now);
      final s = DateTime.parse(w.startsAt!).toLocal();
      final e = DateTime.parse(w.endsAt!).toLocal();
      expect([s.day, s.hour, s.minute], [25, 0, 0]);
      expect([e.day, e.hour, e.minute], [27, 23, 59]);
    });

    test('needs both dates', () {
      expect(reserveWindow(null, DateTime(2026, 10, 25), now: now).error, contains('both'));
      expect(reserveWindow(DateTime(2026, 10, 25), null, now: now).error, contains('both'));
    });

    test('refuses the past, and a last day before the first', () {
      expect(reserveWindow(DateTime(2026, 10, 20), DateTime(2026, 10, 22), now: now).error, contains('past'));
      expect(reserveWindow(DateTime(2026, 10, 25), DateTime(2026, 10, 24), now: now).error, contains('before'));
    });

    test('refuses starting too far ahead and lasting too long; 14 days is fine', () {
      expect(reserveWindow(DateTime(2026, 12, 30), DateTime(2026, 12, 31), now: now).error, contains('30 days ahead'));
      expect(reserveWindow(DateTime(2026, 10, 22), DateTime(2026, 11, 8), now: now).error, contains('14 days'));
      expect(reserveWindow(DateTime(2026, 10, 22), DateTime(2026, 11, 4), now: now).error, isNull);
    });
  });

  group('Reservation', () {
    Reservation make(String state, {String? start, String? end}) => Reservation.fromJson({
          'id': 'r1',
          'item_id': 'i',
          'location_id': 'l',
          'location_name': 'Box 4',
          'user_id': 'u',
          'user_name': 'Tony',
          'requested_by': 'm',
          'requested_by_name': 'Robert',
          'quantity': 3,
          'starts_at': start ?? '2026-11-12T08:00:00Z',
          'ends_at': end ?? '2026-11-14T21:59:00Z',
          'state': state,
        });

    test('reads the API row', () {
      final r = make('upcoming');
      expect([r.quantity, r.locationName, r.userName, r.requestedByName], [3, 'Box 4', 'Tony', 'Robert']);
    });

    test('only upcoming and active reservations can be cancelled', () {
      expect(make('upcoming').isStanding, isTrue);
      expect(make('active').isStanding, isTrue);
      for (final s in ['expired', 'fulfilled', 'cancelled']) {
        expect(make(s).isStanding, isFalse, reason: s);
      }
    });

    test('shows the window in Kigali time, as a range or a single day', () {
      expect(make('upcoming').windowText, '12 Nov – 14 Nov');
      expect(make('upcoming', start: '2026-11-12T08:00:00Z', end: '2026-11-12T20:00:00Z').windowText, '12 Nov');
      // 22:00 UTC on the 12th is already the 13th in Kigali.
      expect(make('upcoming', start: '2026-11-12T22:00:00Z', end: '2026-11-13T22:00:00Z').windowText, '13 Nov – 14 Nov');
    });

    test('names each state in plain words', () {
      expect(make('active').stateText, 'Holding now');
      expect(make('upcoming').stateText, 'Upcoming');
      expect(make('expired').stateText, 'Not collected');
      expect(make('fulfilled').stateText, 'Collected');
      expect(make('cancelled').stateText, 'Cancelled');
    });
  });
}
