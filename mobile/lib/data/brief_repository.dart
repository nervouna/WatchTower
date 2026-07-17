import 'dart:convert';

import '../models.dart';
import 'api_client.dart';
import 'local_database.dart';

class LoadResult<T> {
  const LoadResult({
    required this.value,
    required this.fetchedAt,
    required this.offline,
  });
  final T value;
  final DateTime fetchedAt;
  final bool offline;
}

class BriefRepository {
  BriefRepository({required this._api, required this._database});
  final ApiClient _api;
  final LocalDatabase _database;

  Uri resolve(String path) => _api.resolve(path);

  Future<LoadResult<Brief>?> cachedLatest() async {
    final cached = await _database.latestBrief();
    return cached == null
        ? null
        : LoadResult(
            value: Brief.decode(cached.json),
            fetchedAt: cached.fetchedAt,
            offline: true,
          );
  }

  Future<LoadResult<Brief>> refreshLatest() async {
    final cached = await _database.latestBrief();
    try {
      final response = await _api.get('/api/briefs/latest', etag: cached?.etag);
      if (response.statusCode == 304 && cached != null) {
        final now = DateTime.now();
        await _database.touchBrief(Brief.decode(cached.json).date, now);
        return LoadResult(
          value: Brief.decode(cached.json),
          fetchedAt: now,
          offline: false,
        );
      }
      final brief = Brief.decode(response.body);
      final now = DateTime.now();
      await _database.saveBrief(
        date: brief.date,
        json: response.body,
        fetchedAt: now,
        etag: response.etag,
      );
      return LoadResult(value: brief, fetchedAt: now, offline: false);
    } catch (_) {
      if (cached == null) rethrow;
      return LoadResult(
        value: Brief.decode(cached.json),
        fetchedAt: cached.fetchedAt,
        offline: true,
      );
    }
  }

  Future<LoadResult<Brief>> loadBrief(String date) async {
    final cached = await _database.brief(date);
    try {
      final response = await _api.get('/api/briefs/$date', etag: cached?.etag);
      if (response.statusCode == 304 && cached != null) {
        final now = DateTime.now();
        await _database.touchBrief(date, now);
        return LoadResult(
          value: Brief.decode(cached.json),
          fetchedAt: now,
          offline: false,
        );
      }
      final brief = Brief.decode(response.body);
      final now = DateTime.now();
      await _database.saveBrief(
        date: brief.date,
        json: response.body,
        fetchedAt: now,
        etag: response.etag,
      );
      return LoadResult(value: brief, fetchedAt: now, offline: false);
    } catch (_) {
      if (cached == null) rethrow;
      return LoadResult(
        value: Brief.decode(cached.json),
        fetchedAt: cached.fetchedAt,
        offline: true,
      );
    }
  }

  Future<List<BriefSummary>> cachedArchive() async =>
      (await _database.archiveJson())
          .map((value) => BriefSummary.fromJson(jsonDecode(value)))
          .toList(growable: false);

  Future<BriefListPage> loadArchive({String? cursor}) async {
    final query = <String, String>{'limit': '20', 'cursor': ?cursor};
    final uri = Uri(path: '/api/briefs', queryParameters: query);
    final response = await _api.get(uri.toString());
    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Invalid archive payload');
    }
    final page = BriefListPage.fromJson(decoded);
    final now = DateTime.now().toIso8601String();
    await _database.saveArchive([
      for (final raw in decoded['briefs'] as List<dynamic>)
        {
          'date': (raw as Map<String, dynamic>)['date'] as String,
          'json': jsonEncode(raw),
          'fetched_at': now,
        },
    ]);
    return page;
  }

  Future<LoadResult<Exploration>> loadExploration(
    String briefDate,
    String entityId,
  ) async {
    final cached = await _database.exploration(entityId);
    final path = '/api/explorations/$briefDate/$entityId';
    try {
      var response = await _api.post(path);
      var exploration = Exploration.decode(response.body);
      final deadline = DateTime.now().add(const Duration(seconds: 95));
      while (!exploration.ready &&
          exploration.status != 'failed' &&
          DateTime.now().isBefore(deadline)) {
        await Future<void>.delayed(
          Duration(seconds: exploration.pollAfterSeconds ?? 3),
        );
        response = await _api.get(path);
        exploration = Exploration.decode(response.body);
      }
      if (!exploration.ready) throw const ApiException('本次探索未完成，可稍后重试。');
      final fetchedAt = DateTime.now();
      await _database.saveExploration(
        entityId: entityId,
        json: response.body,
        fetchedAt: fetchedAt,
        etag: response.etag,
      );
      return LoadResult(
        value: exploration,
        fetchedAt: fetchedAt,
        offline: false,
      );
    } catch (_) {
      if (cached == null) rethrow;
      return LoadResult(
        value: Exploration.decode(cached.json),
        fetchedAt: cached.fetchedAt,
        offline: true,
      );
    }
  }
}
