import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../location_rules.dart';
import '../../models.dart';
import 'location_photo.dart';

/// What the dialog hands back: a name, and how the picture should change.
class LocationDraft {
  const LocationDraft({
    required this.name,
    this.photoData,
    this.photoUrl,
    this.clearPhoto = false,
    this.kind = 'area',
    this.label = '',
  });

  final String name;

  /// area | shelf | level | box.
  final String kind;

  /// What a box is for; only meaningful when [kind] is 'box'.
  final String label;

  /// A newly picked file as `data:image/jpeg;base64,...`, or null for no change.
  final String? photoData;

  /// A link typed in, or null for no change. Empty string means "remove it".
  final String? photoUrl;

  /// True when the user switched to a link or cleared the file — the stored
  /// upload has to go, or it keeps winning and the new link is never seen.
  final bool clearPhoto;
}

/// Name a location and give it a picture, from a file or a link.
///
/// Used for creating and for editing, at every level: a room and a shelf inside
/// it are the same kind of thing and each gets its own photo.
///
/// [parentKind] is the kind of the place this one sits in (null = top level). It decides
/// what may be created: Area > Shelf > Level > Box, so a box can only be made on a level.
Future<LocationDraft?> showLocationEditor(
  BuildContext context, {
  required String title,
  Location? existing,
  String? parentKind,
}) {
  return showDialog<LocationDraft>(
    context: context,
    builder: (_) => _LocationEditorDialog(title: title, existing: existing, parentKind: parentKind),
  );
}

class _LocationEditorDialog extends StatefulWidget {
  const _LocationEditorDialog({required this.title, required this.existing, required this.parentKind});

  final String title;
  final Location? existing;
  final String? parentKind;

  @override
  State<_LocationEditorDialog> createState() => _LocationEditorDialogState();
}

class _LocationEditorDialogState extends State<_LocationEditorDialog> {
  late final _name = TextEditingController(text: widget.existing?.name ?? '');
  late final _link = TextEditingController(text: widget.existing?.photoUrl ?? '');
  late final _boxLabel = TextEditingController(text: widget.existing?.label ?? '');
  /// What this place may be here (Area > Shelf > Level > Box); an existing place keeps its own kind.
  late final List<String> _kinds = widget.existing == null
      ? kindsAllowedUnder(widget.parentKind)
      : kindsForEdit(widget.existing!.kind, widget.parentKind);
  late String _kind = widget.existing?.kind ?? (_kinds.isNotEmpty ? _kinds.first : 'area');
  final _picker = ImagePicker();
  String? _photoData;
  bool _clearPhoto = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _link.dispose();
    super.dispose();
  }

  /// Pick and resize. The bytes ride along with the save.
  Future<void> _pick(ImageSource source) async {
    try {
      final file = await _picker.pickImage(source: source, imageQuality: 70, maxWidth: 900);
      if (file == null) return;
      final bytes = await file.readAsBytes();
      if (!mounted) return;
      setState(() {
        _photoData = 'data:image/jpeg;base64,${base64Encode(bytes)}';
        _link.clear(); // an upload wins, so don't leave a link hiding under it
        _clearPhoto = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not read that image: $e');
    }
  }

  void _clear() => setState(() {
        _photoData = null;
        _clearPhoto = true;
      });

  @override
  Widget build(BuildContext context) {
    final existing = widget.existing;
    final keepsCurrent = existing != null && existing.hasPhoto && _photoData == null && !_clearPhoto;

    return AlertDialog(
      title: Text(widget.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _name,
              autofocus: true,
              decoration: InputDecoration(labelText: 'Name', hintText: kindHint(_kind)),
            ),
            const SizedBox(height: 12),
            // One possible kind (the usual case: a shelf goes in an area, a box on a level):
            // say what is being made instead of asking a question with one answer.
            if (_kinds.length > 1)
              DropdownButtonFormField<String>(
                isExpanded: true,
                initialValue: _kind,
                decoration: const InputDecoration(labelText: 'Type'),
                items: [for (final k in _kinds) DropdownMenuItem(value: k, child: Text(kindLabel(k)))],
                onChanged: (v) => setState(() => _kind = v ?? _kind),
              )
            else
              InputDecorator(
                decoration: const InputDecoration(labelText: 'Type'),
                child: Text(kindLabel(_kind)),
              ),
            if (_kind == 'box') ...[
              const SizedBox(height: 12),
              TextField(
                controller: _boxLabel,
                maxLength: 120,
                decoration: const InputDecoration(
                  labelText: 'What is this box for?',
                  hintText: 'e.g. USB-A to C cables',
                  helperText: 'A box gets its own QR code.',
                ),
              ),
            ],
            const SizedBox(height: 16),
            Text('Photo', style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 8),
            if (_photoData != null)
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.memory(
                  base64Decode(_photoData!.split(',').last),
                  height: 120,
                  fit: BoxFit.contain,
                ),
              )
            else if (keepsCurrent)
              LocationPhoto(location: existing, height: 120),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: () => _pick(ImageSource.camera),
                  icon: const Icon(Icons.photo_camera_outlined, size: 18),
                  label: const Text('Camera'),
                ),
                OutlinedButton.icon(
                  onPressed: () => _pick(ImageSource.gallery),
                  icon: const Icon(Icons.photo_library_outlined, size: 18),
                  label: const Text('Gallery'),
                ),
                if (_photoData != null || keepsCurrent)
                  TextButton.icon(
                    onPressed: _clear,
                    icon: const Icon(Icons.close, size: 18),
                    label: const Text('Clear'),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _link,
              decoration: const InputDecoration(
                labelText: '…or paste an image link',
                hintText: 'https://…/photo.jpg',
              ),
              // Typing a link means the stored upload should go, otherwise the
              // API keeps preferring the file and the link never shows.
              onChanged: (v) => setState(() {
                if (v.trim().isNotEmpty) {
                  _photoData = null;
                  _clearPhoto = true;
                }
              }),
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
        FilledButton(
          onPressed: () {
            final name = _name.text.trim();
            if (name.isEmpty) {
              setState(() => _error = 'Name is required.');
              return;
            }
            Navigator.pop(
              context,
              LocationDraft(
                name: name,
                photoData: _photoData,
                photoUrl: _link.text.trim(),
                clearPhoto: _clearPhoto,
                kind: _kind,
                label: _boxLabel.text.trim(),
              ),
            );
          },
          child: const Text('Save'),
        ),
      ],
    );
  }
}
