import 'package:flutter/material.dart';

/// A titled card. Pass [collapsible] for a card that only opens when asked (a "Move to another
/// location" list, a long activity history): the header becomes a button that shows or hides the
/// body, and [summary] says what is inside while it is closed ("6 places").
///
/// Collapsible cards need a stable `key` where they sit among conditional siblings, so each keeps
/// its own open/closed state when the list around it changes.
class SectionCard extends StatefulWidget {
  const SectionCard({
    super.key,
    required this.title,
    required this.child,
    this.trailing,
    this.collapsible = false,
    this.initiallyExpanded = true,
    this.summary,
  });

  final String title;
  final Widget child;
  final Widget? trailing;

  /// The header toggles the body.
  final bool collapsible;

  /// Only used when [collapsible]; plain cards are always open.
  final bool initiallyExpanded;

  /// Shown beside the title while a collapsible card is closed.
  final String? summary;

  @override
  State<SectionCard> createState() => _SectionCardState();
}

class _SectionCardState extends State<SectionCard> {
  late bool _open = !widget.collapsible || widget.initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final showBody = !widget.collapsible || _open;

    final header = Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Row(
        children: [
          Flexible(
            child: Text(widget.title, style: const TextStyle(fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          if (widget.collapsible && !_open && widget.summary != null) ...[
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                widget.summary!,
                style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
          const Spacer(),
          if (widget.trailing != null) widget.trailing!,
          if (widget.collapsible) ...[
            const SizedBox(width: 4),
            Icon(_open ? Icons.expand_less : Icons.expand_more, color: cs.onSurfaceVariant),
          ],
        ],
      ),
    );

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.collapsible)
            Semantics(
              button: true,
              expanded: _open,
              label: '${widget.title}, ${_open ? 'open' : 'closed'}',
              child: InkWell(onTap: () => setState(() => _open = !_open), child: header),
            )
          else
            header,
          if (showBody) ...[
            const Divider(height: 1),
            widget.child,
          ],
        ],
      ),
    );
  }
}
