import 'package:flutter/foundation.dart';

import 'data/brief_repository.dart';
import 'models.dart';

class AppModel extends ChangeNotifier {
  AppModel(this.repository);
  final BriefRepository repository;

  Brief? latest;
  DateTime? fetchedAt;
  bool offline = false;
  bool loadingLatest = true;
  String? latestError;
  List<BriefSummary> archive = [];
  String? archiveCursor;
  bool archiveHasMore = true;
  bool loadingArchive = false;
  bool archiveInitialized = false;
  String? archiveError;

  Future<void> initialize() async {
    final cached = await repository.cachedLatest();
    if (cached != null) {
      latest = cached.value;
      fetchedAt = cached.fetchedAt;
      offline = true;
      loadingLatest = false;
      notifyListeners();
    }
    await refreshLatest();
  }

  Future<void> refreshLatest() async {
    if (latest == null) loadingLatest = true;
    latestError = null;
    notifyListeners();
    try {
      final result = await repository.refreshLatest();
      latest = result.value;
      fetchedAt = result.fetchedAt;
      offline = result.offline;
    } catch (_) {
      latestError = '暂时无法加载简报，请检查网络后重试。';
    } finally {
      loadingLatest = false;
      notifyListeners();
    }
  }

  Future<void> initializeArchive() async {
    if (archiveInitialized) return;
    archiveInitialized = true;
    try {
      archive = await repository.cachedArchive();
      notifyListeners();
    } catch (_) {
      archiveError = '本地归档暂时不可用。';
    }
    await loadMoreArchive();
  }

  Future<void> loadMoreArchive() async {
    if (loadingArchive || !archiveHasMore) return;
    loadingArchive = true;
    archiveError = null;
    notifyListeners();
    try {
      final page = await repository.loadArchive(cursor: archiveCursor);
      final byDate = {
        for (final item in archive) item.date: item,
        for (final item in page.briefs) item.date: item,
      };
      archive = byDate.values.toList()
        ..sort((a, b) => b.date.compareTo(a.date));
      archiveCursor = page.nextCursor;
      archiveHasMore = page.nextCursor != null;
    } catch (_) {
      archiveError = archive.isEmpty ? '暂时无法加载历史简报。' : '更多简报加载失败。';
    } finally {
      loadingArchive = false;
      notifyListeners();
    }
  }
}
