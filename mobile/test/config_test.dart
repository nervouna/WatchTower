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
        () => AppConfig.resolveApiBaseUrl(override: 'not-a-url'),
        throwsStateError,
      );
    });
  });
}
