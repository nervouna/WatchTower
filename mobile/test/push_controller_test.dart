import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:watchtower/data/api_client.dart';
import 'package:watchtower/push/push_controller.dart';

class _FailingApiClient extends ApiClient {
  _FailingApiClient() : super(baseUrl: 'https://example.com');

  @override
  Future<void> upsertPushSubscription(Map<String, String> payload) async {
    throw const ApiException('暂时无法开启通知。', statusCode: 503);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('io.damao.watchtower/push');

  setUp(() {
    PackageInfo.setMockInitialValues(
      appName: 'WatchTower Dev',
      packageName: 'io.damao.watchtower.dev',
      version: '1.0.0',
      buildNumber: '3',
      buildSignature: '',
    );
    FlutterSecureStorage.setMockInitialValues({
      'push_enabled': 'true',
      'push_installation_secret': 'installation-secret',
    });
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          return switch (call.method) {
            'isSupported' => true,
            'authorizationStatus' => 'authorized',
            'currentToken' => <String, dynamic>{
              'token': 'device-token',
              'environment': 'sandbox',
            },
            _ => null,
          };
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  testWidgets('push sync failure degrades without escaping initialization', (
    tester,
  ) async {
    final controller = PushController(api: _FailingApiClient());

    await expectLater(controller.initialize(), completes);

    expect(controller.status, PushStatus.authorized);
    expect(controller.error, '暂时无法同步通知，稍后会自动重试。');
    controller.dispose();
  });
}
