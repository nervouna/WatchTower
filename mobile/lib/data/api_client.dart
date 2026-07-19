import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';

class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;
  @override
  String toString() => message;
}

class ApiResponse {
  const ApiResponse({required this.statusCode, required this.body, this.etag});
  final int statusCode;
  final String body;
  final String? etag;
}

class ApiClient {
  ApiClient({http.Client? client, String? baseUrl})
    : _client = client ?? http.Client(),
      _baseUri = Uri.parse(baseUrl ?? AppConfig.apiBaseUrl);

  final http.Client _client;
  final Uri _baseUri;

  String get baseUrl => _baseUri.toString().replaceFirst(RegExp(r'/$'), '');

  Uri resolve(String path) => _baseUri.resolve(path);

  Future<Map<String, dynamic>> getJson(
    String path, {
    String? accessToken,
  }) async {
    final response = await _client
        .get(
          resolve(path),
          headers: {
            'Accept': 'application/json',
            if (accessToken != null) 'Authorization': 'Bearer $accessToken',
          },
        )
        .timeout(const Duration(seconds: 15));
    return _decodeJson(response);
  }

  Future<Map<String, dynamic>?> sendJson(
    String method,
    String path, {
    required String accessToken,
    Map<String, dynamic>? body,
  }) async {
    final request = http.Request(method, resolve(path))
      ..headers.addAll({
        'Accept': 'application/json',
        'Authorization': 'Bearer $accessToken',
        if (body != null) 'Content-Type': 'application/json',
      });
    if (body != null) request.body = jsonEncode(body);
    final streamed = await _client
        .send(request)
        .timeout(const Duration(seconds: 15));
    final response = await http.Response.fromStream(streamed);
    if (response.statusCode == 204) return null;
    return _decodeJson(response);
  }

  Map<String, dynamic> _decodeJson(http.Response response) {
    Map<String, dynamic>? decoded;
    try {
      decoded = jsonDecode(response.body) as Map<String, dynamic>;
    } on FormatException {
      decoded = null;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = decoded?['error'] as Map<String, dynamic>?;
      throw ApiException(
        error?['message'] as String? ?? '请求失败，请稍后重试。',
        statusCode: response.statusCode,
      );
    }
    return decoded ?? <String, dynamic>{};
  }

  Future<ApiResponse> get(String path, {String? etag}) async {
    final response = await _client
        .get(
          resolve(path),
          headers: {'Accept': 'application/json', 'If-None-Match': ?etag},
        )
        .timeout(const Duration(seconds: 15));
    if (response.statusCode == 304) {
      return ApiResponse(statusCode: 304, body: '', etag: etag);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      String message = '请求失败，请稍后重试。';
      try {
        final decoded = jsonDecode(response.body) as Map<String, dynamic>;
        final error = decoded['error'] as Map<String, dynamic>?;
        if (error?['message'] is String) message = error!['message'] as String;
      } on FormatException {
        // Preserve the stable fallback for non-JSON upstream responses.
      }
      throw ApiException(message, statusCode: response.statusCode);
    }
    return ApiResponse(
      statusCode: response.statusCode,
      body: response.body,
      etag: response.headers['etag'],
    );
  }

  Future<ApiResponse> post(String path) async {
    final response = await _client
        .post(resolve(path), headers: {'Accept': 'application/json'})
        .timeout(const Duration(seconds: 15));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      String message = '请求失败，请稍后重试。';
      try {
        final decoded = jsonDecode(response.body) as Map<String, dynamic>;
        final error = decoded['error'] as Map<String, dynamic>?;
        if (error?['message'] is String) message = error!['message'] as String;
      } on FormatException {
        // Preserve the stable fallback for non-JSON upstream responses.
      }
      throw ApiException(message, statusCode: response.statusCode);
    }
    return ApiResponse(
      statusCode: response.statusCode,
      body: response.body,
      etag: response.headers['etag'],
    );
  }

  Future<void> upsertPushSubscription(Map<String, String> payload) async {
    final response = await _client
        .put(
          resolve('/api/mobile/v1/push-subscriptions'),
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: jsonEncode(payload),
        )
        .timeout(const Duration(seconds: 15));
    if (response.statusCode != 204) {
      throw ApiException('暂时无法开启通知。', statusCode: response.statusCode);
    }
  }

  Future<void> deletePushSubscription(String installationSecret) async {
    final request =
        http.Request('DELETE', resolve('/api/mobile/v1/push-subscriptions'))
          ..headers.addAll({
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          })
          ..body = jsonEncode({'installationSecret': installationSecret});
    final response = await _client
        .send(request)
        .timeout(const Duration(seconds: 15));
    if (response.statusCode != 204) {
      throw ApiException('暂时无法关闭通知。', statusCode: response.statusCode);
    }
  }
}
