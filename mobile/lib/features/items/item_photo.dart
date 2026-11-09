import 'package:flutter/material.dart';

import '../../models.dart';
import '../../widgets/network_photo.dart';

String? _src(Item item) =>
    photoSrc(kind: 'items', id: item.id, hasPhoto: item.hasPhoto, photoUrl: item.photoUrl);

/// The item's picture.
class ItemPhoto extends StatelessWidget {
  const ItemPhoto({super.key, required this.item, this.height = 200});

  final Item item;
  final double height;

  @override
  Widget build(BuildContext context) => NetworkPhoto(
        src: _src(item),
        needsAuth: item.hasPhoto,
        emptyLabel: 'No photo yet',
        height: height,
      );
}

/// Small square for lists — same resolution order, no message.
class ItemThumb extends StatelessWidget {
  const ItemThumb({super.key, required this.item, this.size = 56});

  final Item item;
  final double size;

  @override
  Widget build(BuildContext context) =>
      NetworkThumb(src: _src(item), needsAuth: item.hasPhoto, size: size);
}
