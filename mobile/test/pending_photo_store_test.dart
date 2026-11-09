// PendingPhotoStore finishes a camera upload after Android killed the app. These
// pin the marker's life (save, expire, consume) and what the person is told.

import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

import 'package:inventory_mobile/pending_photo_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory dir;

  setUp(() {
    dir = Directory.systemTemp.createTempSync('pending_photo_test');
    PendingPhotoStore.directoryOverride = dir.path;
  });
  tearDown(() {
    PendingPhotoStore.directoryOverride = null;
    dir.deleteSync(recursive: true);
  });

  final bytes = Uint8List.fromList([1, 2, 3]);

  test('nothing saved means nothing to do (a normal start)', () async {
    var asked = false;
    final text = await PendingPhotoStore.recover(
      fetchLostPhoto: () async {
        asked = true;
        return bytes;
      },
      upload: (_, __) async {},
    );
    expect(text, isNull);
    expect(asked, isFalse); // Android is not even asked
  });

  test('a saved receipt is recovered and uploaded to the right payment', () async {
    await PendingPhotoStore.save(PendingPhotoKind.receipt, 'pay-1');
    PendingPhoto? got;
    Uint8List? sent;
    final text = await PendingPhotoStore.recover(
      fetchLostPhoto: () async => bytes,
      upload: (m, b) async {
        got = m;
        sent = b;
      },
    );
    expect(text, contains('Recovered your receipt photo'));
    expect((got!.kind, got!.id), (PendingPhotoKind.receipt, 'pay-1'));
    expect(sent, bytes);
  });

  test('the marker is consumed, so a second restart does not repeat the upload', () async {
    await PendingPhotoStore.save(PendingPhotoKind.itemPhoto, 'item-1');
    await PendingPhotoStore.recover(fetchLostPhoto: () async => bytes, upload: (_, __) async {});
    expect(await PendingPhotoStore.load(), isNull);
  });

  test('if Android has no photo, say it was lost and ask for it again', () async {
    await PendingPhotoStore.save(PendingPhotoKind.itemPhoto, 'item-1');
    var uploaded = false;
    final text = await PendingPhotoStore.recover(
      fetchLostPhoto: () async => null,
      upload: (_, __) async => uploaded = true,
    );
    expect(text, contains('item photo was lost'));
    expect(uploaded, isFalse);
  });

  test('a failed upload is reported, not swallowed', () async {
    await PendingPhotoStore.save(PendingPhotoKind.receipt, 'pay-1');
    final text = await PendingPhotoStore.recover(
      fetchLostPhoto: () async => bytes,
      upload: (_, __) async => throw Exception('offline'),
    );
    expect(text, allOf(contains('could not upload'), contains('offline')));
  });

  test('a lookup that throws counts as lost', () async {
    await PendingPhotoStore.save(PendingPhotoKind.receipt, 'pay-1');
    final text = await PendingPhotoStore.recover(
      fetchLostPhoto: () async => throw StateError('boom'),
      upload: (_, __) async {},
    );
    expect(text, contains('lost'));
  });

  test('a stale marker is ignored and removed', () async {
    File('${dir.path}/verlet_pending_photo.json').writeAsStringSync(
      '{"kind":"receipt","id":"pay-1","savedAt":"${DateTime.now().subtract(const Duration(hours: 3)).toIso8601String()}"}',
    );
    expect(await PendingPhotoStore.load(), isNull);
    expect(File('${dir.path}/verlet_pending_photo.json').existsSync(), isFalse);
  });

  test('a corrupt marker is discarded rather than crashing startup', () async {
    File('${dir.path}/verlet_pending_photo.json').writeAsStringSync('{not json');
    expect(await PendingPhotoStore.load(), isNull);
  });

  test('clear removes the marker (the camera returned normally)', () async {
    await PendingPhotoStore.save(PendingPhotoKind.receipt, 'pay-1');
    await PendingPhotoStore.clear();
    expect(await PendingPhotoStore.load(), isNull);
  });
}
