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
    if (flavor != null && flavor != 'dev' && flavor != 'prod') {
      throw StateError('Unsupported WatchTower flavor: $flavor');
    }
    if (override.isNotEmpty) {
      final uri = Uri.tryParse(override);
      if (uri == null || !uri.hasScheme || !uri.hasAuthority ||
          (uri.scheme != 'http' && uri.scheme != 'https') ||
          uri.userInfo.isNotEmpty || !_isLocalHost(uri.host)) {
        throw StateError(
          'WATCHTOWER_API_BASE_URL must use localhost or a private-network proxy.',
        );
      }
      return uri.toString().replaceFirst(RegExp(r'/$'), '');
    }
    return switch (flavor) {
      'dev' => 'https://dev.watchtower.damao.io',
      'prod' || null => 'https://watchtower.damao.io',
      _ => throw StateError('Unsupported WatchTower flavor: $flavor'),
    };
  }

  static bool _isLocalHost(String value) {
    final host = value.toLowerCase();
    if (host == 'localhost' || host == '::1') return true;
    final octets = host.split('.').map(int.tryParse).toList(growable: false);
    if (octets.length == 4 && octets.every(
      (octet) => octet != null && octet >= 0 && octet <= 255,
    )) {
      final first = octets[0]!;
      final second = octets[1]!;
      return first == 127 || first == 10 ||
          (first == 172 && second >= 16 && second <= 31) ||
          (first == 192 && second == 168);
    }
    if (!host.contains(':')) return false;
    return host.startsWith('fc') || host.startsWith('fd') ||
        RegExp(r'^fe[89ab]').hasMatch(host);
  }
}
