import 'package:flutter/material.dart';

import '../config/api_client.dart';

/// Where a picture's bytes come from.
///
/// An upload is served by the API and needs the auth header; otherwise the
/// external link is fetched directly. An upload wins over a link, matching the
/// API, so a stale link never shows under a newer file. Null when neither.
String? photoSrc({
  required String kind, // 'items' or 'locations'
  required String id,
  required bool hasPhoto,
  String? photoUrl,
}) {
  if (hasPhoto) return ApiClient.instance.urlFor('/$kind/$id/photo');
  return (photoUrl != null && photoUrl.isNotEmpty) ? photoUrl : null;
}

/// The picture panel shared by items (0034) and locations (0036).
///
/// `BoxFit.contain`, not cover: the photo is here so the thing can be
/// recognised, and cropping removes exactly the part that distinguishes it.
/// A dead link falls back to a placeholder instead of a broken image.
class NetworkPhoto extends StatelessWidget {
  const NetworkPhoto({
    super.key,
    required this.src,
    required this.needsAuth,
    required this.emptyLabel,
    this.height = 200,
  });

  final String? src;
  /// Uploads come from the API, so they carry the session token.
  final bool needsAuth;
  final String emptyLabel;
  final double height;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    Widget placeholder(IconData icon, String label) => Container(
          height: height,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 28, color: scheme.onSurfaceVariant),
              const SizedBox(height: 6),
              Text(label, style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
            ],
          ),
        );

    final url = src;
    if (url == null) return placeholder(Icons.image_outlined, emptyLabel);

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Image.network(
        url,
        headers: needsAuth ? ApiClient.instance.authHeaders : null,
        height: height,
        width: double.infinity,
        fit: BoxFit.contain,
        errorBuilder: (_, __, ___) =>
            placeholder(Icons.broken_image_outlined, 'Photo failed to load'),
      ),
    );
  }
}

/// Small square for lists — same resolution order, no message.
class NetworkThumb extends StatelessWidget {
  const NetworkThumb({
    super.key,
    required this.src,
    required this.needsAuth,
    this.size = 56,
    this.showFallback = true,
  });

  final String? src;
  final bool needsAuth;
  final double size;

  /// Whether an empty slot draws the grey square-with-icon. False draws
  /// nothing — but the slot still takes up its space, so a row is the same
  /// height whether or not the thing in it has a picture.
  final bool showFallback;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fallback = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Icon(Icons.image_outlined, size: size * 0.5, color: scheme.onSurfaceVariant),
    );

    final empty = showFallback ? fallback : SizedBox(width: size, height: size);

    final url = src;
    if (url == null) return empty;

    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Image.network(
        url,
        headers: needsAuth ? ApiClient.instance.authHeaders : null,
        width: size,
        height: size,
        fit: BoxFit.contain,
        errorBuilder: (_, __, ___) => empty,
      ),
    );
  }
}
