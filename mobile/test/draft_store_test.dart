// DraftStore keeps the half-filled payment request alive when Android kills the
// app while the camera is open. These pin the save/restore behaviour.

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:inventory_mobile/features/payments/draft_store.dart';
import 'package:inventory_mobile/models.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory dir;

  setUp(() {
    dir = Directory.systemTemp.createTempSync('draft_store_test');
    DraftStore.directoryOverride = dir.path;
    DraftStore.resume.value = null;
  });

  tearDown(() {
    DraftStore.directoryOverride = null;
    dir.deleteSync(recursive: true);
  });

  RequestSnapshot sample({bool cameraPending = false, DateTime? savedAt}) =>
      RequestSnapshot(
        paymentMethod: 'bk',
        bkPayToBankAccount: true,
        phone: '0788123456',
        bankAccountNumber: '100081234567',
        bankAccountName: 'Test Vendor',
        tinNumber: '123456789',
        name: 'Raspberry Pi 5',
        type: 'Single-board computer',
        model: 'Pi 5',
        specification: '8GB',
        quantity: '3',
        price: '85000',
        locationId: 'loc-1',
        cart: [
          PaymentProduct(
              name: 'Lenovo Laptop',
              quantity: 1,
              price: 2000000,
              sku: 'LEN-1',
              imageBase64: 'data:image/jpeg;base64,AAAA'),
        ],
        itemPhotoBase64: 'data:image/jpeg;base64,BBBB',
        cameraPending: cameraPending,
        savedAt: savedAt ?? DateTime.now(),
      );

  test('a saved request round-trips, including the cart and photos', () async {
    await DraftStore.save(sample(cameraPending: true));
    final back = (await DraftStore.load())!;
    expect(back.cameraPending, isTrue);
    expect(back.paymentMethod, 'bk');
    expect(back.bkPayToBankAccount, isTrue);
    expect(back.phone, '0788123456');
    expect(back.bankAccountName, 'Test Vendor');
    expect(back.name, 'Raspberry Pi 5');
    expect(back.quantity, '3');
    expect(back.locationId, 'loc-1');
    expect(back.itemPhotoBase64, 'data:image/jpeg;base64,BBBB');
    expect(back.cart, hasLength(1));
    expect(back.cart.first.name, 'Lenovo Laptop');
    expect(back.cart.first.price, 2000000);
    expect(back.cart.first.imageBase64, 'data:image/jpeg;base64,AAAA');
  });

  test('nothing saved means nothing to restore', () async {
    expect(await DraftStore.load(), isNull);
    await DraftStore.restoreAfterProcessDeath();
    expect(DraftStore.resume.value, isNull);
  });

  test('clear removes the snapshot', () async {
    await DraftStore.save(sample());
    await DraftStore.clear();
    expect(await DraftStore.load(), isNull);
  });

  test('a snapshot older than the max age is discarded', () async {
    await DraftStore.save(
        sample(savedAt: DateTime.now().subtract(DraftStore.maxAge + const Duration(minutes: 1))));
    expect(await DraftStore.load(), isNull);
  });

  test('a corrupt file is discarded instead of crashing startup', () async {
    File('${dir.path}/verlet_request_draft.json').writeAsStringSync('{not json');
    expect(await DraftStore.load(), isNull);
    expect(File('${dir.path}/verlet_request_draft.json').existsSync(), isFalse);
  });

  test('restore publishes the form once and consumes the file', () async {
    // cameraPending false: no platform call to the (absent) image picker.
    await DraftStore.save(sample(cameraPending: false));
    await DraftStore.restoreAfterProcessDeath();
    expect(DraftStore.resume.value, isNotNull);
    expect(DraftStore.resume.value!.name, 'Raspberry Pi 5');

    // A second restart must not reopen the same form.
    DraftStore.resume.value = null;
    await DraftStore.restoreAfterProcessDeath();
    expect(DraftStore.resume.value, isNull);
  });

  test('restore still works when the lost photo cannot be fetched', () async {
    // cameraPending true: the picker plugin is not available under test, so the
    // photo retrieval throws — the form must still come back (photo kept as saved).
    await DraftStore.save(sample(cameraPending: true));
    await DraftStore.restoreAfterProcessDeath();
    expect(DraftStore.resume.value, isNotNull);
    expect(DraftStore.resume.value!.itemPhotoBase64, 'data:image/jpeg;base64,BBBB');
  });

  test('withPhoto replaces only the photo', () {
    final s = sample().withPhoto('data:image/jpeg;base64,NEW');
    expect(s.itemPhotoBase64, 'data:image/jpeg;base64,NEW');
    expect(s.name, 'Raspberry Pi 5');
    expect(jsonDecode(jsonEncode(s.toJson()))['cart'], hasLength(1));
  });

  group('recipient name', () {
    test('survives the snapshot round trip', () {
      final snap = RequestSnapshot(paymentMethod: 'bk', phone: '0788123456', recipientName: 'Amina Uwase');
      final back = RequestSnapshot.fromJson(snap.toJson());
      expect(back.recipientName, 'Amina Uwase');
      expect(snap.withPhoto('data:image/jpeg;base64,AA').recipientName, 'Amina Uwase');
    });
    test('an older saved draft with no name restores as empty', () {
      expect(RequestSnapshot.fromJson({'phone': '0788123456'}).recipientName, '');
    });
  });
}
