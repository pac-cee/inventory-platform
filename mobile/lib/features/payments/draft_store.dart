// Survives Android killing the app while the camera is open.
//
// On a phone short of memory (3-4 GB devices, or any debug build) opening the
// camera can get the app's process killed in the background. When the user
// comes back the app starts fresh at the Home tab — the half-filled payment
// request is gone and the photo they just took is lost.
//
// So before the camera is launched the sheet writes everything it holds to a
// small JSON file in the app's cache. On the next start MainShell calls
// [DraftStore.restoreAfterProcessDeath]: it reads that file, asks Android for
// the photo that was taken (ImagePicker.retrieveLostData), and publishes the
// result on [DraftStore.resume] so the shell can jump to Payments and the
// payments screen can reopen the form exactly where the user left it.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';

import '../../models.dart';

/// Everything the "New Expense Request" form holds, as plain data.
class RequestSnapshot {
  const RequestSnapshot({
    this.paymentMethod = 'momo',
    this.bkPayToBankAccount = false,
    this.phone = '',
    this.recipientName = '',
    this.bankAccountNumber = '',
    this.bankAccountName = '',
    this.tinNumber = '',
    this.name = '',
    this.type = '',
    this.model = '',
    this.specification = '',
    this.quantity = '1',
    this.price = '',
    this.category = '',
    this.finishable = false,
    this.countMode = 'units',
    this.unitsPerContainer = '1',
    this.packageLabel = 'package',
    this.locationId,
    this.isCustomProduct = false,
    this.cart = const [],
    this.itemPhotoBase64,
    this.cameraPending = false,
    this.savedAt,
  });

  final String paymentMethod;
  final bool bkPayToBankAccount;
  final String phone;
  final String recipientName;
  final String bankAccountNumber;
  final String bankAccountName;
  final String tinNumber;
  final String name;
  /// What kind of thing it is ("Cable") and its model — together with the name they
  /// identify a new item; the SKU is assigned by the system, never typed.
  final String type;
  final String model;
  final String specification;
  final String quantity;
  final String price;
  final String category;
  final bool finishable;
  final String countMode;
  final String unitsPerContainer;
  final String packageLabel;
  final String? locationId;
  final bool isCustomProduct;
  final List<PaymentProduct> cart;
  final String? itemPhotoBase64;

  /// True when the snapshot was taken just before opening the camera — the
  /// photo may be waiting in Android's lost-data store.
  final bool cameraPending;
  final DateTime? savedAt;

  RequestSnapshot withPhoto(String? dataUrl) => RequestSnapshot(
        paymentMethod: paymentMethod,
        bkPayToBankAccount: bkPayToBankAccount,
        phone: phone,
        recipientName: recipientName,
        bankAccountNumber: bankAccountNumber,
        bankAccountName: bankAccountName,
        tinNumber: tinNumber,
        name: name,
        type: type,
        model: model,
        specification: specification,
        quantity: quantity,
        price: price,
        category: category,
        finishable: finishable,
        countMode: countMode,
        unitsPerContainer: unitsPerContainer,
        packageLabel: packageLabel,
        locationId: locationId,
        isCustomProduct: isCustomProduct,
        cart: cart,
        itemPhotoBase64: dataUrl,
        cameraPending: cameraPending,
        savedAt: savedAt,
      );

  Map<String, dynamic> toJson() => {
        'paymentMethod': paymentMethod,
        'bkPayToBankAccount': bkPayToBankAccount,
        'phone': phone,
        'recipientName': recipientName,
        'bankAccountNumber': bankAccountNumber,
        'bankAccountName': bankAccountName,
        'tinNumber': tinNumber,
        'name': name,
        'type': type,
        'model': model,
        'specification': specification,
        'quantity': quantity,
        'price': price,
        'category': category,
        'finishable': finishable,
        'countMode': countMode,
        'unitsPerContainer': unitsPerContainer,
        'packageLabel': packageLabel,
        'locationId': locationId,
        'isCustomProduct': isCustomProduct,
        'cart': [
          for (final p in cart)
            {
              'name': p.name,
              'type': p.type,
              'model': p.model,
              'sku': p.sku,
              'specification': p.specification,
              'description': p.description,
              'quantity': p.quantity,
              'price': p.price,
              'imageBase64': p.imageBase64,
            }
        ],
        'itemPhotoBase64': itemPhotoBase64,
        'cameraPending': cameraPending,
        'savedAt': (savedAt ?? DateTime.now()).toIso8601String(),
      };

