import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../models.dart';
import '../../repository.dart';

class AddItemSheet extends StatefulWidget {
  const AddItemSheet({super.key, required this.locations});

  final List<Location> locations;

  @override
  State<AddItemSheet> createState() => _AddItemSheetState();
}

class _AddItemSheetState extends State<AddItemSheet> {
  final _repo = const InventoryRepository();
  final _type = TextEditingController();
  final _name = TextEditingController();
  final _model = TextEditingController();
  final _specification = TextEditingController();
  final _category = TextEditingController();
  final _photoUrl = TextEditingController();
  // Set when a file is picked; wins over the link.
  String? _photoData;
  final _picker = ImagePicker();
  final _unitsPerContainer = TextEditingController(text: '1');
  final _packageLabel = TextEditingController(text: 'package');
  // How stock is counted: 'units' (individual) or 'package' (whole packages,
  // contents not tracked).
  String _countMode = 'units';
  int _quantity = 1;
  bool _finishable = false;
  bool _saving = false;
  String? _error;

  // Cascading location: keep revealing the next sub-location level until a leaf
  // (works at any nesting depth). `_path` is the chain of chosen ids.
  late final List<Location> _topLevel =
      widget.locations.where((l) => l.isTopLevel).toList();
  final List<String> _path = [];

  List<Location> _childrenOf(String id) =>
      widget.locations.where((l) => l.parentId == id).toList();

  // One dropdown per level: level 0 = top-level, then the children of each
  // chosen location until one has no children.
  List<List<Location>> get _levels {
    final levels = <List<Location>>[_topLevel];
    for (var i = 0; i < _path.length; i++) {
      final kids = _childrenOf(_path[i]);
      if (kids.isEmpty) break;
      levels.add(kids);
    }
    return levels;
  }

  // Items live in a leaf — only a fully-drilled selection is valid.
  String? get _effectiveLocationId {
    if (_path.isEmpty) return null;
    final last = _path.last;
    return _childrenOf(last).isEmpty ? last : null;
  }

  // Categories already in use, offered as suggestions so free text doesn't
  // drift into "Cables" / "cables" and split the condition report's grouping.
  List<String> _categories = [];

