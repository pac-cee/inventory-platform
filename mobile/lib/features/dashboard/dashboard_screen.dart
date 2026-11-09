import 'package:flutter/material.dart';

import '../../models.dart';
import '../items/item_detail_screen.dart';
import '../../repository.dart';
import '../../widgets.dart';
import '../items/items_admin_screen.dart';
import '../items/low_stock_screen.dart';
import '../../catalog_logic.dart';
import '../../equipment_audit.dart';
import '../../config/theme.dart';
import '../../widgets/item_stock_tile.dart';
import '../locations/location_detail_screen.dart';
import '../locations/location_photo.dart';
import '../scan/scan_screen.dart';
import '../../config/api_client.dart';
import '../../widgets/search_button.dart';
import '../equipment/equipment_screen.dart';
import '../../widgets/error_state.dart';

class _Data {
  _Data(this.items, this.stock, this.locations, this.loans, this.allLoans);
  final List<Item> items;
  final List<StockLevel> stock;
  final List<Location> locations;

  /// The signed-in person's loans (empty if the lookup failed — Home must still load).
  final List<Loan> loans;

  /// Everyone's loans, for managers (empty for others, or if the lookup failed).
  final List<Loan> allLoans;
}

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final _repo = const InventoryRepository();
  late Future<_Data> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_Data> _load() async {
    final results = await Future.wait([
      _repo.fetchItems(),
      _repo.fetchStock(),
      _repo.fetchLocations(),
      _repo.fetchMyLoans().catchError((_) => <Loan>[]),
      ApiClient.instance.canManageInventory
          ? _repo.fetchAllLoans().catchError((_) => <Loan>[])
          : Future.value(<Loan>[]),
    ]);
    return _Data(
      results[0] as List<Item>,
      results[1] as List<StockLevel>,
      results[2] as List<Location>,
      results[3] as List<Loan>,
      results[4] as List<Loan>,
    );
  }

  Future<void> _refresh() async {
    final f = _load();
    setState(() {
      _future = f;
    });
    await f;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        actions: [
          const SearchButton(),
          if (ApiClient.instance.canManageInventory)
            IconButton(
              tooltip: 'Borrowed equipment',
              icon: const Icon(Icons.assignment_ind_outlined),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const EquipmentScreen()),
              ),
            ),
          IconButton(
            tooltip: 'Scan item or box QR',
            icon: const Icon(Icons.qr_code_scanner),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const ScanScreen()),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<_Data>(
          future: _future,
          builder: (context, snap) {
            // Keep showing the previous data while a refresh is in flight —
            // FutureBuilder retains it, so the spinner is only for the first load.
            // (Otherwise every Take/Return/pull-to-refresh blanked the page and
            // threw away the scroll position.)
            if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              return ErrorState(message: '${snap.error}', onRetry: _refresh);
            }
            final data = snap.data!;
            return _DashboardBody(data: data);
          },
        ),
      ),
    );
  }
}

class _DashboardBody extends StatelessWidget {
  const _DashboardBody({required this.data});

  final _Data data;

  @override
  Widget build(BuildContext context) {
    final byItem = <String, int>{};
    final byLocation = <String, int>{};
    for (final s in data.stock) {
      byItem[s.itemId] = (byItem[s.itemId] ?? 0) + s.quantity;
      byLocation[s.locationId] = (byLocation[s.locationId] ?? 0) + s.quantity;
    }

    final totalUnits = data.stock.fold<int>(0, (sum, s) => sum + s.quantity);
    final low = lowStockRows(data.items, byItem);
    final outCount = low.where((r) => r.status == StockStatus.out).length;
    final tone = restockTone(low);
    final locations = topLevelSummaries(data.locations, byLocation);
    final canManage = ApiClient.instance.canManageInventory;

    void openLowStock() => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => LowStockScreen(rows: low)),
        );

    return ListView(
      padding: const EdgeInsets.all(16),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        _LoansDueCard(loans: loansNeedingAttention(data.loans)),
        StatGrid(
          children: [
            StatCard(label: 'Items', value: '${data.items.length}', icon: Icons.widgets_outlined),
            StatCard(label: 'Units in stock', value: '$totalUnits', icon: Icons.inventory_2_outlined),
            StatCard(label: 'Locations', value: '${locations.length}', icon: Icons.warehouse_outlined),
            // Tinted red when something is out, amber when only low: the one tile
            // that should catch the eye.
            StatCard(
              label: 'Needs restock',
              value: '${low.length}',
              icon: Icons.warning_amber_outlined,
              caption: low.isEmpty ? 'All stocked' : '$outCount out · ${low.length - outCount} low',
              tone: tone == StockStatus.out
                  ? StatusColors.out
                  : (tone == StockStatus.low ? StatusColors.low : null),
              onTap: low.isEmpty ? null : openLowStock,
            ),
          ],
        ),
        const SizedBox(height: 16),

        _RestockCard(rows: low, outCount: outCount, tone: tone, onViewAll: openLowStock),
        if (canManage) ...[
          const SizedBox(height: 12),
          _OnLoanCard(loans: data.allLoans),
        ],
        const SizedBox(height: 20),

        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('Storage locations', style: TextStyle(fontWeight: FontWeight.w600)),
            if (locations.length > 2)
              Text('${locations.length} places',
                  style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
          ],
        ),
        const SizedBox(height: 8),
        if (locations.isEmpty)
          const _Empty(text: 'No locations yet.')
        else
          SizedBox(
            height: 112,
            // Swipe sideways through the places; each opens that place's contents.
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: locations.length,
              separatorBuilder: (_, __) => const SizedBox(width: 12),
              itemBuilder: (_, i) => _LocationCard(summary: locations[i]),
            ),
          ),
        const SizedBox(height: 20),

        // Members have no Items tab, so this is how everyone gets to the full
        // catalog: by category, not one long list.
        FilledButton.tonalIcon(
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => ItemsAdminScreen(readOnly: !canManage)),
          ),
          icon: const Icon(Icons.category_outlined),
          label: const Text('Browse items by category'),
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
        ),
      ],
    );
  }
}

