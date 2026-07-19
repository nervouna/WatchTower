import 'package:flutter_test/flutter_test.dart';
import 'package:watchtower/config.dart';

void main() {
  group('AppConfig API binding', () {
    test('maps the iOS dev flavor to the Dev Worker', () {
      expect(
        AppConfig.resolveApiBaseUrl(flavor: 'dev'),
        'https://dev.watchtower.damao.io',
      );
    });

    test('maps prod and the flavorless Android build to production', () {
      expect(
        AppConfig.resolveApiBaseUrl(flavor: 'prod'),
        'https://watchtower.damao.io',
      );
      expect(
        AppConfig.resolveApiBaseUrl(),
        'https://watchtower.damao.io',
      );
    });

    test('fails closed for an unknown flavor', () {
      expect(
        () => AppConfig.resolveApiBaseUrl(flavor: 'preview'),
        throwsStateError,
      );
    });

    test('uses an explicit valid local debugging override', () {
      expect(
        AppConfig.resolveApiBaseUrl(
          flavor: 'dev',
          override: 'http://127.0.0.1:8787/',
        ),
        'http://127.0.0.1:8787',
      );
      expect(
        AppConfig.resolveApiBaseUrl(
          flavor: 'dev',
          override: 'http://192.168.10.20:8787',
        ),
        'http://192.168.10.20:8787',
      );
      expect(
        () => AppConfig.resolveApiBaseUrl(override: 'not-a-url'),
        throwsStateError,
      );
    });

    test('rejects public and cross-environment overrides', () {
      for (final override in <String>[
        'https://watchtower.damao.io',
        'https://dev.watchtower.damao.io',
        'https://example.com',
        'https://fcorp.example.com',
        'http://10.999.1.1:8787',
        'http://user:password@127.0.0.1:8787',
      ]) {
        expect(
          () => AppConfig.resolveApiBaseUrl(
            flavor: 'dev',
            override: override,
          ),
          throwsStateError,
        );
      }
    });

    test('does not let a local override bypass an unknown flavor', () {
      expect(
        () => AppConfig.resolveApiBaseUrl(
          flavor: 'preview',
          override: 'http://127.0.0.1:8787',
        ),
        throwsStateError,
      );
    });
  });
}
