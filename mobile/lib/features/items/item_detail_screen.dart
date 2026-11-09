import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../config/api_client.dart';
import '../../pending_photo_store.dart';
import '../../config/theme.dart';
import '../../models.dart';
import '../../move_picker_logic.dart';
import '../../return_by.dart';
import 'reserve_dialog.dart';
import '../../repository.dart';
import '../../widgets.dart';
import 'edit_stock_sheet.dart';
import 'item_qr.dart';
import 'item_photo.dart';
import 'suggestions_card.dart';
import 'movement_card.dart';
import '../../widgets/error_state.dart';
import 'destination_picker.dart';

/// Show a whole number as an int, otherwise one decimal (e.g. 2 boxes, 1.5 boxes).
String _trimNum(double n) =>
    n == n.roundToDouble() ? n.toInt().toString() : n.toStringAsFixed(1);

class _Data {
  _Data(this.item, this.stock, this.movements, this.profiles, this.locations, this.holders, this.loans, this.reservations);
  final Item item;
  final List<StockLevel> stock;
  final List<Movement> movements;
  final List<Profile> profiles;
  final List<Location> locations;
  final List<Holder> holders;

  /// Outstanding loans with their return dates (empty if the lookup failed — the
  /// screen must still work without them).
  final List<Loan> loans;

  /// Standing reservations of this item (empty if the lookup failed).
  final List<Reservation> reservations;
}

class ItemDetailScreen extends StatefulWidget {
  const ItemDetailScreen({super.key, required this.itemId, this.locationId});
  final String itemId;

  /// Where to start Take/Return (e.g. the box the person just scanned). Falls back
  /// to wherever most of the item is.
  final String? locationId;

  @override
  State<ItemDetailScreen> createState() => _ItemDetailScreenState();
}

class _ItemDetailScreenState extends State<ItemDetailScreen> {
  final _repo = const InventoryRepository();
  final _users = const UsersRepository();
  late Future<_Data> _future;

  String? _selectedLocationId;
  int _quantity = 1;
  bool _working = false;
  // The log is for glancing at — five at a time, never the whole history.
  static const _activityPageSize = 5;
  int _activityPage = 0;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_Data> _load() async {
    final results = await Future.wait([
      _repo.fetchItem(widget.itemId),
      _repo.fetchItemStock(widget.itemId),
      _repo.fetchMovements(widget.itemId),
      _users.fetchProfiles(),
      _repo.fetchLocations(),
      _repo.fetchHolders(widget.itemId),
      _repo.fetchBorrowed(widget.itemId).catchError((_) => <Loan>[]),
      _repo.fetchReservations(widget.itemId).catchError((_) => <Reservation>[]),
    ]);
    final data = _Data(
      results[0] as Item,
      results[1] as List<StockLevel>,
      results[2] as List<Movement>,
      results[3] as List<Profile>,
      results[4] as List<Location>,
      results[5] as List<Holder>,
      results[6] as List<Loan>,
      results[7] as List<Reservation>,
    );
    // Default to wherever most of this item is — usually the one you mean.
    if (_selectedLocationId == null &&
        widget.locationId != null &&
        data.stock.any((s) => s.locationId == widget.locationId)) {
      _selectedLocationId = widget.locationId;
    }
    if (_selectedLocationId == null && data.stock.isNotEmpty) {
      final sorted = data.stock.toList()
        ..sort((a, b) => b.quantity.compareTo(a.quantity));
      _selectedLocationId = sorted.first.locationId;
    }
    return data;
  }

  Future<void> _refresh() async {
    final f = _load();
    setState(() {
      _future = f;
    });
    await f;
  }

  /// "Where" choices for a reservation: places with units on the shelf, by path.
  List<ReservePlace> _reservePlaces(_Data data) {
    final byId = {for (final l in data.locations) l.id: l};
    String path(Location l) {
      final parts = <String>[];
      final seen = <String>{};
      Location? cur = l;
      while (cur != null && seen.add(cur.id)) {
        parts.insert(0, cur.name);
        cur = cur.parentId != null ? byId[cur.parentId] : null;
      }
      return parts.join(' › ');
    }

    return [
      for (final s in (data.stock.toList()..sort((a, b) => b.quantity.compareTo(a.quantity))))
        if (s.quantity > 0 && byId.containsKey(s.locationId))
          ReservePlace(locationId: s.locationId, label: path(byId[s.locationId]!), onShelf: s.quantity),
    ];
  }

  Future<void> _reserve(_Data data, bool manages) async {
    final places = _reservePlaces(data);
    if (places.isEmpty) {
      _snack('There is none on a shelf to reserve right now.');
      return;
    }
    final draft = await showReserveDialog(
      context,
      places: places,
      behalfPeople: manages ? _behalfPeople(data) : const [],
    );
    if (draft == null) return;
    try {
      await _repo.reserve(
        itemId: widget.itemId,
        locationId: draft.locationId,
        quantity: draft.quantity,
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
        note: draft.note,
        forUserId: draft.forUserId,
      );
      await _refresh();
      _snack('Reserved.');
    } catch (e) {
      _snack('$e');
    }
  }

