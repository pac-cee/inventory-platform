import 'package:flutter/material.dart';

/// Bottom sheet that can be dragged down to dismiss and works with the keyboard
/// (each sheet pads itself by the keyboard inset).
///
/// Every sheet's body is a scroll view, and a scroll view takes every vertical
/// drag for itself — so swiping down on the content scrolled it instead of
/// closing the sheet, and the only way out was tapping the dimmed area above.
/// The fix is a grab handle that sits OUTSIDE the scrolling area: dragging the
/// handle (or the strip around it) closes the sheet, dragging the content still
/// scrolls it. Tapping the dimmed area or pressing back also closes it.
///
/// Fixed at 90% of the screen height so the content lays out as before.
Future<T?> showSlideSheet<T>(
  BuildContext context, {
  required WidgetBuilder builder,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    enableDrag: true,
    backgroundColor: Theme.of(context).colorScheme.surface,
    clipBehavior: Clip.antiAlias,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
    ),
    builder: (ctx) => SizedBox(
      height: MediaQuery.of(ctx).size.height * 0.9,
      child: Column(
        children: [
          const SheetHandle(),
          Expanded(child: Builder(builder: builder)),
        ],
      ),
    ),
  );
}

/// The grab handle at the top of a [showSlideSheet] sheet. A generous 32px strip,
/// not just the visible pill, so it is easy to catch with a thumb.
class SheetHandle extends StatelessWidget {
  const SheetHandle({super.key});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Drag down to close',
      child: SizedBox(
        height: 32,
        width: double.infinity,
        child: Center(
          child: Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.outlineVariant,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),
      ),
    );
  }
}
