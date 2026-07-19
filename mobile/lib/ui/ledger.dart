import 'package:flutter/material.dart';

import '../theme.dart';

double ledgerHorizontalPadding(BuildContext context, {double minimum = 20}) {
  final width = MediaQuery.sizeOf(context).width;
  return width > 800 ? (width - 720) / 2 : minimum;
}

class LedgerRule extends StatelessWidget {
  const LedgerRule({
    this.margin = const EdgeInsets.symmetric(vertical: 24),
    super.key,
  });
  final EdgeInsets margin;
  @override
  Widget build(BuildContext context) =>
      Padding(padding: margin, child: const Divider());
}

class LedgerSectionTitle extends StatelessWidget {
  const LedgerSectionTitle(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Text(
    text,
    style:
        (Theme.of(context).extension<LedgerTheme>() ??
                const LedgerTheme(
                  serifFamily: 'Noto Serif',
                  serifFallback: ['Noto Serif CJK SC'],
                ))
            .serif(size: 24, weight: FontWeight.w600, height: 1.3)
            .copyWith(color: Theme.of(context).colorScheme.onSurface),
  );
}

class LedgerNotice extends StatelessWidget {
  const LedgerNotice(this.text, {this.error = false, super.key});
  final String text;
  final bool error;
  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: error,
    child: Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        border: Border.symmetric(
          horizontal: BorderSide(color: Theme.of(context).dividerColor),
        ),
      ),
      child: Text(
        text,
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
          color: error
              ? Theme.of(context).colorScheme.error
              : Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
    ),
  );
}

class LedgerTextLink extends StatelessWidget {
  const LedgerTextLink({
    required this.label,
    required this.onPressed,
    this.leading,
    super.key,
  });
  final String label;
  final VoidCallback? onPressed;
  final IconData? leading;
  @override
  Widget build(BuildContext context) => Semantics(
    link: true,
    child: TextButton.icon(
      onPressed: onPressed,
      icon: leading == null ? const SizedBox.shrink() : Icon(leading, size: 18),
      label: Text(
        label,
        style: const TextStyle(decoration: TextDecoration.underline),
      ),
    ),
  );
}
