import 'package:flutter/material.dart';

const radarCyan = Color(0xFF0E7490);
const radarCyanDark = Color(0xFF67E8F9);

ThemeData watchTowerTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: dark ? radarCyanDark : radarCyan,
    brightness: brightness,
    primary: dark ? radarCyanDark : radarCyan,
    surface: dark ? const Color(0xFF101619) : const Color(0xFFF7FAFA),
  );
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    fontFamilyFallback: const [
      'SF Pro Text',
      'PingFang SC',
      'Microsoft YaHei',
      'Noto Sans CJK SC',
    ],
    cardTheme: CardThemeData(
      elevation: dark ? 0 : 1,
      shadowColor: Colors.black.withValues(alpha: 0.06),
      color: dark ? const Color(0xFF172125) : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: dark
            ? const BorderSide(color: Color(0x1FFFFFFF))
            : BorderSide.none,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      height: 72,
      indicatorColor: scheme.primary.withValues(alpha: dark ? 0.18 : 0.12),
      labelTextStyle: WidgetStatePropertyAll(
        TextStyle(fontWeight: FontWeight.w600, color: scheme.onSurface),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(44, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: const Size(44, 44),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(minimumSize: const Size(48, 48)),
    ),
    focusColor: scheme.primary.withValues(alpha: 0.18),
    visualDensity: VisualDensity.standard,
  );
}