  factory RequestSnapshot.fromJson(Map<String, dynamic> j) => RequestSnapshot(
        paymentMethod: j['paymentMethod'] as String? ?? 'momo',
        bkPayToBankAccount: j['bkPayToBankAccount'] as bool? ?? false,
        phone: j['phone'] as String? ?? '',
        recipientName: j['recipientName'] as String? ?? '',
        bankAccountNumber: j['bankAccountNumber'] as String? ?? '',
        bankAccountName: j['bankAccountName'] as String? ?? '',
        tinNumber: j['tinNumber'] as String? ?? '',
        name: j['name'] as String? ?? '',
        type: j['type'] as String? ?? '',
        model: j['model'] as String? ?? '',
        specification: j['specification'] as String? ?? '',
        quantity: j['quantity'] as String? ?? '1',
        price: j['price'] as String? ?? '',
        category: j['category'] as String? ?? '',
        finishable: j['finishable'] as bool? ?? false,
        countMode: j['countMode'] as String? ?? 'units',
        unitsPerContainer: j['unitsPerContainer'] as String? ?? '1',
        packageLabel: j['packageLabel'] as String? ?? 'package',
        locationId: j['locationId'] as String?,
        isCustomProduct: j['isCustomProduct'] as bool? ?? false,
        cart: [
          for (final p in (j['cart'] as List? ?? const []))
            PaymentProduct(
              name: (p as Map)['name'] as String,
              type: p['type'] as String?,
              model: p['model'] as String?,
              sku: p['sku'] as String?,
              specification: p['specification'] as String?,
              description: p['description'] as String?,
              quantity: (p['quantity'] as num).toInt(),
              price: (p['price'] as num).toDouble(),
              imageBase64: p['imageBase64'] as String?,
            )
        ],
        itemPhotoBase64: j['itemPhotoBase64'] as String?,
        cameraPending: j['cameraPending'] as bool? ?? false,
        savedAt: DateTime.tryParse(j['savedAt'] as String? ?? ''),
      );
}

class DraftStore {
  DraftStore._();

  /// A restored request waiting to be reopened. MainShell reacts by switching
  /// to the Payments tab; PaymentsScreen reacts by opening the form.
  static final ValueNotifier<RequestSnapshot?> resume = ValueNotifier(null);

  /// Overridable so tests can point it at a temp folder.
  @visibleForTesting
  static String? directoryOverride;

  /// A snapshot older than this is stale (the user has moved on).
  static const maxAge = Duration(hours: 2);

  static File get _file => File(
      '${directoryOverride ?? Directory.systemTemp.path}/verlet_request_draft.json');

  static Future<void> save(RequestSnapshot snapshot) async {
    try {
      await _file.writeAsString(jsonEncode(snapshot.toJson()), flush: true);
    } catch (e) {
      // Best effort — losing the safety net must never block the camera.
      debugPrint('[DraftStore] save failed: $e');
    }
  }

  static Future<RequestSnapshot?> load() async {
    try {
      final f = _file;
      if (!await f.exists()) return null;
      final snap = RequestSnapshot.fromJson(
          jsonDecode(await f.readAsString()) as Map<String, dynamic>);
      final saved = snap.savedAt;
      if (saved != null && DateTime.now().difference(saved) > maxAge) {
        await clear();
        return null;
      }
      return snap;
    } catch (e) {
      debugPrint('[DraftStore] load failed (discarding): $e');
      await clear();
      return null;
    }
  }

  static Future<void> clear() async {
    try {
      final f = _file;
      if (await f.exists()) await f.delete();
    } catch (_) {}
  }

  /// Call once at startup (after sign-in). If the previous run was killed while
  /// the camera was open, recovers the form and the photo and publishes them on
  /// [resume]. Does nothing on a normal start.
  static Future<void> restoreAfterProcessDeath() async {
    var snap = await load();
    if (snap == null) return;
    // Consume it: a second restart must not reopen the same form again.
    await clear();
    if (snap.cameraPending) {
      try {
        final lost = await ImagePicker().retrieveLostData();
        final files = lost.files;
        if (!lost.isEmpty && files != null && files.isNotEmpty) {
          final bytes = await files.first.readAsBytes();
          snap = snap.withPhoto('data:image/jpeg;base64,${base64Encode(bytes)}');
        }
      } catch (e) {
        debugPrint('[DraftStore] retrieveLostData failed: $e');
      }
    }
    resume.value = snap;
  }
}
