import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Holds the user's theme choice (light / dark / system), persisted on device.
/// MaterialApp listens to [mode] to re-theme the whole app.
class ThemeController {
  ThemeController._();
  static final ThemeController instance = ThemeController._();

  static const _key = 'theme_mode';
  final FlutterSecureStorage _storage = const FlutterSecureStorage();

  final ValueNotifier<ThemeMode> mode = ValueNotifier<ThemeMode>(ThemeMode.dark);

  Future<void> load() async {
    mode.value = _parse(await _storage.read(key: _key));
  }

  Future<void> set(ThemeMode value) async {
    mode.value = value;
    await _storage.write(key: _key, value: value.name);
  }

  ThemeMode _parse(String? value) {
    switch (value) {
      case 'light':
        return ThemeMode.light;
      case 'system':
        return ThemeMode.system;
      default:
        return ThemeMode.dark;
    }
  }
}

ThemeController get themeController => ThemeController.instance;