/// The restock list as one full-width card. Its colour follows the worst status:
/// red when anything is out, amber when only low, green when all is well. Shows
/// the top few, most urgent first; "View all" opens the whole scrollable list.
class _RestockCard extends StatelessWidget {
  const _RestockCard({required this.rows, required this.outCount, required this.tone, required this.onViewAll});

  final List<StockRow> rows;
  final int outCount;
  final StockStatus tone;
  final VoidCallback onViewAll;

  static const _preview = 5;

  @override
  Widget build(BuildContext context) {
    final color = switch (tone) {
      StockStatus.out => StatusColors.out,
      StockStatus.low => StatusColors.low,
      StockStatus.ok => StatusColors.ok,
    };
    final text = StatusColors.text(context, color);
    final lowCount = rows.length - outCount;

    return Card(
      color: color.withValues(alpha: 0.08),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: color.withValues(alpha: 0.45)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
            child: Row(children: [
              Icon(rows.isEmpty ? Icons.check_circle_outline : Icons.warning_amber_rounded, color: text),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  rows.isEmpty ? 'Everything is well stocked' : 'Needs restock (${rows.length})',
                  style: TextStyle(fontWeight: FontWeight.w700, color: text),
                ),
              ),
              if (outCount > 0) _CountBadge('$outCount out', StatusColors.out),
              if (outCount > 0 && lowCount > 0) const SizedBox(width: 6),
              if (lowCount > 0) _CountBadge('$lowCount low', StatusColors.low),
            ]),
          ),
          if (rows.isNotEmpty) ...[
            const Divider(height: 1),
            for (final r in rows.take(_preview)) ItemStockTile(item: r.item, quantity: r.quantity),
            const Divider(height: 1),
            TextButton.icon(
              onPressed: onViewAll,
              icon: const Icon(Icons.arrow_forward, size: 18),
              label: Text(rows.length > _preview ? 'View all ${rows.length} items' : 'Open full list'),
              style: TextButton.styleFrom(minimumSize: const Size.fromHeight(48), foregroundColor: text),
            ),
          ],
        ],
      ),
    );
  }
}

/// Managers: how much equipment is out and how much of it is late. Red when
/// anything is overdue; opens the Borrowed equipment page.
class _OnLoanCard extends StatelessWidget {
  const _OnLoanCard({required this.loans});
  final List<Loan> loans;

  @override
  Widget build(BuildContext context) {
    final t = summarize(loans);
    final cs = Theme.of(context).colorScheme;
    final late = t.overdue > 0;
    final color = late ? StatusColors.out : null;
    final text = color == null ? cs.onSurface : StatusColors.text(context, color);
    return Card(
      color: color?.withValues(alpha: 0.08),
      shape: color == null
          ? null
          : RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: BorderSide(color: color.withValues(alpha: 0.45)),
            ),
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        leading: Icon(Icons.assignment_ind_outlined, color: text),
        title: Text('Out on loan', style: TextStyle(fontWeight: FontWeight.w600, color: text)),
        subtitle: Text(
          loans.isEmpty
              ? 'Nothing is out on loan'
              : '${t.units} unit${t.units == 1 ? '' : 's'} with ${t.people} ${t.people == 1 ? 'person' : 'people'}'
                  '${late ? ' · ${t.overdue} overdue' : ''}',
        ),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const EquipmentScreen())),
      ),
    );
  }
}

class _CountBadge extends StatelessWidget {
  const _CountBadge(this.text, this.color);
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(999)),
        child: Text(text,
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: StatusColors.text(context, color))),
      );
}

/// One top-level place: its name, units (including everything nested inside it)
/// and how many sub-locations it has.
class _LocationCard extends StatelessWidget {
  const _LocationCard({required this.summary});
  final LocationSummary summary;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final loc = summary.location;
    final sub = subLocationText(summary.subLocations);
    return SizedBox(
      width: 168,
      child: Card(
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => LocationDetailScreen(locationId: loc.id)),
          ),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                loc.hasAnyPhoto
                    ? LocationThumb(location: loc, size: 36)
                    : Icon(loc.isBox ? Icons.inventory_2_outlined : Icons.warehouse_outlined, color: cs.onSurfaceVariant),
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(loc.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text(
                    [if (summary.units > 0 || sub.isEmpty) '${summary.units} units', if (sub.isNotEmpty) sub].join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant),
                  ),
                ]),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
      child: Center(
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ),
    );
  }
}

/// "Equipment to bring back": what you have out that is late, due today or due
/// tomorrow. Not shown at all when there is nothing to bring back.
class _LoansDueCard extends StatelessWidget {
  const _LoansDueCard({required this.loans});
  final List<Loan> loans;

  @override
  Widget build(BuildContext context) {
    if (loans.isEmpty) return const SizedBox.shrink();
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: SectionCard(
        title: 'Equipment to bring back',
        child: Column(
          children: [
            for (final l in loans)
              ListTile(
                dense: true,
                leading: Icon(
                  l.isOverdue ? Icons.warning_amber_rounded : Icons.schedule,
                  color: l.isOverdue ? cs.error : cs.onSurfaceVariant,
                ),
                title: Text('${l.quantity} × ${l.itemName}', maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text(
                  l.dueText,
                  style: TextStyle(
                    color: l.isOverdue ? cs.error : null,
                    fontWeight: l.isOverdue ? FontWeight.w600 : null,
                  ),
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => ItemDetailScreen(itemId: l.itemId)),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
