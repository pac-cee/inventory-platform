import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../items/item_detail_screen.dart';
import '../../box_qr.dart';
import '../../repository.dart';
import '../items/item_qr.dart';
import '../locations/location_detail_screen.dart';

/// Full-screen camera scanner. An item QR code opens that item; a box QR code
/// opens that box and what is in it.
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final MobileScannerController _controller = MobileScannerController();
  bool _handled = false;

  void _onDetect(BarcodeCapture capture) {
    if (_handled) return;
    for (final barcode in capture.barcodes) {
      final raw = barcode.rawValue;
      if (raw == null) continue;
      final id = parseItemQr(raw);
      if (id != null) {
        _handled = true;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => ItemDetailScreen(itemId: id)),
        );
        return;
      }
      final token = parseBoxQr(raw);
      if (token != null) {
        _handled = true;
        _openBox(token);
        return;
      }
    }
  }

  Future<void> _openBox(String token) async {
    try {
      final locationId = await const InventoryRepository().fetchBoxLocationId(token);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => LocationDetailScreen(locationId: locationId)),
      );
    } catch (e) {
      if (!mounted) return;
      // Say what happened (an unknown or unreadable sticker) and let them scan again.
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      _handled = false;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan item or box QR')),
      body: Stack(
        alignment: Alignment.center,
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
            errorBuilder: (context, error) => _ScanError(error: error),
          ),
          IgnorePointer(
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white70, width: 2),
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          const Positioned(
            left: 16,
            right: 16,
            bottom: 32,
            child: Text(
              "Point the camera at an item's QR code",
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white, fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}

/// What to show when the camera will not start.
///
/// The previous version printed the raw platform message and then, on every
/// platform, "On desktop there may be no camera". On a phone that is actively
/// misleading — it points at hardware when the cause is usually a denied
/// permission or a minified release build that stripped ML Kit. Each cause now
/// gets the sentence that actually helps, and the raw detail is kept but
/// demoted, since it is for us rather than the person holding the phone.
class _ScanError extends StatelessWidget {
  const _ScanError({required this.error});

  final MobileScannerException error;

  bool get _isMobile =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  ({String title, String advice}) get _explained {
    switch (error.errorCode) {
      case MobileScannerErrorCode.permissionDenied:
        return (
          title: 'Camera permission denied',
          advice: _isMobile
              ? 'Open Settings → Apps → Inventory → Permissions and allow Camera, '
                  'then come back and try again.'
              : 'Grant camera access to this app, then try again.',
        );
      case MobileScannerErrorCode.unsupported:
        return (
          title: 'Scanning is not supported here',
          advice: _isMobile
              ? 'This device does not expose a usable camera.'
              : 'Desktop builds often have no camera — use the phone app.',
        );
      default:
        return (
          title: 'Camera could not start',
          advice: _isMobile
              ? 'Close and reopen the app. If it keeps failing, send this '
                  'screen to the team — the detail below identifies the cause.'
              : 'Desktop builds often have no camera — use the phone app.',
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final e = _explained;
    final detail = error.errorDetails?.message;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.no_photography_outlined, size: 40, color: scheme.error),
            const SizedBox(height: 12),
            Text(
              e.title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Text(e.advice, textAlign: TextAlign.center),
            if (detail != null && detail.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(
                detail,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
