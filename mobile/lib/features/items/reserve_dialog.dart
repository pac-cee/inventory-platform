import 'package:flutter/material.dart';

import '../../models.dart';
import '../../reserve_window.dart';

/// What the dialog hands back: where, how many, when, and for whom.
class ReserveDraft {
  const ReserveDraft({
    required this.locationId,
    required this.quantity,
    required this.startsAt,
    required this.endsAt,
    this.note,
    this.forUserId,
  });

  final String locationId;
  final int quantity;
  final String startsAt;
  final String endsAt;
  final String? note;
  final String? forUserId;
}

/// A place with units of this item on the shelf, with a readable path.
class ReservePlace {
  const ReservePlace({required this.locationId, required this.label, required this.onShelf});
  final String locationId;
  final String label;
  final int onShelf;
}

/// Hold some units for a few days so they are there when you come. Managers can
/// reserve for someone else. The dates are checked here with the same rules the
/// API enforces, so mistakes are caught before sending; the API has the last word.
Future<ReserveDraft?> showReserveDialog(
  BuildContext context, {
  required List<ReservePlace> places,
  List<Holder> behalfPeople = const [],
}) {
  return showDialog<ReserveDraft>(
    context: context,
    builder: (_) => _ReserveDialog(places: places, behalfPeople: behalfPeople),
  );
}

class _ReserveDialog extends StatefulWidget {
  const _ReserveDialog({required this.places, required this.behalfPeople});
  final List<ReservePlace> places;
  final List<Holder> behalfPeople;

  @override
  State<_ReserveDialog> createState() => _ReserveDialogState();
}

class _ReserveDialogState extends State<_ReserveDialog> {
  late String _locationId = widget.places.first.locationId;
  final _qty = TextEditingController(text: '1');
  final _note = TextEditingController();
  DateTimeRange? _range;
  String? _forUser;
  String? _error;

  @override
  void dispose() {
    _qty.dispose();
    _note.dispose();
    super.dispose();
  }

  String _ymd(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _pickRange() async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: now.add(const Duration(days: maxStartDays + maxLengthDays)),
      initialDateRange: _range,
      helpText: 'Hold it from … until …',
    );
    if (picked != null) setState(() => _range = picked);
  }

  void _submit() {
    final qty = int.tryParse(_qty.text.trim()) ?? 0;
    if (qty < 1) {
      setState(() => _error = 'Enter a quantity of at least 1.');
      return;
    }
    final w = reserveWindow(_range?.start, _range?.end);
    if (w.error != null) {
      setState(() => _error = w.error);
      return;
    }
    Navigator.pop(
      context,
      ReserveDraft(
        locationId: _locationId,
        quantity: qty,
        startsAt: w.startsAt!,
        endsAt: w.endsAt!,
        note: _note.text.trim().isEmpty ? null : _note.text.trim(),
        forUserId: _forUser,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Reserve'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DropdownButtonFormField<String>(
              isExpanded: true,
              initialValue: _locationId,
              decoration: const InputDecoration(labelText: 'Where'),
              items: [
                for (final p in widget.places)
                  DropdownMenuItem(
                    value: p.locationId,
                    child: Text('${p.label} · ${p.onShelf}', maxLines: 1, overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: (v) => setState(() => _locationId = v ?? _locationId),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _qty,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Quantity'),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _pickRange,
              icon: const Icon(Icons.event_outlined),
              label: Text(_range == null
                  ? 'Choose the dates'
                  : '${_ymd(_range!.start)}  →  ${_ymd(_range!.end)}'),
            ),
            if (widget.behalfPeople.isNotEmpty) ...[
              const SizedBox(height: 12),
              DropdownButtonFormField<String?>(
                isExpanded: true,
                initialValue: _forUser,
                decoration: const InputDecoration(labelText: 'Reserve for'),
                items: [
                  const DropdownMenuItem<String?>(value: null, child: Text('Me')),
                  for (final p in widget.behalfPeople)
                    DropdownMenuItem<String?>(
                      value: p.userId,
                      child: Text(p.fullName.isEmpty ? 'Unknown' : p.fullName, maxLines: 1, overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: (v) => setState(() => _forUser = v),
              ),
            ],
            const SizedBox(height: 12),
            TextField(
              controller: _note,
              maxLength: 200,
              decoration: const InputDecoration(labelText: 'Note (optional)', hintText: 'e.g. for the demo on Friday'),
            ),
            const Text(
              'Reserved units are held for you from the first day: nobody else can take them. Taking them yourself collects the reservation.',
              style: TextStyle(fontSize: 12),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(onPressed: _submit, child: const Text('Reserve')),
      ],
    );
  }
}
