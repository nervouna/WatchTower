import 'package:flutter/foundation.dart';

import '../data/api_client.dart';

class DeploymentMetadata {
  const DeploymentMetadata({
    required this.environment,
    required this.workerVersionId,
    required this.workerVersionTag,
    required this.deployedAt,
  });

  final String environment;
  final String workerVersionId;
  final String workerVersionTag;
  final DateTime deployedAt;

  factory DeploymentMetadata.fromJson(Map<String, dynamic> json) {
    const fields = {
      'environment',
      'workerVersionId',
      'workerVersionTag',
      'deployedAt',
    };
    if (json.length != fields.length ||
        fields.any((field) => !json.containsKey(field))) {
      throw const FormatException('Invalid deployment metadata fields.');
    }

    final environment = json['environment'];
    final workerVersionId = json['workerVersionId'];
    final workerVersionTag = json['workerVersionTag'];
    final deployedAtValue = json['deployedAt'];
    if (environment is! String ||
        (environment != 'dev' && environment != 'production') ||
        workerVersionId is! String ||
        workerVersionId.trim().isEmpty ||
        workerVersionTag is! String ||
        !workerVersionTag.startsWith('git-') ||
        workerVersionTag.length == 4 ||
        deployedAtValue is! String) {
      throw const FormatException('Invalid deployment metadata values.');
    }
    final deployedAt = DateTime.tryParse(deployedAtValue);
    if (deployedAt == null) {
      throw const FormatException('Invalid deployment timestamp.');
    }

    return DeploymentMetadata(
      environment: environment,
      workerVersionId: workerVersionId,
      workerVersionTag: workerVersionTag,
      deployedAt: deployedAt.toUtc(),
    );
  }
}

class DeploymentController extends ChangeNotifier {
  DeploymentController(this._api);

  final ApiClient _api;

  DeploymentMetadata? metadata;
  bool loading = false;
  String? error;

  String get apiBaseUrl => _api.baseUrl;

  Future<void> initialize() => refresh();

  Future<void> refresh() async {
    if (loading) return;
    loading = true;
    error = null;
    notifyListeners();
    try {
      metadata = DeploymentMetadata.fromJson(await _api.getJson('/api/meta'));
    } on Object {
      metadata = null;
      error = '暂时无法读取部署信息。';
    } finally {
      loading = false;
      notifyListeners();
    }
  }
}