  @override
  void initState() {
    super.initState();
    if (_topLevel.length == 1) _path.add(_topLevel.first.id);
    // Best-effort: the field still works as plain text if this fails.
    _repo.fetchCategories().then((c) {
      if (mounted) setState(() => _categories = c);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _type.dispose();
    _name.dispose();
    _model.dispose();
    _specification.dispose();
    _category.dispose();
    _photoUrl.dispose();
    _unitsPerContainer.dispose();
    _packageLabel.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final type = _type.text.trim();
    final name = _name.text.trim();
    final model = _model.text.trim();
    if (type.isEmpty) {
      setState(() => _error = 'Item type is required.');
      return;
    }
    if (name.isEmpty) {
      setState(() => _error = 'Name is required.');
      return;
    }
    if (model.isEmpty) {
      setState(() => _error = 'Model is required.');
      return;
    }
    final locationId = _effectiveLocationId;
    if (locationId == null || locationId.isEmpty) {
      setState(() => _error = 'Choose a location for this item.');
      return;
    }
    if (_quantity <= 0) {
      setState(() => _error = 'Quantity must be at least 1.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final isPackage = _countMode == 'package';
      await _repo.createItem(
        type: type,
        name: name,
        model: model,
        specification: _specification.text.trim(),
        category: _category.text.trim(),
        unitsPerContainer: int.tryParse(_unitsPerContainer.text.trim()) ?? 1,
        packageLabel: isPackage ? _packageLabel.text.trim() : null,
        locationId: locationId,
        quantity: _quantity,
        finishable: _finishable,
        photoUrl: _photoUrl.text.trim(),
        photoData: _photoData,
      );
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      setState(() {
        _error = '$e';
        _saving = false;
      });
    }
  }

  /// Pick and resize. The bytes ride along with the create request.
  Future<void> _pickPhoto(ImageSource source) async {
    try {
      final file = await _picker.pickImage(source: source, imageQuality: 70, maxWidth: 900);
      if (file == null) return;
      final bytes = await file.readAsBytes();
      if (!mounted) return;
      setState(() {
        _photoData = 'data:image/jpeg;base64,${base64Encode(bytes)}';
        _photoUrl.clear();
      });
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not read that image: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.88,
      ),
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Add item', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(_error!,
                    style: const TextStyle(color: Color(0xFFEF4444))),
              ),
            TextField(
                controller: _type,
                decoration: const InputDecoration(
                    labelText: 'Item type',
                    hintText: 'e.g. Cable',
                    helperText: 'The SKU is built from this and assigned on save.')),
            const SizedBox(height: 12),
            TextField(
                controller: _name,
                decoration: const InputDecoration(
                    labelText: 'Name', hintText: 'e.g. Patch Lead 3m')),
            const SizedBox(height: 12),
            TextField(
                controller: _model,
                decoration: const InputDecoration(
                    labelText: 'Model', hintText: 'e.g. CAT6-3M')),
            const SizedBox(height: 12),
            TextField(
              controller: _specification,
              maxLines: 2,
              decoration: const InputDecoration(
                  labelText: 'Specification (optional)',
                  hintText: 'e.g. HP · 16GB · 512GB SSD'),
            ),
            const SizedBox(height: 12),
            Autocomplete<String>(
              optionsBuilder: (value) {
                final q = value.text.trim().toLowerCase();
                if (q.isEmpty) return _categories;
                return _categories.where((c) => c.toLowerCase().contains(q));
              },
              onSelected: (v) => _category.text = v,
              fieldViewBuilder: (ctx, textCtl, focus, onSubmit) => TextField(
                controller: textCtl,
                focusNode: focus,
                textCapitalization: TextCapitalization.words,
                // Autocomplete owns its controller, so mirror it into ours —
                // that is what the save path reads.
                onChanged: (v) => _category.text = v,
                decoration: const InputDecoration(
                  labelText: 'Category (optional)',
                  hintText: 'e.g. Computer Laptop, Cables',
                  helperText: 'Groups this item on the condition report.',
                  helperMaxLines: 2,
                ),
              ),
            ),
            const SizedBox(height: 12),
            // Photo: a file or a link. Picking a file clears the link.
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _photoUrl,
                    keyboardType: TextInputType.url,
                    onChanged: (v) {
                      if (v.isNotEmpty && _photoData != null) {
                        setState(() => _photoData = null);
                      }
                    },
                    decoration: const InputDecoration(
                      labelText: 'Photo link (optional)',
                      hintText: 'https://…/photo.jpg',
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Take a photo',
                  icon: const Icon(Icons.photo_camera_outlined),
                  onPressed: () => _pickPhoto(ImageSource.camera),
                ),
                IconButton(
                  tooltip: 'Choose from gallery',
                  icon: const Icon(Icons.photo_library_outlined),
                  onPressed: () => _pickPhoto(ImageSource.gallery),
                ),
              ],
            ),
            if (_photoData != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Row(
                  children: [
                    const Icon(Icons.check_circle_outline, size: 16),
                    const SizedBox(width: 6),
                    const Expanded(child: Text('Photo selected', style: TextStyle(fontSize: 12))),
                    TextButton(
                      onPressed: () => setState(() => _photoData = null),
                      child: const Text('Clear'),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _countMode,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Counted as'),
              items: const [
                DropdownMenuItem(value: 'units', child: Text('Individual units')),
                DropdownMenuItem(value: 'package', child: Text("Packages (don't count contents)")),
              ],
              onChanged: (v) => setState(() => _countMode = v ?? 'units'),
            ),
            if (_countMode == 'package') ...[
              const SizedBox(height: 12),
              TextField(
                controller: _packageLabel,
                decoration: const InputDecoration(
                    labelText: 'Package label',
                    hintText: 'e.g. package, crate, reel'),
              ),
            ] else ...[
              const SizedBox(height: 12),
              TextField(
                controller: _unitsPerContainer,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                    labelText: 'Units per container',
                    hintText: '1 = loose units; e.g. 12 per box'),
              ),
            ],
            for (var i = 0; i < _levels.length; i++) ...[
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: i < _path.length ? _path[i] : null,
                isExpanded: true,
                decoration: InputDecoration(
                    labelText: i == 0 ? 'Location' : 'Sub-location'),
                items: [
                  for (final loc in _levels[i])
                    DropdownMenuItem(value: loc.id, child: Text(loc.name)),
                ],
                onChanged: (v) => setState(() {
                  _path.removeRange(i, _path.length);
                  if (v != null) _path.add(v);
                }),
              ),
            ],
            const SizedBox(height: 12),
            TextFormField(
              initialValue: '1',
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                  labelText: _countMode == 'package' ? 'Number of packages' : 'Initial quantity'),
              onChanged: (v) => _quantity = int.tryParse(v) ?? 0,
            ),
            const SizedBox(height: 8),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Finishable'),
              subtitle: const Text('Users can permanently use this item up.'),
              value: _finishable,
              onChanged: (v) => setState(() => _finishable = v),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: Text(_saving ? 'Adding…' : 'Add item'),
            ),
          ],
        ),
      ),
    );
  }
}