  Future<void> _cancelReservation(Reservation r) async {
    try {
      await _repo.cancelReservation(r.id);
      await _refresh();
      _snack('Reservation cancelled.');
    } catch (e) {
      _snack('$e');
    }
  }

  Widget _reservationsCard(_Data data, bool manages) {
    final me = ApiClient.instance.currentUserId;
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return SectionCard(
      key: const ValueKey('card-reservations'),
      title: 'Reservations',
      collapsible: true,
      initiallyExpanded: data.reservations.isNotEmpty,
      summary: data.reservations.isEmpty ? 'none' : '${data.reservations.length}',
      trailing: TextButton.icon(
        onPressed: () => _reserve(data, manages),
        icon: const Icon(Icons.event_available_outlined, size: 18),
        label: const Text('Reserve'),
      ),
      child: data.reservations.isEmpty
          ? Padding(
              padding: const EdgeInsets.all(16),
              child: Text('Nothing reserved for this item right now.', style: TextStyle(color: muted)),
            )
          : Column(
              children: [
                for (final r in data.reservations)
                  ListTile(
                    dense: true,
                    leading: const Icon(Icons.event_available_outlined),
                    title: Text('${r.quantity} · ${r.locationName} · ${r.windowText}'),
                    subtitle: Text([
                      r.stateText,
                      if (r.userId != me) 'for ${r.userName.isEmpty ? 'someone' : r.userName}',
                      if (r.requestedBy != r.userId) 'booked by ${r.requestedByName.isEmpty ? 'a manager' : r.requestedByName}',
                    ].join(' · ')),
                    trailing: r.isStanding && (r.userId == me || r.requestedBy == me || manages)
                        ? TextButton(
                            onPressed: () => _cancelReservation(r),
                            child: const Text('Cancel'),
                          )
                        : null,
                  ),
              ],
            ),
    );
  }

  // Managers: who the next take/return is recorded for (null = me).
  String? _forPerson;

  /// People a manager may record for: accounts that can actually hold things,
  /// the ones holding this item first.
  List<Holder> _behalfPeople(_Data data) {
    final held = {for (final h in data.holders) h.userId: h.quantity};
    final people = [
      for (final p in data.profiles)
        if (!p.blocked && p.approvalStatus == 'approved')
          Holder(userId: p.id, fullName: p.fullName ?? '', quantity: held[p.id] ?? 0),
    ]..sort((a, b) {
        final byHeld = b.quantity.compareTo(a.quantity);
        return byHeld != 0 ? byHeld : a.fullName.compareTo(b.fullName);
      });
    return people;
  }

  // "Return by" for the next Take.
  ReturnBy _returnBy = ReturnBy.none;
  DateTime? _returnDate;

  Future<void> _pickReturnDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _returnDate ?? now.add(const Duration(days: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
    );
    if (picked != null && mounted) setState(() => _returnDate = picked);
  }

  /// Push a loan's return date (the holder, or a manager).
  Future<void> _changeLoanDate(Loan loan) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: (loan.expectedReturnAt?.toLocal().isAfter(now) ?? false)
          ? loan.expectedReturnAt!.toLocal()
          : now.add(const Duration(days: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
      helpText: 'New return date',
    );
    if (picked == null) return;
    final when = returnByIso(ReturnBy.custom, custom: picked);
    if (when.error != null) {
      _snack(when.error!);
      return;
    }
    try {
      await _repo.extendLoan(loan.takeId, when.iso!);
      await _refresh();
      _snack('Return date updated.');
    } catch (e) {
      _snack('$e');
    }
  }

