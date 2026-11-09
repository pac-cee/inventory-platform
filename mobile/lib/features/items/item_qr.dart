import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';

import '../../models.dart';

/// QR payload for an item. Prefixed so the scanner can tell our codes apart
/// from arbitrary QR content.
const _prefix = 'inventory:item:';

String itemQrData(String itemId) => '$_prefix$itemId';

/// Extract an item id from a scanned QR value. Accepts our prefixed payload or
/// a bare id, and returns null for anything else.
String? parseItemQr(String raw) {
  final value = raw.trim();
  if (value.startsWith(_prefix)) {
    final id = value.substring(_prefix.length).trim();
    return id.isEmpty ? null : id;
  }
  // Tolerate a bare UUID (e.g. a code generated elsewhere).
  if (RegExp(r'^[0-9a-fA-F-]{32,40}$').hasMatch(value)) return value;
  return null;
}

/// Render the item's QR code to a PNG (black on a white background, so it stays
/// scannable wherever it's opened). Returns null if rendering fails.
Future<Uint8List?> renderItemQrPng(String itemId, {double size = 600}) =>
    renderQrPng(itemQrData(itemId), size: size);

/// The same rendering for any payload (items and boxes share it).
Future<Uint8List?> renderQrPng(String payload, {double size = 600}) async {
  final painter = QrPainter(
    data: payload,
    version: QrVersions.auto,
    gapless: true,
  );
  const pad = 48.0;
  final total = size + pad * 2;

  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  canvas.drawRect(
    Rect.fromLTWH(0, 0, total, total),
    Paint()..color = Colors.white,
  );
  canvas.translate(pad, pad);
  painter.paint(canvas, Size(size, size));

  final picture = recorder.endRecording();
  final image = await picture.toImage(total.toInt(), total.toInt());
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  return data?.buffer.asUint8List();
}

/// Export the item's QR code as a PNG through the system share sheet (Save to
/// Files / Photos, send, etc.). Available to everyone — admins and members.
Future<void> downloadItemQr(BuildContext context, Item item) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final png = await renderItemQrPng(item.id);
    if (png == null) {
      messenger.showSnackBar(const SnackBar(content: Text('Could not generate the QR image.')));
      return;
    }
    final safe = (item.sku.isNotEmpty ? item.sku : item.name)
        .replaceAll(RegExp(r'[^A-Za-z0-9_-]+'), '-');
    await Share.shareXFiles(
      [XFile.fromData(png, mimeType: 'image/png', name: 'qr-$safe.png')],
      subject: 'QR code · ${item.name}',
      text: 'QR code for ${item.name}',
      fileNameOverrides: ['qr-$safe.png'],
    );
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text('Could not export QR: $e')));
  }
}

/// Show a printable/scannable QR code for [item] in a dialog, with a button to
/// download/share it as a PNG.
Future<void> showItemQrDialog(BuildContext context, Item item) {
  return showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(item.name),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
            ),
            child: QrImageView(
              data: itemQrData(item.id),
              version: QrVersions.auto,
              size: 220,
              backgroundColor: Colors.white,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            item.sku.isNotEmpty ? 'SKU ${item.sku}' : 'No SKU',
            style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 4),
          Text(
            'Scan from the Home tab to open this item.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
        FilledButton.icon(
          onPressed: () => downloadItemQr(context, item),
          icon: const Icon(Icons.download_outlined, size: 18),
          label: const Text('Download'),
        ),
      ],
    ),
  );
}
