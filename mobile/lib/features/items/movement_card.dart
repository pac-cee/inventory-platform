import 'package:flutter/material.dart';

import '../../config/theme.dart';
import '../../models.dart';
import '../../return_by.dart';
import '../../widgets.dart';

class MovementCard extends StatelessWidget {
  const MovementCard({
    super.key,
    required this.locations,
    required this.stock,
    required this.selectedLocationId,
    required this.quantity,
    required this.working,
    required this.finishable,
    required this.onLocationChanged,
    required this.onQuantityChanged,
    required this.onTake,
    required this.onReturn,
    required this.onFinish,
    required this.onDestroy,
    required this.onLost,
    required this.onRepair,
    this.isAdmin = false,
    this.returnBy = ReturnBy.none,
    this.returnDate,
    required this.onReturnByChanged,
    required this.onPickReturnDate,
    this.behalfPeople = const [],
    this.forPersonId,
    this.onForPersonChanged,
  });

  final List<Location> locations;

  /// This item's stock rows — the only places it can be moved from or to.
  final List<StockLevel> stock;
  final String? selectedLocationId;
  final int quantity;
  final bool working;
  final bool finishable;
  final ValueChanged<String?> onLocationChanged;
  final ValueChanged<int> onQuantityChanged;
  final VoidCallback onTake;
  final VoidCallback onReturn;
  final VoidCallback onFinish;
  final VoidCallback onDestroy;
  final VoidCallback onLost;
  final VoidCallback onRepair;
  final bool isAdmin;

  /// How long the person will use it; sent with a Take so the app knows when it
  /// is due back.
  final ReturnBy returnBy;
  final DateTime? returnDate;
  final ValueChanged<ReturnBy> onReturnByChanged;
  final VoidCallback onPickReturnDate;

  /// Managers: people a take/return can be recorded for (empty hides the picker).
  /// `quantity` is how many of this item they hold now.
  final List<Holder> behalfPeople;

  /// Who it is being recorded for; null = the signed-in person.
  final String? forPersonId;
  final ValueChanged<String?>? onForPersonChanged;