  Future<void> _move(
    String action, {
    String? damagedBy,
    String? note,
    String? recommendation,
    String? resolves,
  }) async {
    final locationId = _selectedLocationId;
    if (locationId == null) {
      _snack('Choose a location.');
      return;
    }
    if (_quantity <= 0) {
      _snack('Enter a quantity of at least 1.');
      return;
    }
    String? expectedReturnAt;
    if (action == 'take') {
      final when = returnByIso(_returnBy, custom: _returnDate);
      if (when.error != null) {
        _snack(when.error!);
        return;
      }
      expectedReturnAt = when.iso;
    }
    setState(() => _working = true);
    try {
      await _repo.moveStock(
        itemId: widget.itemId,
        locationId: locationId,
        quantity: _quantity,
        action: action,
        damagedBy: damagedBy,
        note: note,
        recommendation: recommendation,
        resolves: resolves,
        expectedReturnAt: expectedReturnAt,
        onBehalfOf: _forPerson,
      );
      await _refresh();
    } catch (e) {
      _snack('$e');
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  /// Ask what is wrong and what should be done about it.
  ///
  /// The reason is required: the condition report's Condition column is a tally
  /// of exactly these words, so damage recorded without one would print as an
  /// unexplained blank on the report this app exists to produce.
  Future<({String note, String recommendation})?> _askReason(String action) async {
    final noteCtl = TextEditingController();
    final recCtl = TextEditingController();
    final damaged = action == 'destroy';
    return showDialog<({String note, String recommendation})?>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) {
          final note = noteCtl.text.trim();
          return AlertDialog(
            title: Text(damaged ? 'Mark damaged · $_quantity' : 'Mark lost · $_quantity'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: noteCtl,
                    autofocus: true,
                    textCapitalization: TextCapitalization.sentences,
                    onChanged: (_) => setDialogState(() {}),
                    decoration: const InputDecoration(
                      labelText: "What's wrong? *",
                      hintText: 'batteries died',
                      helperText: 'The condition report prints this, word for word.',
                      helperMaxLines: 2,
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: recCtl,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      labelText: 'What should be done?',
                      hintText: 'Replace those batteries',
                      helperText: 'Optional. Retires when the fault is repaired.',
                      helperMaxLines: 2,
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, null),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: note.length < 3
                    ? null
                    : () => Navigator.pop(
                          ctx,
                          (note: note, recommendation: recCtl.text.trim()),
                        ),
                child: Text(damaged ? 'Mark damaged' : 'Mark lost'),
              ),
            ],
          );
        },
      ),
    );
  }

  /// Repair flow: pick which recorded fault was fixed, so the condition report
  /// drops the right clause instead of an arbitrary one.
  Future<void> _repair() async {
    final locationId = _selectedLocationId;
    if (locationId == null) {
      _snack('Choose a location.');
      return;
    }
    List<Fault> faults;
    try {
      faults = await _repo.fetchFaults(itemId: widget.itemId, locationId: locationId);
    } catch (e) {
      _snack('$e');
      return;
    }
    if (!mounted) return;
    // Nothing damaged here has a recorded reason — repair without clearing one.
    if (faults.isEmpty) {
      await _move('repair');
      return;
    }
    final choice = await showModalBottomSheet<String?>(
      context: context,
      builder: (ctx) => SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const ListTile(
                title: Text('What did you fix?',
                    style: TextStyle(fontWeight: FontWeight.bold)),
              ),
              for (final f in faults)
                ListTile(
                  leading: const Icon(Icons.build_outlined),
                  title: Text(f.note),
                  subtitle: f.recommendation == null ? null : Text(f.recommendation!),
                  trailing: Text('${f.units}'),
                  onTap: () => Navigator.pop(ctx, f.id),
                ),
            ],
          ),
        ),
      ),
    );
    if (choice == null) return; // dismissed
    await _move('repair', resolves: choice);
  }

  /// Damage/Lost flow. The reason comes first — it is required — then an admin
  /// can attribute it to anyone: the sheet lists all users (current holders
  /// first, with their held count) so they can point to whoever did it, and it
  /// then comes out of that person's checked-out count. Members (or when there
  /// are no users) just mark it directly. `action` is 'destroy' or 'lost'.
  Future<void> _markGone(
      String action, List<Holder> holders, List<Profile> profiles) async {
    final reason = await _askReason(action);
    if (reason == null) return; // cancelled
    if (!mounted) return;

    if (!ApiClient.instance.canManageInventory || profiles.isEmpty) {
      await _move(action, note: reason.note, recommendation: reason.recommendation);
      return;
    }
    final heldBy = {for (final h in holders) h.userId: h.quantity};
    final people = [
      for (final p in profiles)
        (
          id: p.id,
          name: (p.fullName ?? '').isEmpty ? 'Unknown' : p.fullName!,
          held: heldBy[p.id] ?? 0,
        ),
    ]..sort((a, b) =>
        b.held != a.held ? b.held.compareTo(a.held) : a.name.compareTo(b.name));
    final choice = await showModalBottomSheet<String?>(
      context: context,
      builder: (ctx) => SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                title: Text(action == 'lost' ? 'Lost by' : 'Damaged by',
                    style: const TextStyle(fontWeight: FontWeight.bold)),
              ),
              ListTile(
                leading: const Icon(Icons.inventory_2_outlined),
                title: const Text('On the shelf'),
                onTap: () => Navigator.pop(ctx, ''),
              ),
              for (final person in people)
                ListTile(
                  leading: const Icon(Icons.person_outline),
                  title: Text(person.name),
                  trailing:
                      person.held > 0 ? Text('holds ${person.held}') : null,
                  onTap: () => Navigator.pop(ctx, person.id),
                ),
            ],
          ),
        ),
      ),
    );
    if (choice == null) return; // dismissed
    await _move(
      action,
      damagedBy: choice.isEmpty ? null : choice,
      note: reason.note,
      recommendation: reason.recommendation,
    );
  }

  Future<void> _undo(Movement m) async {
    try {
      await _repo.undoMovement(m.id);
      await _refresh();
    } catch (e) {
      _snack('$e');
    }
  }

  Future<void> _toggleFinishable(Item item) async {
    try {
      await _repo.setFinishable(item.id, !item.finishable);
      await _refresh();
    } catch (e) {
      _snack('$e');
    }
  }

  Future<void> _editDetails(Item item, List<StockLevel> stock) async {
    final typeCtl = TextEditingController(text: item.type);
    final nameCtl = TextEditingController(text: item.name);
    final modelCtl = TextEditingController(text: item.model);
    final specCtl = TextEditingController(text: item.specification ?? '');
    final categoryCtl = TextEditingController(text: item.category ?? '');
    // Categories already in use, so free text doesn't drift into "Cables" /
    // "cables" and split the condition report's grouping. Best-effort: the
    // field still works as plain text if the lookup fails.
    final knownCategories = await _repo.fetchCategories().catchError((_) => <String>[]);
    if (!mounted) return;
    // How it's counted today, so a per-unit item can be turned into a box item.
    var mode = item.isPackaged
        ? 'package'
        : (item.unitsPerContainer > 1 ? 'container' : 'units');
    final wasMode = mode;
    final perContainerCtl = TextEditingController(
        text: item.unitsPerContainer > 1 ? '${item.unitsPerContainer}' : '12');
    final existingLabel = stock
        .map((s) => s.containerLabel)
        .firstWhere((l) => l != null && l.isNotEmpty, orElse: () => null);
    final containerLabelCtl = TextEditingController(text: existingLabel ?? 'box');
    final packageLabelCtl = TextEditingController(text: item.packageLabel ?? 'package');

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Edit details'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: typeCtl,
                  decoration: const InputDecoration(
                    labelText: 'Item type',
                    helperText: 'Changing this reissues the SKU.',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: nameCtl,
                  decoration: const InputDecoration(labelText: 'Name'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: modelCtl,
                  decoration: const InputDecoration(labelText: 'Model'),
                ),
                const SizedBox(height: 12),
                // Shown, not edited — the server assigns it.
                TextField(
                  controller: TextEditingController(text: item.sku),
                  readOnly: true,
                  enabled: false,
                  decoration: const InputDecoration(labelText: 'SKU (assigned)'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: specCtl,
                  decoration: const InputDecoration(labelText: 'Specification (optional)'),
                ),
                const SizedBox(height: 12),
                Autocomplete<String>(
                  initialValue: TextEditingValue(text: categoryCtl.text),
                  optionsBuilder: (value) {
                    final q = value.text.trim().toLowerCase();
                    if (q.isEmpty) return knownCategories;
                    return knownCategories
                        .where((c) => c.toLowerCase().contains(q));
                  },
                  onSelected: (v) => categoryCtl.text = v,
                  fieldViewBuilder: (ctx, textCtl, focus, onSubmit) => TextField(
                    controller: textCtl,
                    focusNode: focus,
                    textCapitalization: TextCapitalization.words,
                    // The Autocomplete owns its own controller, so mirror it
                    // into ours — that is what the save path reads.
                    onChanged: (v) => categoryCtl.text = v,
                    decoration: const InputDecoration(
                      labelText: 'Category (optional)',
                      hintText: 'e.g. Computer Laptop, Cables',
                      helperText: 'Groups this item on the condition report.',
                      helperMaxLines: 2,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  isExpanded: true,
                  initialValue: mode,
                  decoration: const InputDecoration(labelText: 'Counted as'),
                  items: const [
                    DropdownMenuItem(value: 'units', child: Text('Individual units')),
                    DropdownMenuItem(value: 'container', child: Text('Containers (track units inside)')),
                    DropdownMenuItem(value: 'package', child: Text("Packages (don't count contents)")),
                  ],
                  onChanged: (v) => setDialogState(() => mode = v ?? 'units'),
                ),
                if (mode == 'container') ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: perContainerCtl,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Units per container'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: containerLabelCtl,
                    decoration: const InputDecoration(
                        labelText: 'Container label', hintText: 'e.g. box, pallet'),
                  ),
                ],
                if (mode == 'package') ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: packageLabelCtl,
                    decoration: const InputDecoration(
                        labelText: 'Package label', hintText: 'e.g. package, crate'),
                  ),
                ],
                const SizedBox(height: 12),
                // Photo: applied straight away rather than on Save, so the
                // picker's own dialogs don't fight this one.
                Row(
                  children: [
                    const Expanded(child: Text('Photo')),
                    IconButton(
                      tooltip: 'Take a photo',
                      icon: const Icon(Icons.photo_camera_outlined),
                      onPressed: () => _changePhoto(item, ImageSource.camera),
                    ),
                    IconButton(
                      tooltip: 'Choose from gallery',
                      icon: const Icon(Icons.photo_library_outlined),
                      onPressed: () => _changePhoto(item, ImageSource.gallery),
                    ),
                    IconButton(
                      tooltip: 'Paste a link',
                      icon: const Icon(Icons.link),
                      onPressed: () => _editPhotoLink(item),
                    ),
                    if (item.hasPhoto)
                      IconButton(
                        tooltip: 'Remove photo',
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () async {
                          await _repo.removeItemPhoto(item.id);
                          await _refresh();
                        },
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  mode == 'container'
                      ? 'Stock stays counted in units — they are just shown grouped, e.g. "2 boxes (24 units)". Nothing is added or removed.'
                      : mode == 'package' && wasMode != 'package'
                          ? 'Careful: the numbers already recorded will be read as package counts, not units.'
                          : 'Plain unit counting.',
                  style: TextStyle(
                      fontSize: 12, color: Theme.of(ctx).colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
          ],
        ),
      ),
    );
    if (saved != true) return;
    if (typeCtl.text.trim().isEmpty) {
      _snack('Item type is required.');
      return;
    }
    if (nameCtl.text.trim().isEmpty) {
      _snack('Name is required.');
      return;
    }
    if (modelCtl.text.trim().isEmpty) {
      _snack('Model is required.');
      return;
    }
    final perContainer = int.tryParse(perContainerCtl.text.trim()) ?? 0;
    if (mode == 'container' && perContainer < 2) {
      _snack('A container has to hold at least 2 units.');
      return;
    }
    if (mode == 'container' && containerLabelCtl.text.trim().isEmpty) {
      _snack('Give the container a label (e.g. box).');
      return;
    }
    if (mode == 'package' && packageLabelCtl.text.trim().isEmpty) {
      _snack('Give the package a label (e.g. package).');
      return;
    }
    try {
      await _repo.updateItem(
        item.id,
        type: typeCtl.text.trim(),
        name: nameCtl.text.trim(),
        model: modelCtl.text.trim(),
        specification: specCtl.text.trim(),
        category: categoryCtl.text.trim(),
      );
      await _repo.setItemPackaging(
        item.id,
        mode: mode,
        unitsPerContainer: perContainer,
        containerLabel: containerLabelCtl.text.trim(),
        packageLabel: packageLabelCtl.text.trim(),
      );
      await _refresh();
    } catch (e) {
      _snack('$e');
    }
  }

  /// Admin: move units of this item from one location to another — the
  /// counterpart to "Edit stock numbers". Moving conserves the grand total (it
  /// travels with the units); correcting is what changes it.
  Future<void> _moveBetween(_Data data) async {
    final byId = {for (final l in data.locations) l.id: l};
    final sources = data.stock.where((s) => s.quantity > 0 && byId.containsKey(s.locationId)).toList()
      ..sort((a, b) => b.quantity.compareTo(a.quantity));
    if (sources.isEmpty) {
      _snack('Nothing is on the shelf anywhere to move.');
      return;
    }
    // Anywhere stock can go: leaves, plus rooms that already hold items
    // directly alongside their sub-locations.
    final parentIds = data.locations.where((l) => l.parentId != null).map((l) => l.parentId).toSet();
    final occupied = data.stock.map((s) => s.locationId).toSet();
    final destinations = data.locations
        .where((l) => !parentIds.contains(l.id) || occupied.contains(l.id))
        .toList();

    var fromId = sources.first.locationId;
    String? toId;
    final qtyCtl = TextEditingController(text: '1');

    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) {
          final available =
              sources.firstWhere((s) => s.locationId == fromId).quantity;
          return AlertDialog(
            title: const Text('Move between locations'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  DropdownButtonFormField<String>(
                    isExpanded: true,
                    initialValue: fromId,
                    decoration: const InputDecoration(labelText: 'From'),
                    items: [
                      for (final s in sources)
                        DropdownMenuItem(
                          value: s.locationId,
                          child: Text('${locationPath(byId[s.locationId]!, byId)} · ${s.quantity}',
                              maxLines: 1, overflow: TextOverflow.ellipsis),
                        ),
                    ],
                    onChanged: (v) => setDialogState(() {
                      fromId = v ?? fromId;
                      if (toId == fromId) toId = null; // the source is never a destination
                    }),
                  ),
                  const SizedBox(height: 12),
                  // Tapping opens the destination picker: boxes first, search over
                  // the full path, drill-down, recent places. The choice is shown
                  // as a full path, never a bare "Shelf 2".
                  InkWell(
                    key: const ValueKey('move-to'),
                    borderRadius: BorderRadius.circular(8),
                    onTap: () async {
                      final picked = await pickDestination(
                        ctx,
                        all: data.locations,
                        destinations: destinations.where((l) => l.id != fromId).toList(),
                        currentId: toId,
                      );
                      if (picked != null) setDialogState(() => toId = picked);
                    },
                    child: InputDecorator(
                      decoration: const InputDecoration(
                        labelText: 'To',
                        suffixIcon: Icon(Icons.chevron_right),
                      ),
                      child: toId == null
                          ? Text('Choose where it is going',
                              style: TextStyle(color: Theme.of(ctx).hintColor))
                          : Text(locationPath(byId[toId]!, byId), maxLines: 3, overflow: TextOverflow.ellipsis),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: qtyCtl,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                      labelText: 'How many',
                      helperText: '$available on the shelf there',
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Move')),
            ],
          );
        },
      ),
    );
    if (go != true) return;

    final to = toId;
    final qty = int.tryParse(qtyCtl.text.trim()) ?? 0;
    if (to == null) {
      _snack('Choose where it is going.');
      return;
    }
    if (qty < 1) {
      _snack('Enter how many to move (at least 1).');
      return;
    }
    try {
      await _repo.moveStockBetween(
        itemId: widget.itemId,
        fromLocationId: fromId,
        toLocationId: to,
        quantity: qty,
      );
      RecentDestinations.remember(to);
      _snack('Moved $qty to ${byId[to] == null ? 'the new location' : locationPath(byId[to]!, byId)}.');
      await _refresh();
    } catch (e) {
      _snack('$e');
    }
  }

  Future<void> _editStock(List<StockLevel> stock) async {
    final saved = await showSlideSheet<bool>(
      context,
      builder: (_) => EditStockSheet(itemId: widget.itemId, stock: stock),
    );
    if (saved == true) await _refresh();
  }

  Future<void> _deleteItem(Item item) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete "${item.name}"?'),
        content: const Text('Removes it from the catalog and all its stock.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete')),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      await _repo.deleteItem(item.id);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      _snack('$e');
    }
  }

  void _snack(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  /// Pick, resize and upload. Applied immediately.
  Future<void> _changePhoto(Item item, ImageSource source) async {
    try {
      // If Android kills the app while the camera is open, the next start finishes this.
      await PendingPhotoStore.save(PendingPhotoKind.itemPhoto, item.id);
      final file = await ImagePicker()
          .pickImage(source: source, imageQuality: 70, maxWidth: 900);
      await PendingPhotoStore.clear();
      if (file == null) return;
      final bytes = await file.readAsBytes();
      await _repo.uploadItemPhoto(item.id, 'data:image/jpeg;base64,${base64Encode(bytes)}');
      await _refresh();
    } catch (e) {
      _snack('Could not set that photo: $e');
    }
  }

  /// Set or clear the external photo link.
  Future<void> _editPhotoLink(Item item) async {
    final ctl = TextEditingController(text: item.photoUrl ?? '');
    final url = await showDialog<String?>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Photo link'),
        content: TextField(
          controller: ctl,
          autofocus: true,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(
            hintText: 'https://…/photo.jpg',
            helperText: 'Must point straight at an image file, not a web page.',
            helperMaxLines: 2,
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, ''), child: const Text('Clear')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, ctl.text.trim()),
              child: const Text('Save')),
        ],
      ),
    );
    if (url == null) return;
    try {
      await _repo.setItemPhotoUrl(item.id, url.isEmpty ? null : url);
      await _refresh();
    } catch (e) {
      _snack('Could not save that link: $e');
    }
  }

  /// Back / See more for the activity log.
  Widget _activityPager(int count, Color muted) {
    final pages = (count / _activityPageSize).ceil();
    final from = _activityPage * _activityPageSize + 1;
    final to = (from + _activityPageSize - 1).clamp(0, count);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 8, 8),
      child: Row(
        children: [
          Expanded(
            child: Text('$from–$to of $count',
                style: TextStyle(fontSize: 12, color: muted)),
          ),
          TextButton(
            onPressed: _activityPage == 0
                ? null
                : () => setState(() => _activityPage -= 1),
            child: const Text('Back'),
          ),
          TextButton(
            onPressed: _activityPage >= pages - 1
                ? null
                : () => setState(() => _activityPage += 1),
            child: const Text('See more'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Warehouse rights, not "is an admin" — a stock manager has these.
    final isAdmin = ApiClient.instance.canManageInventory;
    return Scaffold(
      appBar: AppBar(title: const Text('Item')),
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
            final muted = Theme.of(context).colorScheme.onSurfaceVariant;
            final nameById = {for (final p in data.profiles) p.id: p.fullName};
            final total = data.stock.fold<int>(0, (s, r) => s + r.quantity);
            final reversedIds = {
              for (final m in data.movements)
                if (m.reversalOf != null) m.reversalOf!,
            };
            final myId = ApiClient.instance.currentUserId;

            return ListView(
              padding: const EdgeInsets.all(16),
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(data.item.type,
                              style: Theme.of(context).textTheme.headlineSmall),
                          const SizedBox(height: 4),
                          Text(data.item.itemLabel, style: TextStyle(color: muted)),
                          const SizedBox(height: 2),
                          Text(data.item.sku, style: TextStyle(color: muted)),
                          if (data.item.specification != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Text('Spec: ${data.item.specification!}',
                                  style: TextStyle(color: muted)),
                            ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Show QR code',
                      icon: const Icon(Icons.qr_code_2),
                      onPressed: () => showItemQrDialog(context, data.item),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text('$total',
                            style: const TextStyle(
                                fontSize: 26, fontWeight: FontWeight.w700)),
                        Text('in stock', style: TextStyle(fontSize: 12, color: muted)),
                        const SizedBox(height: 6),
                        StatusChip(quantity: total),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 16),

                // Photo sits above the stock breakdown; admins change it here.
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    // Display only — the photo is set from the edit sheet.
                    child: ItemPhoto(item: data.item),
                  ),
                ),
                const SizedBox(height: 16),

                // Work worth doing on something that still works.
                SuggestionsCard(
                  item: data.item,
                  locations: data.stock
                      .map((r) => Location(id: r.locationId, name: r.locationName ?? ''))
                      .toList(),
                  onChanged: _refresh,
                ),
                const SizedBox(height: 16),

                SectionCard(
                  title: 'Where it is',
                  child: (data.stock.isEmpty && data.holders.isEmpty)
                      ? const Padding(
                          padding: EdgeInsets.all(20),
                          child: Center(child: Text('Not stored anywhere yet.')),
                        )
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            for (final s in data.stock)
                              Builder(builder: (_) {
                                // Container-aware: when packed and this location has a
                                // container label, show accessible units as containers too.
                                final isContainer = (s.containerLabel != null) &&
                                    data.item.unitsPerContainer > 1;
                                final containers =
                                    s.quantity / data.item.unitsPerContainer;
                                final subtitleParts = <String>[
                                  if (isContainer)
                                    '${_trimNum(containers)} ${s.containerLabel}'
                                        '${containers == 1 ? '' : 's'}',
                                  if (s.damaged > 0) '${s.damaged} damaged',
                                ];
                                final packaged = data.item.isPackaged;
                                return ListTile(
                                  leading: const Icon(Icons.place_outlined),
                                  title: Text(s.locationName ?? s.locationId),
                                  subtitle: subtitleParts.isEmpty
                                      ? null
                                      : Text(subtitleParts.join(' · '),
                                          style: TextStyle(
                                              color: s.damaged > 0
                                                  ? const Color(0xFFF59E0B)
                                                  : muted)),
                                  trailing: Text(
                                    packaged
                                        ? formatItemQuantity(data.item, s.quantity)
                                        : s.capacity > 0
                                            ? '${s.quantity} accessible / ${s.capacity}'
                                            : '${s.quantity} accessible',
                                  ),
                                );
                              }),
                            if (data.holders.isNotEmpty) ...[
                              const Divider(height: 1),
                              const Padding(
                                padding: EdgeInsets.fromLTRB(16, 12, 16, 4),
                                child: Text('Currently held by',
                                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                              ),
                              for (final h in data.holders) ...[
                                ListTile(
                                  dense: true,
                                  leading: const Icon(Icons.person_outline),
                                  title: Text(h.fullName.isEmpty ? 'Unknown' : h.fullName),
                                  trailing: Text('${h.quantity}'),
                                ),
                                // When each lot is due back; overdue ones stand out.
                                for (final l in data.loans.where((l) => l.userId == h.userId))
                                  Padding(
                                    padding: const EdgeInsets.fromLTRB(56, 0, 8, 4),
                                    child: Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            '${l.quantity} · ${l.dueText}',
                                            style: TextStyle(
                                              fontSize: 12,
                                              fontWeight: l.isOverdue ? FontWeight.w600 : FontWeight.normal,
                                              color: l.isOverdue
                                                  ? Theme.of(context).colorScheme.error
                                                  : Theme.of(context).colorScheme.onSurfaceVariant,
                                            ),
                                          ),
                                        ),
                                        if (l.userId == ApiClient.instance.currentUserId ||
                                            ApiClient.instance.canManageInventory)
                                          TextButton(
                                            onPressed: () => _changeLoanDate(l),
                                            child: const Text('Change date', style: TextStyle(fontSize: 12)),
                                          ),
                                      ],
                                    ),
                                  ),
                              ],
                            ],
                            Padding(
                              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                              child: Builder(builder: (context) {
                                final totalCap = data.stock.fold<int>(0, (s, r) => s + r.capacity);
                                final acc = data.stock.fold<int>(0, (s, r) => s + r.quantity);
                                final dmg = data.stock.fold<int>(0, (s, r) => s + r.damaged);
                                final held = data.holders.fold<int>(0, (s, h) => s + h.quantity);
                                return Text(
                                  'Total $totalCap = $acc accessible'
                                  '${dmg > 0 ? ' · $dmg damaged' : ''}'
                                  '${held > 0 ? ' · $held with people' : ''}',
                                  style: TextStyle(
                                      fontSize: 12,
                                      color: Theme.of(context).colorScheme.onSurfaceVariant),
                                );
                              }),
                            ),
                          ],
                        ),
                ),
                const SizedBox(height: 16),

                MovementCard(
                  locations: data.locations,
                  stock: data.stock,
                  selectedLocationId: _selectedLocationId,
                  quantity: _quantity,
                  working: _working,
                  finishable: data.item.finishable,
                  onLocationChanged: (v) => setState(() => _selectedLocationId = v),
                  onQuantityChanged: (v) => setState(() => _quantity = v),
                  onTake: () => _move('take'),
                  onReturn: () => _move('return'),
                  onFinish: () => _move('finish'),
                  onDestroy: () => _markGone('destroy', data.holders, data.profiles),
                  onLost: () => _markGone('lost', data.holders, data.profiles),
                  onRepair: _repair,
                  isAdmin: isAdmin,
                  returnBy: _returnBy,
                  returnDate: _returnDate,
                  onReturnByChanged: (v) => setState(() => _returnBy = v),
                  onPickReturnDate: _pickReturnDate,
                  behalfPeople: isAdmin ? _behalfPeople(data) : const [],
                  forPersonId: _forPerson,
                  onForPersonChanged: (v) => setState(() => _forPerson = v),
                ),
                const SizedBox(height: 16),

                _reservationsCard(data, isAdmin),
                const SizedBox(height: 16),

                SectionCard(
                  key: const ValueKey('card-activity'),
                  title: 'Activity',
                  collapsible: true,
                  initiallyExpanded: false,
                  summary: data.movements.isEmpty ? 'none yet' : '${data.movements.length} entries · who took what',
                  child: data.movements.isEmpty
                      ? const Padding(
                          padding: EdgeInsets.all(20),
                          child: Center(child: Text('No activity yet.')),
                        )
                      : Column(
                          children: [
                            for (final m in data.movements.skip(
                                    _activityPage * _activityPageSize)
                                .take(_activityPageSize))
                              ListTile(
                                leading:
                                    Icon(_reasonIcon(m), color: _reasonColor(m)),
                                title: Text(nameById[m.userId] ?? 'Unknown'),
                                subtitle: Text(
                                  '${_reasonLabel(m)} · ${m.locationName ?? '—'}'
                                  ' · ${_formatDate(m.createdAt)}'
                                  // Recorded by someone else: a manager on their behalf,
                                  // or an admin attributing damage.
                                  '${m.recordedBy != null && m.recordedBy != m.userId ? '\nrecorded by ${nameById[m.recordedBy] ?? 'someone else'}' : ''}',
                                ),
                                trailing: ((m.reason == 'finish' ||
                                            m.reason == 'destroyed' ||
                                            m.reason == 'lost') &&
                                        !reversedIds.contains(m.id) &&
                                        ((m.recordedBy ?? m.userId) == myId || isAdmin))
                                    ? TextButton.icon(
                                        onPressed: () => _undo(m),
                                        icon: const Icon(Icons.undo, size: 16),
                                        label: const Text('Undo'),
                                      )
                                    : null,
                              ),
                            if (data.movements.length > _activityPageSize)
                              _activityPager(data.movements.length, muted),
                          ],
                        ),
                ),

                // Admin actions stay shut until asked for, so the page is
                // about the item rather than the things you can do to it.
                if (isAdmin) ...[
                  const SizedBox(height: 16),
                  Card(
                    clipBehavior: Clip.antiAlias,
                    child: ExpansionTile(
                      title: const Text('Manage item'),
                      subtitle: Text('edit, move, adjust, delete',
                          style: TextStyle(fontSize: 12, color: muted)),
                      children: [
                        SwitchListTile(
                          title: const Text('Finishable'),
                          subtitle:
                              const Text('Anyone can permanently use this item up.'),
                          value: data.item.finishable,
                          onChanged:
                              _working ? null : (_) => _toggleFinishable(data.item),
                        ),
                        ListTile(
                          leading: const Icon(Icons.edit_outlined),
                          title: const Text('Edit details'),
                          onTap: () => _editDetails(data.item, data.stock),
                        ),
                        ListTile(
                          leading: const Icon(Icons.tune),
                          title: const Text('Edit stock numbers'),
                          enabled: data.stock.isNotEmpty,
                          onTap: data.stock.isEmpty ? null : () => _editStock(data.stock),
                        ),
                        ListTile(
                          leading: const Icon(Icons.local_shipping_outlined),
                          title: const Text('Move between locations'),
                          enabled: !data.stock.every((s) => s.quantity <= 0),
                          onTap: data.stock.every((s) => s.quantity <= 0)
                              ? null
                              : () => _moveBetween(data),
                        ),
                        ListTile(
                          leading: const Icon(Icons.delete_outline,
                              color: StatusColors.out),
                          title: const Text('Delete item',
                              style: TextStyle(color: StatusColors.out)),
                          onTap: () => _deleteItem(data.item),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

String _formatDate(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${two(d.month)}-${two(d.day)} ${two(d.hour)}:${two(d.minute)}';
}

String _reasonLabel(Movement m) {
  final n = m.delta.abs();
  switch (m.reason) {
    case 'return':
      return 'Returned $n';
    case 'initial':
      return 'Stocked $n';
    case 'finish':
      return 'Finished $n';
    case 'destroyed':
      return 'Damaged ${m.damagedDelta.abs() == 0 ? n : m.damagedDelta.abs()}';
    case 'lost':
      return 'Lost ${m.capacityDelta.abs() == 0 ? n : m.capacityDelta.abs()}';
    case 'repair':
      return 'Repaired $n';
    case 'undo':
      return 'Undid';
    case 'adjust':
      final parts = <String>[];
      if (m.delta != 0) parts.add('qty ${m.delta > 0 ? '+' : ''}${m.delta}');
      if (m.capacityDelta != 0) {
        parts.add('total ${m.capacityDelta > 0 ? '+' : ''}${m.capacityDelta}');
      }
      return parts.isEmpty ? 'Adjusted' : 'Adjusted (${parts.join(', ')})';
    case 'take':
    default:
      return m.delta < 0 ? 'Took $n' : 'Added $n';
  }
}

IconData _reasonIcon(Movement m) {
  switch (m.reason) {
    case 'finish':
      return Icons.check_circle_outline;
    case 'destroyed':
      return Icons.report_gmailerrorred_outlined;
    case 'lost':
      return Icons.help_outline;
    case 'repair':
      return Icons.build_outlined;
    case 'adjust':
      return Icons.tune;
    case 'undo':
      return Icons.undo;
    default:
      return m.delta < 0 ? Icons.arrow_upward : Icons.arrow_downward;
  }
}

Color _reasonColor(Movement m) {
  switch (m.reason) {
    case 'lost':
      return StatusColors.out;
    case 'destroyed':
    case 'finish':
    case 'adjust':
      return StatusColors.low;
    case 'repair':
    case 'undo':
      return StatusColors.ok;
    default:
      return m.delta < 0 ? StatusColors.low : StatusColors.ok;
  }
}
