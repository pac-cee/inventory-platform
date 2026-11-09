/// Turning the two dates on the Reserve form into the window the API stores.
/// Same rules as the web app's lib/reserve-window.ts: "from today" starts now
/// (so the units are held straight away), a later start is the beginning of that
/// day, and the last day runs to 23:59. The API stays the authority on limits.
const maxStartDays = 30;
const maxLengthDays = 14;

({String? startsAt, String? endsAt, String? error}) reserveWindow(
  DateTime? from,
  DateTime? to, {
  DateTime? now,
}) {
  final n = now ?? DateTime.now();
  if (from == null || to == null) return (startsAt: null, endsAt: null, error: 'Pick both dates.');

  final today = DateTime(n.year, n.month, n.day);
  final first = DateTime(from.year, from.month, from.day);
  final last = DateTime(to.year, to.month, to.day);
  if (first.isBefore(today)) return (startsAt: null, endsAt: null, error: 'The first day cannot be in the past.');
  if (last.isBefore(first)) return (startsAt: null, endsAt: null, error: 'The last day cannot be before the first day.');

  final starts = first == today ? n : first;
  final ends = DateTime(last.year, last.month, last.day, 23, 59);
  if (starts.isAfter(n.add(const Duration(days: maxStartDays)))) {
    return (startsAt: null, endsAt: null, error: 'You can reserve at most $maxStartDays days ahead.');
  }
  if (ends.difference(starts) > const Duration(days: maxLengthDays)) {
    return (startsAt: null, endsAt: null, error: 'A reservation can last at most $maxLengthDays days.');
  }
  return (startsAt: starts.toUtc().toIso8601String(), endsAt: ends.toUtc().toIso8601String(), error: null);
}
