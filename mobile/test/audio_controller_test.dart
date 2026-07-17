import 'package:flutter_test/flutter_test.dart';
import 'package:watchtower/audio/audio_controller.dart';
import 'package:watchtower/data/api_client.dart';
import 'package:watchtower/data/brief_repository.dart';
import 'package:watchtower/data/local_database.dart';

BriefRepository _repository() => BriefRepository(
  api: ApiClient(baseUrl: 'https://example.com'),
  database: LocalDatabase(),
);

void main() {
  test('audio initialization failure degrades without escaping', () async {
    final controller = AudioController(
      _repository(),
      initializer: () async => throw StateError('audio unavailable'),
    );

    await controller.initialize();

    expect(controller.availability, AudioAvailability.unavailable);
    expect(controller.error, '音频暂时不可用，文字简报不受影响。');
    await controller.toggleCurrent();
    await controller.stop();
    controller.dispose();
  });
}
