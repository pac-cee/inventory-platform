import 'package:flutter/material.dart';

import '../config/theme.dart';

/// A number with a label. With a [tone] (a StatusColors colour) the whole tile is
/// tinted — used to make "Needs restock" catch the eye when something is out or low.
class StatCard extends StatelessWidget {
  const StatCard({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.caption,
    this.tone,
    this.onTap,
  });

  final String label;
  final String value;
  final IconData icon;

  /// A small line under the number ("3 out · 5 low").
  final String? caption;
  final Color? tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final muted = cs.onSurfaceVariant;
    final t = tone;
    final Color? accent = t != null ? StatusColors.text(context, t) : null;
    return Card(
      color: tone?.withValues(alpha: 0.12),
      shape: tone == null
          ? null
          : RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: BorderSide(color: tone!.withValues(alpha: 0.5)),
            ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Flexible(child: Text(label, style: TextStyle(fontSize: 13, color: accent ?? muted))),
                  Icon(icon, size: 16, color: accent ?? muted),
                ],
              ),
              const SizedBox(height: 6),
              Text(value, style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: accent)),
              if (caption != null)
                Text(caption!, style: TextStyle(fontSize: 12, color: accent ?? muted), maxLines: 1, overflow: TextOverflow.ellipsis),
            ],
          ),
        ),
      ),
    );
  }
}

/// Stat tiles in two columns whose height follows their content.
///
/// A GridView with a fixed width-to-height ratio clipped the tiles by a pixel or
/// two on narrower phones and larger text sizes (the tile's content has a fixed
/// minimum height, but the ratio makes its height depend on the screen's width).
/// Each row here is as tall as its tallest tile, so nothing can overflow.
class StatGrid extends StatelessWidget {
  const StatGrid({super.key, required this.children, this.spacing = 12});

  final List<Widget> children;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < children.length; i += 2) {
      if (rows.isNotEmpty) rows.add(SizedBox(height: spacing));
      rows.add(IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(child: children[i]),
            SizedBox(width: spacing),
            Expanded(child: i + 1 < children.length ? children[i + 1] : const SizedBox.shrink()),
          ],
        ),
      ));
    }
    return Column(children: rows);
  }
}
