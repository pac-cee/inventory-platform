// Survives Android killing the app while the camera is open, for the photo flows
// that upload straight away to something that already exists (an item's photo, a
// payment's receipt). DraftStore does the same for the half-filled payment form.
//
// Before the camera opens we write a tiny marker ("receipt for payment X") to the
// cache. If the process dies, the next start finds the marker, asks Android for
// the photo that was taken (ImagePicker.retrieveLostData) and finishes the upload,
// so the person is told "recovered" instead of silently losing the picture.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';

enum PendingPhotoKind { itemPhoto, receipt }

class PendingPhoto {
  const PendingPhoto(this.kind, this.id, this.savedAt);
  final PendingPhotoKind kind;
  final String id;
  final DateTime savedAt;

  Map<String, dynamic> toJson() => {'kind': kind.name, 'id': id, 'savedAt': savedAt.toIso8601String()};

  static PendingPhoto? fromJson(Map<String, dynamic> j) {
    final kind = PendingPhotoKind.values.where((k) => k.name == j['kind']).firstOrNull;
    final id = j['id'] as String?;
    final saved = DateTime.tryParse(j['savedAt'] as String? ?? '');
    if (kind == null || id == null || id.isEmpty || saved == null) return null;
    return PendingPhoto(kind, id, saved);
  }
}

class PendingPhotoStore {
  PendingPhotoStore._();

  /// What happened on this start ("Receipt photo recovered and uploaded."), for the
  /// shell to show once. Null when there was nothing to recover.
  static final ValueNotifier<String?> message = ValueNotifier(null);

  @visibleForTesting
  static String? directoryOverride;

  /// A marker older than this is stale (the person has moved on).
  static const maxAge = Duration(hours: 2);

  static File get _file => File('${directoryOverride ?? Directory.systemTemp.path}/verlet_pending_photo.json');

  /// Call just before opening the camera. Best effort: never blocks the camera.
  static Future<void> save(PendingPhotoKind kind, String id) async {
    try {
      await _file.writeAsString(jsonEncode(PendingPhoto(kind, id, DateTime.now()).toJson()), flush: true);
    } catch (e) {
      debugPrint('[PendingPhotoStore] save failed: $e');
    }
  }

  /// Call once the camera returned normally (photo taken or cancelled).
  static Future<void> clear() async {
    try {
      final f = _file;
      if (await f.exists()) await f.delete();
    } catch (_) {}
  }

  static Future<PendingPhoto?> load() async {
    try {
      final f = _file;
      if (!await f.exists()) return null;
      final p = PendingPhoto.fromJson(jsonDecode(await f.readAsString()) as Map<String, dynamic>);
      if (p == null || DateTime.now().difference(p.savedAt) > maxAge) {
        await clear();
        return null;
      }
      return p;
    } catch (e) {
      debugPrint('[PendingPhotoStore] load failed (discarding): $e');
      await clear();
      return null;
    }
  }

  /// The testable core: given the marker, fetch the lost photo and finish the job.
  /// Returns what to tell the person, or null if there was nothing to do.
  static Future<String?> recover({
    required Future<Uint8List?> Function() fetchLostPhoto,
    required Future<void> Function(PendingPhoto marker, Uint8List bytes) upload,
  }) async {
    final marker = await load();
    if (marker == null) return null;
    // Consume it: a second restart must not retry the same upload.
    await clear();
    final what = marker.kind == PendingPhotoKind.receipt ? 'receipt' : 'item';
    Uint8List? bytes;
    try {
      bytes = await fetchLostPhoto();
    } catch (e) {
      debugPrint('[PendingPhotoStore] retrieveLostData failed: $e');
    }
    if (bytes == null || bytes.isEmpty) {
      return 'The app restarted while the camera was open, so the $what photo was lost. Please take it again.';
    }
    try {
      await upload(marker, bytes);
      return 'Recovered your $what photo after the app restarted and uploaded it.';
    } catch (e) {
      return 'Recovered your $what photo but could not upload it ($e). Please take it again.';
    }
  }

  /// Call once at startup (after sign-in) with the real picker and uploaders.
  static Future<void> restoreAfterProcessDeath({
    required Future<void> Function(String itemId, String dataUrl) uploadItemPhoto,
    required Future<void> Function(String paymentId, Uint8List bytes) uploadReceipt,
  }) async {
    final text = await recover(
      fetchLostPhoto: () async {
        final lost = await ImagePicker().retrieveLostData();
        final files = lost.files;
        if (lost.isEmpty || files == null || files.isEmpty) return null;
        return files.first.readAsBytes();
      },
      upload: (m, bytes) => m.kind == PendingPhotoKind.receipt
          ? uploadReceipt(m.id, bytes)
          : uploadItemPhoto(m.id, 'data:image/jpeg;base64,${base64Encode(bytes)}'),
    );
    if (text != null) message.value = text;
  }
}
