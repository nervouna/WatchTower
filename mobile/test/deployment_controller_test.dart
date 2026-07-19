import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:watchtower/data/api_client.dart';
import 'package:watchtower/deployment/deployment_controller.dart';

void main() {
  test('loads and strictly decodes deployment metadata', () async {
    final client = MockClient((request) async {
      expect(request.url, Uri.parse('https://example.com/api/meta'));
      return http.Response(
        jsonEncode({
          'environment': 'dev',
          'workerVersionId': 'version-id',
          'workerVersionTag': 'git-candidate',
          'deployedAt': '2026-07-19T01:02:03.000Z',
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final controller = DeploymentController(
      ApiClient(client: client, baseUrl: 'https://example.com/'),
    );

    await controller.initialize();

    expect(controller.apiBaseUrl, 'https://example.com');
    expect(controller.loading, isFalse);
    expect(controller.error, isNull);
    expect(controller.metadata?.environment, 'dev');
    expect(controller.metadata?.workerVersionId, 'version-id');
    expect(controller.metadata?.workerVersionTag, 'git-candidate');
    expect(controller.metadata?.deployedAt, DateTime.utc(2026, 7, 19, 1, 2, 3));
  });

  test('rejects fields outside the public metadata contract', () async {
    final client = MockClient(
      (_) async => http.Response(
        jsonEncode({
          'environment': 'production',
          'workerVersionId': 'version-id',
          'workerVersionTag': 'git-candidate',
          'deployedAt': '2026-07-19T01:02:03.000Z',
          'accountId': 'must-not-be-exposed',
        }),
        200,
      ),
    );
    final controller = DeploymentController(
      ApiClient(client: client, baseUrl: 'https://example.com'),
    );

    await controller.initialize();

    expect(controller.metadata, isNull);
    expect(controller.error, '暂时无法读取部署信息。');
  });

  test('fails safely for invalid values and can retry', () async {
    var attempts = 0;
    final client = MockClient((_) async {
      attempts += 1;
      return http.Response(
        jsonEncode({
          'environment': attempts == 1 ? 'preview' : 'production',
          'workerVersionId': 'version-id',
          'workerVersionTag': 'git-candidate',
          'deployedAt': '2026-07-19T01:02:03.000Z',
        }),
        200,
      );
    });
    final controller = DeploymentController(
      ApiClient(client: client, baseUrl: 'https://example.com'),
    );

    await controller.initialize();
    expect(controller.metadata, isNull);
    expect(controller.error, isNotNull);

    await controller.refresh();
    expect(controller.error, isNull);
    expect(controller.metadata?.environment, 'production');
    expect(attempts, 2);
  });
}
