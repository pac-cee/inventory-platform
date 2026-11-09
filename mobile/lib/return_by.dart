/// "How long will you use it?" — turning the choice on the Take card into the
/// date the API stores. A date means the END of that day (23:59 local): "back by
/// Friday" is fine at any time on Friday, and a loan is not overdue until the
/// day is over. Same rules as the web app's lib/return-by.ts.
enum ReturnBy { none, today, tomorrow, week, month, custom }

const returnByLabels = <ReturnBy, String>{
  ReturnBy.none: 'No fixed date',
  ReturnBy.today: 'Today',
  ReturnBy.tomorrow: 'Tomorrow',
  ReturnBy.week: 'In 1 week',
  ReturnBy.month: 'In 1 month',
  ReturnBy.custom: 'Pick a date…',
};

DateTime _endOfDay(int y, int m, int d) => DateTime(y, m, d, 23, 59);

/// The ISO timestamp to send, or an error to show. `iso` is null for "no fixed date".
({String? iso, String? error}) returnByIso(
  ReturnBy choice, {
  DateTime? custom,
  DateTime? now,
}) {
  final n = now ?? DateTime.now();
  if (choice == ReturnBy.none) return (iso: null, error: null);

  final DateTime when;
  switch (choice) {
    case ReturnBy.today:
      when = _endOfDay(n.year, n.month, n.day);
    case ReturnBy.tomorrow:
      when = _endOfDay(n.year, n.month, n.day + 1);
    case ReturnBy.week:
      when = _endOfDay(n.year, n.month, n.day + 7);
    case ReturnBy.month:
      when = _endOfDay(n.year, n.month + 1, n.day);
    case ReturnBy.custom:
      if (custom == null) return (iso: null, error: 'Pick the date you will bring it back.');
      when = _endOfDay(custom.year, custom.month, custom.day);
    case ReturnBy.none:
      return (iso: null, error: null);
  }
  if (!when.isAfter(n)) return (iso: null, error: 'That date has already passed.');
  return (iso: when.toUtc().toIso8601String(), error: null);
}
