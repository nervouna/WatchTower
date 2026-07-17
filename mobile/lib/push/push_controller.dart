import 'dart:convert';
import 'dart:math';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../data/api_client.dart';

enum PushStatus { unsupported, unknown, denied, authorized }

class PushController extends ChangeNotifier with WidgetsBindingObserver {
  PushController({required this._api}) {
    WidgetsBinding.instance.addObserver(this);
    _channel.setMethodCallHandler(_handleNativeCall);
  }

  static const _channel = MethodChannel('io.damao.watchtower/push');
  static const _storage = FlutterSecureStorage();
  static const _installationKey = 'push_installation_secret';
  static const _enabledKey = 'push_enabled';
  final ApiClient _api;
  PushStatus status = PushStatus.unknown;
  bool busy = false;
  String? error;
  void Function(String date)? onNotificationOpened;
  bool _initializing = false;

  Future<void> initialize() async {
    if (_initializing) return;
    _initializing = true;
    error = null;
    try {
      final supported =
          await _channel.invokeMethod<bool>('isSupported') ?? false;
      if (!supported) {
        status = PushStatus.unsupported;
        notifyListeners();
        return;
      }
      final systemStatus = _parseStatus(
        await _channel.invokeMethod<String>('authorizationStatus'),
      );
      final enabled = await _storage.read(key: _enabledKey) == 'true';
      status = systemStatus == PushStatus.authorized && !enabled
          ? PushStatus.unknown
          : systemStatus;
      if (status == PushStatus.authorized) await _syncCurrentToken();
    } on MissingPluginException {
      status = PushStatus.unsupported;
    } catch (_) {
      error = '暂时无法同步通知，稍后会自动重试。';
    } finally {
      _initializing = false;
      notifyListeners();
    }
  }

  Future<void> enable() async {
    busy = true;
    error = null;
    notifyListeners();
    try {
      final result = await _channel.invokeMapMethod<String, dynamic>(
        'requestAuthorization',
      );
      status = _parseStatus(result?['status'] as String?);
      if (status == PushStatus.authorized) {
        await _syncTokenResult(result);
        await _storage.write(key: _enabledKey, value: 'true');
      }
    } catch (_) {
      error = '暂时无法开启通知，请稍后重试。';
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> disable() async {
    busy = true;
    error = null;
    notifyListeners();
    try {
      final secret = await _installationSecret();
      await _api.deletePushSubscription(secret);
      await _channel.invokeMethod<void>('unregister');
      await _storage.write(key: _enabledKey, value: 'false');
      status = PushStatus.unknown;
    } catch (_) {
      error = '暂时无法关闭通知，请稍后重试。';
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> openSettings() => _channel.invokeMethod<void>('openSettings');

  Future<void> _syncCurrentToken() async {
    final result = await _channel.invokeMapMethod<String, dynamic>(
      'currentToken',
    );
    await _syncTokenResult(result);
  }

  Future<void> _syncTokenResult(Map<String, dynamic>? result) async {
    final token = result?['token'];
    final environment = result?['environment'];
    if (token is! String || environment is! String) return;
    final package = await PackageInfo.fromPlatform();
    await _api.upsertPushSubscription({
      'installationSecret': await _installationSecret(),
      'deviceToken': token,
      'environment': environment,
      'appId': package.packageName,
      'appVersion': '${package.version}+${package.buildNumber}',
    });
  }

  Future<String> _installationSecret() async {
    final stored = await _storage.read(key: _installationKey);
    if (stored != null) return stored;
    final random = Random.secure();
    final bytes = List<int>.generate(32, (_) => random.nextInt(256));
    final value = base64Url.encode(bytes).replaceAll('=', '');
    await _storage.write(key: _installationKey, value: value);
    return value;
  }

  PushStatus _parseStatus(String? value) => switch (value) {
    'authorized' || 'provisional' => PushStatus.authorized,
    'denied' => PushStatus.denied,
    _ => PushStatus.unknown,
  };

  Future<void> _handleNativeCall(MethodCall call) async {
    if (call.method != 'notificationOpened') return;
    final arguments = call.arguments;
    if (arguments is Map && arguments['briefDate'] is String) {
      onNotificationOpened?.call(arguments['briefDate'] as String);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) initialize();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}
