import 'dart:async';

import 'package:auth0_flutter/auth0_flutter.dart' hide ApiException;
import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../data/api_client.dart';

class AuthController extends ChangeNotifier {
  AuthController({required this.api});

  final ApiClient api;
  Auth0? _auth0;
  String? _audience;
  String? userId;
  bool feedbackAllowed = false;
  bool audioRetryAllowed = false;
  bool loading = true;
  bool busy = false;
  String? error;
  final Map<String, String> feedback = {};
  final Set<String> savingFeedback = {};
  final Map<String, String> feedbackErrors = {};

  bool get signedIn => userId != null;

  Future<void> initialize() async {
    try {
      final config = await api.getJson('/api/auth/config');
      final issuer = Uri.parse(config['issuer'] as String);
      final clients = config['clientIds'] as Map<String, dynamic>;
      final package = await PackageInfo.fromPlatform();
      final clientId = package.packageName == 'io.damao.watchtower.dev'
          ? clients['mobileDev'] as String
          : clients['mobileProd'] as String;
      _audience = config['audience'] as String;
      _auth0 = Auth0(issuer.host, clientId);
      if (await _auth0!.credentialsManager.hasValidCredentials()) {
        await _refreshMe();
      }
    } catch (_) {
      error = '账号服务暂不可用，匿名阅读不受影响。';
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<String> _accessToken() async =>
      (await _auth0!.credentialsManager.credentials()).accessToken;

  Future<T> _authorized<T>(Future<T> Function(String token) operation) async {
    try {
      return await operation(await _accessToken());
    } on ApiException catch (exception) {
      if (exception.statusCode != 401) rethrow;
      try {
        final renewed = await _auth0!.credentialsManager.renewCredentials();
        return await operation(renewed.accessToken);
      } catch (_) {
        await _auth0?.credentialsManager.clearCredentials();
        _clearSession();
        notifyListeners();
        rethrow;
      }
    }
  }

  void _clearSession() {
    userId = null;
    feedbackAllowed = false;
    audioRetryAllowed = false;
    feedback.clear();
    feedbackErrors.clear();
  }

  Future<void> _refreshMe() async {
    final me = await _authorized(
      (token) => api.getJson('/api/auth/me', accessToken: token),
    );
    userId = (me['user'] as Map<String, dynamic>)['id'] as String;
    final capabilities = me['capabilities'] as Map<String, dynamic>;
    feedbackAllowed = capabilities['feedback'] == true;
    audioRetryAllowed = capabilities['audioRetry'] == true;
  }

  Future<void> login() async {
    if (_auth0 == null || _audience == null) return;
    busy = true;
    error = null;
    notifyListeners();
    try {
      await _auth0!.webAuthentication().login(
        audience: _audience,
        useHTTPS: true,
        parameters: const {'connection': 'apple', 'ui_locales': 'zh-CN'},
      );
      await _refreshMe();
    } catch (_) {
      error = '登录未完成，请重试。';
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    busy = true;
    notifyListeners();
    try {
      await _auth0?.webAuthentication().logout(useHTTPS: true);
    } finally {
      _clearSession();
      busy = false;
      notifyListeners();
    }
  }

  Future<void> deleteAccount() async {
    busy = true;
    error = null;
    notifyListeners();
    try {
      await _authorized(
        (token) =>
            api.sendJson('DELETE', '/api/auth/account', accessToken: token),
      );
      await _auth0?.credentialsManager.clearCredentials();
      _clearSession();
    } catch (exception) {
      error = exception is ApiException ? exception.message : '账号删除暂未完成，请稍后重试。';
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> loadFeedback(Iterable<String> entityIds) async {
    if (!feedbackAllowed) return;
    final query = entityIds
        .map((id) => 'entityId=${Uri.encodeQueryComponent(id)}')
        .join('&');
    try {
      final value = await _authorized(
        (token) => api.getJson('/api/feedback?$query', accessToken: token),
      );
      feedback
        ..clear()
        ..addAll(
          (value['feedback'] as Map<String, dynamic>).map(
            (key, value) => MapEntry(key, value as String),
          ),
        );
      notifyListeners();
    } catch (exception) {
      if (exception is ApiException && exception.statusCode == 403) {
        feedbackAllowed = false;
        audioRetryAllowed = false;
        notifyListeners();
      }
    }
  }

  Future<void> setFeedback(
    String entityId,
    String briefDate,
    String? value,
  ) async {
    if (!feedbackAllowed) return;
    savingFeedback.add(entityId);
    feedbackErrors.remove(entityId);
    notifyListeners();
    try {
      await _authorized(
        (token) => api.sendJson(
          value == null ? 'DELETE' : 'PUT',
          '/api/feedback/$entityId',
          accessToken: token,
          body: value == null ? null : {'value': value, 'briefDate': briefDate},
        ),
      );
      if (value == null) {
        feedback.remove(entityId);
      } else {
        feedback[entityId] = value;
      }
    } catch (exception) {
      if (exception is ApiException && exception.statusCode == 403) {
        feedbackAllowed = false;
        audioRetryAllowed = false;
      } else {
        feedbackErrors[entityId] = '保存失败，请重试。';
      }
    } finally {
      savingFeedback.remove(entityId);
      notifyListeners();
    }
  }

  Future<void> retryAudio(String date) async {
    try {
      await _authorized(
        (token) => api.sendJson(
          'POST',
          '/api/briefs/$date/audio/retry',
          accessToken: token,
        ),
      );
    } on ApiException catch (exception) {
      if (exception.statusCode == 403) {
        feedbackAllowed = false;
        audioRetryAllowed = false;
        notifyListeners();
      }
      rethrow;
    }
  }
}
