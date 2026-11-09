import 'package:flutter/material.dart';

/// What every screen shows when its data fails to load: what went wrong, and a
/// Retry. Scrollable, so it also works inside a RefreshIndicator (pull to retry).
class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.message, this.title = "Couldn't load this", this.onRetry});

  final String title;
  final String message;
  final Future<void> Function()? onRetry;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(24, 80, 24, 24),
      children: [
        Icon(Icons.error_outline, size: 40, color: cs.error),
        const SizedBox(height: 12),
        Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        Text(message, textAlign: TextAlign.center, style: TextStyle(color: cs.onSurfaceVariant)),
        if (onRetry != null) ...[
          const SizedBox(height: 16),
          Center(
            child: FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Try again'),
            ),
          ),
        ],
      ],
    );
  }
}
