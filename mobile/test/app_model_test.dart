import 'package:flutter_test/flutter_test.dart';
import 'package:watchtower/app_model.dart';
import 'package:watchtower/data/api_client.dart';
import 'package:watchtower/data/brief_repository.dart';
import 'package:watchtower/data/local_database.dart';
import 'package:watchtower/models.dart';

Brief _brief() => Brief(
  date: '2026-07-17',
  status: 'complete',
  publishedAt: DateTime.utc(2026, 7, 17),
  generatedAt: DateTime.utc(2026, 7, 16, 23, 30),
  headline: '今天值得关注的技术信号',
  intro: '缓存异常后通过网络恢复的测试简报。',
  missingSources: const [],
  sourceCounts: const {
    'hacker-news': 1,
    'product-hunt': 1,
    'github': 1,
    'kickstarter': 1,
  },
  audio: null,
  items: const [],
);

class FakeBriefRepository extends BriefRepository {
  FakeBriefRepository({
    required this.refreshResult,
    this.cachedFailure,
    this.refreshFailure,
  }) : super(
         api: ApiClient(baseUrl: 'https://example.com'),
         database: LocalDatabase(),
       );

  final LoadResult<Brief> refreshResult;
  final Object? cachedFailure;
  final Object? refreshFailure;

  @override
  Future<LoadResult<Brief>?> cachedLatest() async {
    if (cachedFailure != null) throw cachedFailure!;
    return null;
  }

  @override
  Future<LoadResult<Brief>> refreshLatest() async {
    if (refreshFailure != null) throw refreshFailure!;
    return refreshResult;
  }
}

void main() {
  final online = LoadResult(
    value: _brief(),
    fetchedAt: DateTime(2026, 7, 17, 8),
    offline: false,
  );

  test('cache failure falls through to a successful network refresh', () async {
    final model = AppModel(
      FakeBriefRepository(
        refreshResult: online,
        cachedFailure: const FormatException('corrupt cache'),
      ),
    );

    await model.initialize();

    expect(model.loadingLatest, isFalse);
    expect(model.latest?.date, '2026-07-17');
    expect(model.latestError, isNull);
    expect(model.offline, isFalse);
  });

  test(
    'cache and network failures end loading with a retryable error',
    () async {
      final model = AppModel(
        FakeBriefRepository(
          refreshResult: online,
          cachedFailure: const FormatException('corrupt cache'),
          refreshFailure: const ApiException('network unavailable'),
        ),
      );

      await model.initialize();

      expect(model.loadingLatest, isFalse);
      expect(model.latest, isNull);
      expect(model.latestError, '暂时无法加载简报，请检查网络后重试。');
    },
  );
}
