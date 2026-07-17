import 'package:path/path.dart' as path;
import 'package:sqflite/sqflite.dart';

class CachedBrief {
  const CachedBrief({required this.json, required this.fetchedAt, this.etag});
  final String json;
  final DateTime fetchedAt;
  final String? etag;
}

class CachedExploration {
  const CachedExploration({
    required this.json,
    required this.fetchedAt,
    this.etag,
  });
  final String json;
  final DateTime fetchedAt;
  final String? etag;
}

class LocalDatabase {
  Database? _database;

  Future<Database> get database async => _database ??= await openDatabase(
    path.join(await getDatabasesPath(), 'watchtower.db'),
    version: 2,
    onCreate: (db, _) async {
      await db.execute(
        'CREATE TABLE briefs (date TEXT PRIMARY KEY, json TEXT NOT NULL, etag TEXT, fetched_at TEXT NOT NULL)',
      );
      await db.execute(
        'CREATE TABLE archive (date TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at TEXT NOT NULL)',
      );
      await db.execute(
        'CREATE TABLE explorations (entity_id TEXT PRIMARY KEY, json TEXT NOT NULL, etag TEXT, fetched_at TEXT NOT NULL)',
      );
    },
    onUpgrade: (db, oldVersion, _) async {
      if (oldVersion < 2) {
        await db.execute(
          'CREATE TABLE explorations (entity_id TEXT PRIMARY KEY, json TEXT NOT NULL, etag TEXT, fetched_at TEXT NOT NULL)',
        );
      }
    },
  );

  Future<CachedBrief?> latestBrief() async {
    final rows = await (await database).query(
      'briefs',
      orderBy: 'date DESC',
      limit: 1,
    );
    return rows.isEmpty ? null : _brief(rows.first);
  }

  Future<CachedBrief?> brief(String date) async {
    final rows = await (await database).query(
      'briefs',
      where: 'date = ?',
      whereArgs: [date],
      limit: 1,
    );
    return rows.isEmpty ? null : _brief(rows.first);
  }

  CachedBrief _brief(Map<String, Object?> row) => CachedBrief(
    json: row['json']! as String,
    etag: row['etag'] as String?,
    fetchedAt: DateTime.parse(row['fetched_at']! as String),
  );

  Future<void> saveBrief({
    required String date,
    required String json,
    required DateTime fetchedAt,
    String? etag,
  }) async {
    await (await database).insert('briefs', {
      'date': date,
      'json': json,
      'etag': etag,
      'fetched_at': fetchedAt.toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> touchBrief(String date, DateTime fetchedAt) async {
    await (await database).update(
      'briefs',
      {'fetched_at': fetchedAt.toIso8601String()},
      where: 'date = ?',
      whereArgs: [date],
    );
  }

  Future<void> saveArchive(List<Map<String, Object?>> rows) async {
    final batch = (await database).batch();
    for (final row in rows) {
      batch.insert(
        'archive',
        row,
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }
    await batch.commit(noResult: true);
  }

  Future<List<String>> archiveJson() async {
    final rows = await (await database).query('archive', orderBy: 'date DESC');
    return rows.map((row) => row['json']! as String).toList(growable: false);
  }

  Future<CachedExploration?> exploration(String entityId) async {
    final rows = await (await database).query(
      'explorations',
      where: 'entity_id = ?',
      whereArgs: [entityId],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    final row = rows.first;
    return CachedExploration(
      json: row['json']! as String,
      etag: row['etag'] as String?,
      fetchedAt: DateTime.parse(row['fetched_at']! as String),
    );
  }

  Future<void> saveExploration({
    required String entityId,
    required String json,
    required DateTime fetchedAt,
    String? etag,
  }) async {
    await (await database).insert('explorations', {
      'entity_id': entityId,
      'json': json,
      'etag': etag,
      'fetched_at': fetchedAt.toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }
}
