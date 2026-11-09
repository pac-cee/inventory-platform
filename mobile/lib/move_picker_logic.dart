import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import 'models.dart';
import 'search_logic.dart';

/// The pure rules behind the "move stock" destination picker, kept apart from
/// the widget so they can be tested without a screen.
///
/// A place's bare name is not enough to choose it by ("Shelf 2" and "Level 1"
/// repeat all over the store), so everything here works from the FULL PATH:
/// `Store › Shelf 2 › Level 1 › Box 4`.

const pathSeparator = ' › ';

/// The full path of [l], root first. Safe against a loop in bad data.
String locationPath(Location l, Map<String, Location> byId) {
  final parts = <String>[];
  final seen = <String>{};
  Location? cur = l;
  while (cur != null && seen.add(cur.id)) {
    parts.add(cur.name);
    cur = cur.parentId == null ? null : byId[cur.parentId];
  }
  return parts.reversed.join(pathSeparator);
}

/// Where [l] sits, without its own name: `Store › Shelf 2 › Level 1` (empty at the top).
String parentPath(Location l, Map<String, Location> byId) {
  final p = l.parentId == null ? null : byId[l.parentId];
  return p == null ? '' : locationPath(p, byId);
}

/// A box reads as its purpose ("USB-A to C cables") when it has one.
String displayName(Location l) =>
    l.isBox && (l.label?.trim().isNotEmpty ?? false) ? l.label!.trim() : l.name;

/// The places directly under [parentId] (null = the top level), in name order.
List<Location> childrenOf(List<Location> all, String? parentId) {
  final kids = all.where((l) => l.parentId == parentId).toList()
    ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
  return kids;
}

/// How many boxes sit anywhere below [id] (for "12 boxes" on a drill-down row).
int boxesBelow(List<Location> all, String id) {
  final kids = <String, List<Location>>{};
  for (final l in all) {
    final p = l.parentId;
    if (p != null) kids.putIfAbsent(p, () => []).add(l);
  }
  var count = 0;
  final stack = [id];
  final seen = <String>{id};
  while (stack.isNotEmpty) {
    for (final c in kids[stack.removeLast()] ?? const <Location>[]) {
      if (!seen.add(c.id)) continue;
      if (c.isBox) count++;
      stack.add(c.id);
    }
  }
  return count;
}

/// Boxes first (moving into a container is the main job), each group by path.
List<Location> boxesFirst(List<Location> places, Map<String, Location> byId) {
  final boxes = places.where((l) => l.isBox).toList();
  boxes.sort((a, b) => locationPath(a, byId).toLowerCase().compareTo(locationPath(b, byId).toLowerCase()));
  return boxes;
}

/// Destinations matching [query], best first. Every word of the query must
/// appear somewhere in the full path (or the box's purpose), so "shelf 2 box 4"
/// finds `Store › Shelf 2 › Level 1 › Box 4`. Boxes outrank other places, then
/// a name hit outranks a path-only hit, then shorter paths.
List<Location> searchDestinations(
  List<Location> destinations,
  Map<String, Location> byId,
  String query, {
  int limit = 30,
}) {
  final words = query.toLowerCase().split(RegExp(r'[\s›>/]+')).where((w) => w.isNotEmpty).toList();
  if (words.isEmpty) return const [];
  final scored = <({Location loc, int score, int len})>[];
  for (final l in destinations) {
    final path = locationPath(l, byId);
    final hay = '${path.toLowerCase()} ${(l.label ?? '').toLowerCase()}';
    if (!words.every(hay.contains)) continue;
    var score = l.isBox ? 0 : 10;
    final nameHit = matchScore(query, l.name) ?? matchScore(query, l.label);
    score += nameHit ?? 5;
    scored.add((loc: l, score: score, len: path.length));
  }
  scored.sort((a, b) {
    final c = a.score.compareTo(b.score);
    return c != 0 ? c : a.len.compareTo(b.len);
  });
  return [for (final s in scored.take(limit)) s.loc];
}

/// The last few places stock was moved to ON THIS DEVICE, newest first.
/// A small JSON file, like the payment draft: losing it only loses a shortcut.
class RecentDestinations {
  static const maxKept = 5;

  @visibleForTesting
  static String? directoryOverride;

  static File get _file => File('${directoryOverride ?? Directory.systemTemp.path}/verlet_recent_destinations.json');

  /// [id] pushed to the front of [current], no duplicates, capped.
  static List<String> pushed(List<String> current, String id) =>
      [id, ...current.where((x) => x != id)].take(maxKept).toList();

  static Future<List<String>> load() async {
    try {
      final f = _file;
      if (!await f.exists()) return const [];
      final raw = jsonDecode(await f.readAsString());
      return raw is List ? raw.whereType<String>().toList() : const [];
    } catch (e) {
      debugPrint('[RecentDestinations] load failed: $e');
      return const [];
    }
  }

  static Future<void> remember(String id) async {
    try {
      await _file.writeAsString(jsonEncode(pushed(await load(), id)), flush: true);
    } catch (e) {
      debugPrint('[RecentDestinations] save failed: $e');
    }
  }
}
