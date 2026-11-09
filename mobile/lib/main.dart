import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'config/api_client.dart';
import 'config/theme.dart';
import 'config/theme_controller.dart';
import 'features/auth/login_screen.dart';
import 'features/shell/main_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // `.env` is gitignored, so it is absent on a fresh clone and in CI. It used to
  // be loaded unguarded, which threw here — before the first frame — and looked
  // like the app crashing on launch rather than a missing config file.
  //
  // Release builds should not rely on it at all: pass
  // `--dart-define=API_URL=...`, which ApiClient prefers over the bundled file.
  try {
    await dotenv.load(fileName: '.env');
  } catch (_) {
    // No .env bundled. ApiClient falls back to --dart-define, then its default.
  }
  await themeController.load();
  await ApiClient.instance.restore();
  runApp(const InventoryApp());
}

class InventoryApp extends StatelessWidget {
  const InventoryApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<ThemeMode>(
      valueListenable: themeController.mode,
      builder: (context, mode, _) {
        return MaterialApp(
          title: 'Inventory',
          debugShowCheckedModeBanner: false,
          theme: buildTheme(Brightness.light),
          darkTheme: buildTheme(Brightness.dark),
          themeMode: mode,
          home: const _AuthGate(),
        );
      },
    );
  }
}

class _AuthGate extends StatelessWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: ApiClient.instance.isAuthenticated,
      builder: (context, isAuthenticated, _) {
        return isAuthenticated ? const MainShell() : const LoginScreen();
      },
    );
  }
}
