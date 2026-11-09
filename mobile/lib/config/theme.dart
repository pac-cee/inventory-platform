import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Verlet highlight (pink) — the primary accent. Lighter in dark mode.
const Color kAccent = Color(0xFFD64D7A);
const Color _highlightDark = Color(0xFFE06090);

// Surfaces & text (Verlet tokens). Mobile uses opaque surfaces.
const Color _bgLight = Color(0xFFF4F4F6);
const Color _cardLight = Color(0xFFFFFFFF);
const Color _fgLight = Color(0xFF1C1C1E);
const Color _mutedLight = Color(0xFF8E8E93);
const Color _borderLight = Color(0x14000000); // ~8% black

const Color _bgDark = Color(0xFF0A0A0C);
const Color _cardDark = Color(0xFF16161A);
const Color _fgDark = Color(0xEBFFFFFF); // white @ 92%
const Color _mutedDark = Color(0x80FFFFFF); // white @ 50%
const Color _borderDark = Color(0x1AFFFFFF); // ~10% white

// Status colors (Verlet).
const Color _destructive = Color(0xFFFF3B30);
const Color _warning = Color(0xFFFF9F0A);
const Color _success = Color(0xFF34C759);

ThemeData buildTheme(Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  final highlight = isDark ? _highlightDark : kAccent;
  final bg = isDark ? _bgDark : _bgLight;
  final card = isDark ? _cardDark : _cardLight;
  final fg = isDark ? _fgDark : _fgLight;
  final muted = isDark ? _mutedDark : _mutedLight;
  final border = isDark ? _borderDark : _borderLight;

  final scheme = ColorScheme.fromSeed(
    seedColor: highlight,
    brightness: brightness,
  ).copyWith(
    primary: highlight,
    onPrimary: Colors.white,
    secondary: highlight,
    onSecondary: Colors.white,
    surface: card,
    onSurface: fg,
    onSurfaceVariant: muted,
    outline: border,
    outlineVariant: border,
    error: _destructive,
    onError: Colors.white,
  );

  // Typography: DM Sans body, DM Serif Display headings, JetBrains Mono numbers.
  final base = (isDark ? ThemeData.dark() : ThemeData.light()).textTheme;
  final sans = GoogleFonts.dmSansTextTheme(base);
  final textTheme = sans
      .copyWith(
        displayLarge: GoogleFonts.dmSerifDisplay(textStyle: sans.displayLarge),
        displayMedium: GoogleFonts.dmSerifDisplay(textStyle: sans.displayMedium),
        displaySmall: GoogleFonts.dmSerifDisplay(textStyle: sans.displaySmall),
        headlineLarge: GoogleFonts.dmSerifDisplay(textStyle: sans.headlineLarge),
        headlineMedium: GoogleFonts.dmSerifDisplay(textStyle: sans.headlineMedium),
        headlineSmall: GoogleFonts.dmSerifDisplay(textStyle: sans.headlineSmall),
        titleLarge: GoogleFonts.dmSerifDisplay(textStyle: sans.titleLarge),
      )
      .apply(bodyColor: fg, displayColor: fg);

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: bg,
    textTheme: textTheme,
    appBarTheme: AppBarTheme(
      backgroundColor: bg,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      foregroundColor: fg,
      titleTextStyle: GoogleFonts.dmSerifDisplay(fontSize: 22, color: fg),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: card,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: border),
      ),
      margin: EdgeInsets.zero,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: card,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      indicatorColor: highlight.withValues(alpha: 0.12),
      labelTextStyle: WidgetStatePropertyAll(
        GoogleFonts.dmSans(fontSize: 12, color: fg),
      ),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return IconThemeData(color: selected ? highlight : muted);
      }),
    ),
    dividerTheme: DividerThemeData(color: border, thickness: 1, space: 1),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: highlight,
        foregroundColor: Colors.white,
        textStyle: GoogleFonts.dmSans(fontSize: 14, fontWeight: FontWeight.w500),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: highlight,
        foregroundColor: Colors.white,
        elevation: 0,
        textStyle: GoogleFonts.dmSans(fontSize: 14, fontWeight: FontWeight.w500),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: highlight),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: card,
      hintStyle: TextStyle(color: muted),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: highlight, width: 1.5),
      ),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
    ),
  );
}

/// Verlet typography helpers for screens (serif headings, mono numbers/metrics).
class VerletText {
  static TextStyle serif({double? fontSize, Color? color, FontWeight? fontWeight}) =>
      GoogleFonts.dmSerifDisplay(
        fontSize: fontSize,
        color: color,
        fontWeight: fontWeight,
      );

  static TextStyle mono({double? fontSize, Color? color, FontWeight? fontWeight}) =>
      GoogleFonts.jetBrainsMono(
        fontSize: fontSize,
        color: color,
        fontWeight: fontWeight ?? FontWeight.w300,
      );
}

/// Colors for stock-status chips, used across screens.
class StatusColors {
  static Color bg(BuildContext context, Color base) => base.withValues(alpha: 0.12);

  /// Text colour for a status shown on a tint of itself. The bright base colours
  /// (amber, green) are only ~2:1 against a light tint, which is hard to read;
  /// in light mode this darkens them to a readable shade. In dark mode amber and
  /// green are already fine, but red and blue fall short (blue ~3.8:1) on a dark
  /// tint, so anything below a lightness of 0.68 is lifted to it.
  static Color text(BuildContext context, Color base) {
    final hsl = HSLColor.fromColor(base);
    if (Theme.of(context).brightness == Brightness.dark) {
      return hsl.lightness >= 0.68 ? base : hsl.withLightness(0.68).toColor();
    }
    return hsl.withLightness((hsl.lightness * 0.55).clamp(0.0, 1.0)).toColor();
  }
  static const Color out = _destructive; // red
  static const Color low = _warning; // amber
  static const Color ok = _success; // green
}
