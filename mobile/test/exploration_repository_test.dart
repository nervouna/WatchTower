import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:watchtower/data/api_client.dart';
import 'package:watchtower/data/brief_repository.dart';
import 'package:watchtower/data/local_database.dart';

const _ready = '''{
  "entityId":"entity_00000000000000000000000000000001",
  "title":"Acme","status":"ready","quality":"partial",
  "generatedAt":"2026-07-17T00:00:00.000Z","expiresAt":"2026-07-18T00:00:00.000Z",
  "sections":{"overview":{"text":"背景说明","sourceIds":["source_01"]},"relatedProducts":[],"perspectives":[],"industry":null,"watchNext":[]},
  "sources":[{"id":"source_01","title":"Official","url":"https://example.com","domain":"example.com","queryKind":"context"}]
}''';

class FakeDatabase extends LocalDatabase {
  CachedExploration? cached;
  String? saved;

  @override
  Future<CachedExploration?> exploration(String entityId) async => cached;

  @override
  Future<void> saveExploration({
    required String entityId,
    required String json,
    required DateTime fetchedAt,
    String? etag,
  }) async {
    saved = json;
  }
}

void main() {
  test(
    'POSTs, polls a pending exploration, and caches the ready result',
    () async {
      var calls = 0;
      final client = MockClient((request) async {
        calls += 1;
        if (calls == 1) {
          expect(request.method, 'POST');
          return http.Response(
            '{"entityId":"entity_00000000000000000000000000000001","title":"Acme","status":"queued","pollAfterSeconds":0}',
            202,
          );
        }
        expect(request.method, 'GET');
        return http.Response(
          _ready,
          200,
          headers: {
            'etag': 'ready-tag',
            'content-type': 'application/json; charset=utf-8',
          },
        );
      });
      final database = FakeDatabase();
      final repository = BriefRepository(
        api: ApiClient(client: client, baseUrl: 'https://example.com'),
        database: database,
      );
      final result = await repository.loadExploration(
        '2026-07-17',
        'entity_00000000000000000000000000000001',
      );
      expect(result.offline, isFalse);
      expect(result.value.ready, isTrue);
      expect(database.saved, _ready);
      expect(calls, 2);
    },
  );

  test(
    'falls back to the last cached exploration when the network fails',
    () async {
      final database = FakeDatabase()
        ..cached = CachedExploration(
          json: _ready,
          fetchedAt: DateTime.utc(2026, 7, 17),
        );
      final repository = BriefRepository(
        api: ApiClient(
          client: MockClient((_) async => http.Response('offline', 503)),
          baseUrl: 'https://example.com',
        ),
        database: database,
      );
      final result = await repository.loadExploration(
        '2026-07-17',
        'entity_00000000000000000000000000000001',
      );
      expect(result.offline, isTrue);
      expect(result.value.ready, isTrue);
    },
  );
}