  @override
  Widget build(BuildContext context) {
    // Only where THIS item is registered — moving it somewhere it was never
    // stocked isn't a real operation, and the API refuses it for non-admins.
    // This also covers a parent room that holds the item directly: it isn't a
    // leaf, so a leaf-only list used to hide it entirely.
    final byId = {for (final l in locations) l.id: l};
    final places = stock.where((s) => byId.containsKey(s.locationId)).toList()
      ..sort((a, b) => b.quantity.compareTo(a.quantity));
    String labelFor(Location loc) {
      final parts = <String>[];
      final seen = <String>{};
      Location? cur = loc;
      while (cur != null && !seen.contains(cur.id)) {
        seen.add(cur.id);
        parts.insert(0, cur.name);
        cur = cur.parentId != null ? byId[cur.parentId] : null;
      }
      return parts.join(' › ');
    }
    // Default to wherever most of it is — usually the one you mean.
    final selValue = places.any((s) => s.locationId == selectedLocationId)
        ? selectedLocationId
        : (places.isNotEmpty ? places.first.locationId : null);

    return SectionCard(
      title: 'Move stock',
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: places.isEmpty
            ? Text(isAdmin
                ? "This item isn't stocked anywhere yet — add it to a location first."
                : "This item isn't stocked at any location yet. Ask an admin to add it to one.")
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  DropdownButtonFormField<String>(
                    // Without isExpanded a long "Room › Shelf › Bin · 12" path
                    // overflows the field instead of ellipsising.
                    isExpanded: true,
                    initialValue: selValue,
                    decoration:
                        const InputDecoration(labelText: 'Location'),
                    items: [
                      for (final s in places)
                        DropdownMenuItem(
                          value: s.locationId,
                          child: Text(
                            '${labelFor(byId[s.locationId]!)} · ${s.quantity}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                    onChanged: onLocationChanged,
                  ),
                  const SizedBox(height: 12),
                  _QuantityStepper(
                    quantity: quantity,
                    enabled: !working,
                    onChanged: onQuantityChanged,
                  ),
                  if (isAdmin && behalfPeople.isNotEmpty && onForPersonChanged != null) ...[
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String?>(
                      isExpanded: true,
                      initialValue: forPersonId,
                      decoration: const InputDecoration(
                        labelText: 'Record for',
                        helperText: 'For someone who cannot do it themselves. For a return, pick someone who holds this.',
                      ),
                      items: [
                        const DropdownMenuItem<String?>(value: null, child: Text('Me')),
                        for (final p in behalfPeople)
                          DropdownMenuItem<String?>(
                            value: p.userId,
                            child: Text(
                              '${p.fullName.isEmpty ? 'Unknown' : p.fullName}${p.quantity > 0 ? ' · holds ${p.quantity}' : ''}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                      onChanged: working ? null : onForPersonChanged,
                    ),
                  ],
                  const SizedBox(height: 12),
                  DropdownButtonFormField<ReturnBy>(
                    isExpanded: true,
                    initialValue: returnBy,
                    decoration: const InputDecoration(
                      labelText: 'Return by',
                      helperText: 'Used when you tap Take',
                    ),
                    items: [
                      for (final e in returnByLabels.entries)
                        DropdownMenuItem(value: e.key, child: Text(e.value)),
                    ],
                    onChanged: working
                        ? null
                        : (v) {
                            if (v == null) return;
                            onReturnByChanged(v);
                            if (v == ReturnBy.custom) onPickReturnDate();
                          },
                  ),
                  if (returnBy == ReturnBy.custom)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: working ? null : onPickReturnDate,
                        icon: const Icon(Icons.event_outlined),
                        label: Text(returnDate == null
                            ? 'Choose a date'
                            : '${returnDate!.year}-${returnDate!.month.toString().padLeft(2, '0')}-${returnDate!.day.toString().padLeft(2, '0')}'),
                      ),
                    ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: working ? null : onTake,
                          icon: const Icon(Icons.arrow_upward),
                          label: const Text('Take'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: working ? null : onReturn,
                          icon: const Icon(Icons.arrow_downward),
                          label: const Text('Return'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  // Up to four secondary actions. A single row of Expanded
                  // icon+label buttons leaves ~65dp each on a phone, which clips
                  // the labels — so they sit in a two-column grid instead, and a
                  // lone last button takes the full width.
                  LayoutBuilder(builder: (context, c) {
                    const gap = 12.0;
                    final half = (c.maxWidth - gap) / 2;
                    final actions = <Widget>[
                      if (finishable)
                        OutlinedButton.icon(
                          onPressed: working ? null : onFinish,
                          icon: const Icon(Icons.check_circle_outline),
                          label: const Text('Finish'),
                        ),
                      OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                            foregroundColor: StatusColors.out),
                        onPressed: working ? null : onDestroy,
                        icon: const Icon(Icons.report_gmailerrorred_outlined),
                        label: const Text('Damaged'),
                      ),
                      OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                            foregroundColor: StatusColors.out),
                        onPressed: working ? null : onLost,
                        icon: const Icon(Icons.help_outline),
                        label: const Text('Lost'),
                      ),
                      if (isAdmin)
                        OutlinedButton.icon(
                          onPressed: working ? null : onRepair,
                          icon: const Icon(Icons.build_outlined),
                          label: const Text('Repair'),
                        ),
                    ];
                    return Wrap(
                      spacing: gap,
                      runSpacing: gap,
                      children: [
                        for (var i = 0; i < actions.length; i++)
                          SizedBox(
                            width: (i == actions.length - 1 &&
                                    actions.length.isOdd)
                                ? c.maxWidth
                                : half,
                            child: actions[i],
                          ),
                      ],
                    );
                  }),
                  const SizedBox(height: 8),
                  Text(
                    'Damaged marks units damaged (kept in the total); Repair moves them back. '
                    'Finish permanently reduces the total. Undo from the activity log.',
                    style: TextStyle(
                      fontSize: 12,
                      color:
                          Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

/// Quantity input with − / + buttons (48dp targets, easy one-handed in a
/// workshop). Keeps its text field in step with [quantity] when the parent
/// changes it, without fighting the user while they type.
class _QuantityStepper extends StatefulWidget {
  const _QuantityStepper({
    required this.quantity,
    required this.enabled,
    required this.onChanged,
  });

  final int quantity;
  final bool enabled;
  final ValueChanged<int> onChanged;

  @override
  State<_QuantityStepper> createState() => _QuantityStepperState();
}

class _QuantityStepperState extends State<_QuantityStepper> {
  late final TextEditingController _controller =
      TextEditingController(text: '${widget.quantity}');

  @override
  void didUpdateWidget(_QuantityStepper old) {
    super.didUpdateWidget(old);
    // Only rewrite the field when it disagrees with the parent (a +/- press or
    // a reset), never mid-typing: "" or "0" typed by the user already maps to
    // quantity 0, so they match and the field is left alone.
    if ((int.tryParse(_controller.text) ?? 0) != widget.quantity) {
      _controller.text = '${widget.quantity}';
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _step(int delta) {
    final next = (widget.quantity + delta).clamp(1, 1000000);
    widget.onChanged(next);
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        IconButton.filledTonal(
          tooltip: 'Decrease quantity',
          onPressed: widget.enabled && widget.quantity > 1 ? () => _step(-1) : null,
          icon: const Icon(Icons.remove),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: TextFormField(
            controller: _controller,
            enabled: widget.enabled,
            keyboardType: TextInputType.number,
            textAlign: TextAlign.center,
            decoration: const InputDecoration(labelText: 'Quantity'),
            onChanged: (v) => widget.onChanged(int.tryParse(v) ?? 0),
          ),
        ),
        const SizedBox(width: 12),
        IconButton.filledTonal(
          tooltip: 'Increase quantity',
          onPressed: widget.enabled ? () => _step(1) : null,
          icon: const Icon(Icons.add),
        ),
      ],
    );
  }
}
