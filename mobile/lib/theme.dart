import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

const ledgerLightPage = Color(0xFFFCFCFB);
const ledgerLightText = Color(0xFF171717);
const ledgerLightSecondary = Color(0xFF62666B);
const ledgerLightDivider = Color(0xFFD6D7D9);
const ledgerLightAccent = Color(0xFFB42318);
const ledgerDarkPage = Color(0xFF111315);
const ledgerDarkText = Color(0xFFF4F4F1);
const ledgerDarkSecondary = Color(0xFFA8ADB2);
const ledgerDarkDivider = Color(0xFF363A3E);
const ledgerDarkAccent = Color(0xFFFF8177);

@immutable
class LedgerTheme extends ThemeExtension<LedgerTheme> {
  const LedgerTheme({required this.serifFamily, required this.serifFallback});

  final String serifFamily;
  final List<String> serifFallback;

  TextStyle serif({double? size, FontWeight? weight, double? height}) =>
      TextStyle(
        fontFamily: serifFamily,
        fontFamilyFallback: serifFallback,
        fontSize: size,
        fontWeight: weight,
        height: height,
      );

  @override
  LedgerTheme copyWith({String? serifFamily, List<String>? serifFallback}) =>
      LedgerTheme(
        serifFamily: serifFamily ?? this.serifFamily,
        serifFallback: serifFallback ?? this.serifFallback,
      );

  @override
  LedgerTheme lerp(LedgerTheme? other, double t) => other ?? this;
}

LedgerTheme _ledgerTypography() {
  if (defaultTargetPlatform == TargetPlatform.iOS ||
      defaultTargetPlatform == TargetPlatform.macOS) {
    return const LedgerTheme(
      serifFamily: 'Iowan Old Style',
      serifFallback: ['Baskerville', 'Songti SC', 'STSong'],
    );
  }
  return const LedgerTheme(
    serifFamily: 'Noto Serif',
    serifFallback: ['Noto Serif CJK SC'],
  );
}

ThemeData watchTowerTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final page = dark ? ledgerDarkPage : ledgerLightPage;
  final text = dark ? ledgerDarkText : ledgerLightText;
  final secondary = dark ? ledgerDarkSecondary : ledgerLightSecondary;
  final divider = dark ? ledgerDarkDivider : ledgerLightDivider;
  final accent = dark ? ledgerDarkAccent : ledgerLightAccent;
  final ledger = _ledgerTypography();
  final scheme = ColorScheme(
    brightness: brightness,
    primary: accent,
    onPrimary: dark ? ledgerDarkPage : Colors.white,
    secondary: secondary,
    onSecondary: page,
    error: accent,
    onError: dark ? ledgerDarkPage : Colors.white,
    surface: page,
    onSurface: text,
    surfaceContainerHighest: dark
        ? const Color(0xFF1B1E21)
        : const Color(0xFFF2F2F0),
    onSurfaceVariant: secondary,
    outline: divider,
    outlineVariant: divider,
  );
  final base = ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
  );
  final textTheme = base.textTheme
      .apply(bodyColor: text, displayColor: text)
      .copyWith(
        bodyLarge: base.textTheme.bodyLarge?.copyWith(
          fontSize: 17,
          height: 1.65,
        ),
        bodyMedium: base.textTheme.bodyMedium?.copyWith(
          fontSize: 16,
          height: 1.6,
        ),
        bodySmall: base.textTheme.bodySmall?.copyWith(
          fontSize: 13,
          height: 1.5,
          color: secondary,
        ),
        titleLarge: ledger
            .serif(size: 26, weight: FontWeight.w600, height: 1.28)
            .copyWith(color: text),
        titleMedium: ledger
            .serif(size: 22, weight: FontWeight.w600, height: 1.3)
            .copyWith(color: text),
        headlineMedium: ledger
            .serif(size: 30, weight: FontWeight.w600, height: 1.2)
            .copyWith(color: text),
      );
  const controlShape = RoundedRectangleBorder(
    borderRadius: BorderRadius.all(Radius.circular(4)),
  );
  return base.copyWith(
    scaffoldBackgroundColor: page,
    textTheme: textTheme,
    extensions: [ledger],
    dividerColor: divider,
    dividerTheme: DividerThemeData(color: divider, thickness: 1, space: 1),
    appBarTheme: AppBarTheme(
      backgroundColor: page,
      foregroundColor: text,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: ledger
          .serif(size: 24, weight: FontWeight.w600, height: 1.2)
          .copyWith(color: text),
    ),
    navigationBarTheme: NavigationBarThemeData(
      height: 68,
      backgroundColor: page,
      indicatorColor: Colors.transparent,
      elevation: 0,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          color: states.contains(WidgetState.selected) ? accent : secondary,
        ),
      ),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          color: states.contains(WidgetState.selected) ? accent : secondary,
          fontSize: 12,
          fontWeight: states.contains(WidgetState.selected)
              ? FontWeight.w700
              : FontWeight.w500,
        ),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: controlShape,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: controlShape,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: controlShape,
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: controlShape,
      ),
    ),
    dialogTheme: const DialogThemeData(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(8)),
      ),
    ),
    cardTheme: const CardThemeData(
      elevation: 0,
      margin: EdgeInsets.zero,
      color: Colors.transparent,
    ),
    focusColor: accent.withValues(alpha: 0.14),
    splashFactory: InkSparkle.splashFactory,
    visualDensity: VisualDensity.standard,
  );
}
