import 'package:flutter/material.dart';

import '../../activity_feed.dart';
import '../../models.dart';
import '../../repository.dart';
import '../../widgets/error_state.dart';
import '../items/item_detail_screen.dart';

/// Who took, returned or damaged what, over the last 30 days, newest first.
/// Pull down to refresh. Read from the activity report, so it needs nothing new
/// on the server.
class RecentActivityView extends StatefulWidget {
  const RecentActivityView({super.key});

  @override
  State<RecentActivityView> createState() => _RecentActivityViewState();
}

class _RecentActivityViewState extends State<RecentActivityView> {
  final _repo = const InventoryRepository();
  late Future<ActivityReport> _future = _load();

  Future<ActivityReport> _load() => _repo.fetchActivityReport(ReportFilters(
        from: DateTime.now().subtract(const Duration(days: 30)),
        reasons: feedReasons,
        limit: 300,
      ));

  Future<void> _refresh() async {
    final next = _load();
    setState(() {
      _future = next;
    });
    await next.catchError((_) => ActivityReport(count: 0, rows: [], byReason: [], byPerson: [], byItem: []));
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return FutureBuilder<ActivityReport>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snap.hasError && !snap.hasData) {
          return ErrorState(message: '${snap.error}', onRetry: _refresh);
        }
        final days = groupFeed(snap.data?.rows ?? const []);
        return RefreshIndicator(
          onRefresh: _refresh,
          child: days.isEmpty
              ? ListView(physics: const AlwaysScrollableScrollPhysics(), children: [
                  const SizedBox(height: 120),
                  Center(child: Text('Nothing taken or returned in the last 30 days.', style: TextStyle(color: cs.onSurfaceVariant))),
                ])
              : ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                  children: [
                    for (final d in days) ...[
                      Padding(
                        padding: const EdgeInsets.fromLTRB(0, 16, 0, 4),
                        child: Text(d.label.toUpperCase(),
                            style: TextStyle(fontSize: 11, letterSpacing: 0.6, fontWeight: FontWeight.w600, color: cs.onSurfaceVariant)),
                      ),
                      Card(
                        margin: EdgeInsets.zero,
                        clipBehavior: Clip.antiAlias,
                        child: Column(children: [
                          for (var i = 0; i < d.rows.length; i++) ...[
                            if (i > 0) const Divider(height: 1),
                            _FeedTile(row: d.rows[i]),
                          ],
                        ]),
                      ),
                    ],
                  ],
                ),
        );
      },
    );
  }
}

class _FeedTile extends StatelessWidget {
  const _FeedTile({required this.row});
  final ReportRow row;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final (icon, color) = switch (row.reason) {
      'take' => (Icons.north_east, cs.primary),
      'return' => (Icons.south_west, const Color(0xFF15803D)),
      _ => (Icons.warning_amber_rounded, cs.error),
    };
    return ListTile(
      dense: true,
      leading: Icon(icon, color: color, size: 20),
      title: Text(feedSentence(row), maxLines: 3, overflow: TextOverflow.ellipsis),
      subtitle: Text('${row.locationName} · ${feedTime(row.createdAt)}', maxLines: 2, overflow: TextOverflow.ellipsis),
      onTap: row.itemId.isEmpty
          ? null
          : () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ItemDetailScreen(itemId: row.itemId))),
    );
  }
}
