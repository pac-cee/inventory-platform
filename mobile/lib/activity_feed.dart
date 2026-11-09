import 'models.dart';

/// "Who took what, recently": turns activity-report rows into a day-by-day feed.
/// Pure, so the wording and the grouping can be tested directly.

/// The activity types worth a feed: stock going out, coming back, or damaged.
const feedReasons = ['take', 'return', 'destroyed'];

/// "Cable · USB-A to C · 1m": type, then the name if it says more, then the model.
String feedItemLabel(ReportRow r) {
  final parts = <String>[r.itemType];
  if (r.itemName.isNotEmpty && r.itemName != '—' && r.itemName != r.itemType) parts.add(r.itemName);
  if (r.itemModel.isNotEmpty && r.itemModel != 'Unspecified') parts.add(r.itemModel);
  return parts.join(' · ');
}

/// One line: "Amina took 2 × Cable · USB-A to C". When someone recorded it for
/// them, that is said too: "… (recorded by Brian)".
String feedSentence(ReportRow r) {
  final who = (r.personName?.trim().isNotEmpty ?? false) ? r.personName!.trim() : 'Someone';
  final item = feedItemLabel(r);
  final n = r.units;
  final core = switch (r.reason) {
    'take' => '$who took $n × $item',
    'return' => '$who returned $n × $item',
    'destroyed' => '$n × $item damaged (${who == 'Someone' ? 'unattributed' : who})',
    _ => '${r.label.isEmpty ? r.reason : r.label} · $item',
  };
  final actor = r.actorName?.trim();
  final byOther = actor != null && actor.isNotEmpty && r.actorId != null && r.actorId != r.personId;
  return byOther ? '$core (recorded by $actor)' : core;
}

/// Kigali is UTC+2 all year, whatever the phone's own zone says.
DateTime _kigali(DateTime t) => t.toUtc().add(const Duration(hours: 2));

/// "10:42" in Kigali time.
String feedTime(DateTime t) {
  final k = _kigali(t);
  return '${k.hour.toString().padLeft(2, '0')}:${k.minute.toString().padLeft(2, '0')}';
}

class FeedDay {
  FeedDay(this.label);
  final String label;
  final List<ReportRow> rows = [];
}

const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// Newest first, grouped by Kigali calendar day: "Today", "Yesterday", "Mon 27 Oct".
/// Rows that were undone are left out (they did not happen).
List<FeedDay> groupFeed(List<ReportRow> rows, {DateTime? now}) {
  final today = _kigali(now ?? DateTime.now());
  int dayNo(DateTime k) => DateTime.utc(k.year, k.month, k.day).millisecondsSinceEpoch ~/ 86400000;
  final todayNo = dayNo(today);

  final sorted = rows.where((r) => !r.reversed).toList()..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  final days = <FeedDay>[];
  int? current;
  for (final r in sorted) {
    final k = _kigali(r.createdAt);
    final no = dayNo(k);
    if (no != current) {
      final label = no == todayNo
          ? 'Today'
          : no == todayNo - 1
              ? 'Yesterday'
              : '${_weekdays[k.weekday - 1]} ${k.day} ${_months[k.month - 1]}';
      days.add(FeedDay(label));
      current = no;
    }
    days.last.rows.add(r);
  }
  return days;
}
