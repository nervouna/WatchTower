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

  Uri resolve(String path) => _baseUri.resolve(path);

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
