import 'package:flutter/services.dart' show appFlavor;

class AppConfig {
  const AppConfig._();

  static const _apiOverride = String.fromEnvironment(
    'WATCHTOWER_API_BASE_URL',
    defaultValue: '',
  );

  static final apiBaseUrl = resolveApiBaseUrl(
    flavor: appFlavor,
    override: _apiOverride,
  );

  static String resolveApiBaseUrl({String? flavor, String override = ''}) {
    if (override.isNotEmpty) {
      final uri = Uri.tryParse(override);
      if (uri == null || !uri.hasScheme || !uri.hasAuthority ||
          (uri.scheme != 'http' && uri.scheme != 'https')) {
        throw StateError('WATCHTOWER_API_BASE_URL must be an absolute HTTP(S) URL.');
      }
      return uri.toString().replaceFirst(RegExp(r'/$'), '');
    }
    return switch (flavor) {
      'dev' => 'https://dev.watchtower.damao.io',
      'prod' || null => 'https://watchtower.damao.io',
      _ => throw StateError('Unsupported WatchTower flavor: $flavor'),
    };
  }
}
