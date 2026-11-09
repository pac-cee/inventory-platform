import 'package:flutter/material.dart';

import '../../models.dart';
import '../../widgets/network_photo.dart';

String? _src(Location loc) => photoSrc(
      kind: 'locations',
      id: loc.id,
      hasPhoto: loc.hasPhoto,
      photoUrl: loc.photoUrl,
    );

/// The location's picture (0036).
///
/// Every level gets one — a room and a shelf inside it each have their own — so
/// someone looking for a thing can recognise the place before reading the name.
class LocationPhoto extends StatelessWidget {
  const LocationPhoto({super.key, required this.location, this.height = 200});

  final Location location;
  final double height;

  @override
  Widget build(BuildContext context) => NetworkPhoto(
        src: _src(location),
        needsAuth: location.hasPhoto,
        emptyLabel: 'No photo for this location yet',
        height: height,
      );
}

/// Small square for location lists. Falls back to nothing rather than a grey
/// square, so a location without a picture keeps its old look.
class LocationThumb extends StatelessWidget {
  const LocationThumb({super.key, required this.location, this.size = 56, this.showFallback = false});

  final Location location;
  final double size;
  final bool showFallback;

  @override
  Widget build(BuildContext context) => NetworkThumb(
        src: _src(location),
        needsAuth: location.hasPhoto,
        size: size,
        showFallback: showFallback,
      );
}
