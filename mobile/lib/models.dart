import 'dart:convert';

const sourceNames = <String, String>{
  'hacker-news': 'Hacker News',
  'product-hunt': 'Product Hunt',
  'github': 'GitHub',
  'kickstarter': 'Kickstarter',
};

Never _invalid(String field) =>
    throw FormatException('Invalid API field: $field');

Map<String, dynamic> _map(Object? value, String field) {
  if (value is Map<String, dynamic>) return value;
  return _invalid(field);
}

String _string(Map<String, dynamic> json, String field) {
  final value = json[field];
  return value is String ? value : _invalid(field);
}

int _int(Map<String, dynamic> json, String field) {
  final value = json[field];
  return value is int ? value : _invalid(field);
}

List<dynamic> _list(Map<String, dynamic> json, String field) {
  final value = json[field];
  return value is List<dynamic> ? value : _invalid(field);
}

List<String> _strings(Map<String, dynamic> json, String field) =>
    _list(json, field)
        .map((value) => value is String ? value : _invalid(field))
        .toList(growable: false);

class SourceLink {
  const SourceLink({
    required this.source,
    required this.kind,
    required this.label,
    required this.url,
  });

  factory SourceLink.fromJson(Object? value) {
    final json = _map(value, 'source');
    final source = _string(json, 'source');
    final kind = _string(json, 'kind');
    final url = Uri.tryParse(_string(json, 'url'));
    if (!sourceNames.containsKey(source) ||
        !const {'platform', 'original'}.contains(kind) ||
        url == null ||
        !url.hasScheme) {
      return _invalid('source');
    }
    return SourceLink(
      source: source,
      kind: kind,
      label: _string(json, 'label'),
      url: url,
    );
  }

  final String source;
  final String kind;
  final String label;
  final Uri url;
}

class Continuity {
  const Continuity({
    required this.kind,
    this.previousDate,
    this.materialChange,
  });

  factory Continuity.fromJson(Object? value) {
    final json = _map(value, 'continuity');
    final kind = _string(json, 'kind');
    if (kind == 'new') return const Continuity(kind: 'new');
    if (kind == 'continuing') {
      return Continuity(
        kind: kind,
        previousDate: _string(json, 'previousDate'),
        materialChange: _string(json, 'materialChange'),
      );
    }
    return _invalid('continuity.kind');
  }

  final String kind;
  final String? previousDate;
  final String? materialChange;
}

class BriefItem {
  const BriefItem({
    required this.rank,
    required this.entityId,
    required this.title,
    required this.summary,
    required this.whyItMatters,
    required this.tags,
    required this.continuity,
    required this.sources,
  });

  factory BriefItem.fromJson(Object? value) {
    final json = _map(value, 'item');
    return BriefItem(
      rank: _int(json, 'rank'),
      entityId: _string(json, 'entityId'),
      title: _string(json, 'title'),
      summary: _string(json, 'summary'),
      whyItMatters: _string(json, 'whyItMatters'),
      tags: _strings(json, 'tags'),
      continuity: Continuity.fromJson(json['continuity']),
      sources: _list(
        json,
        'sources',
      ).map(SourceLink.fromJson).toList(growable: false),
    );
  }

  final int rank;
  final String entityId;
  final String title;
  final String summary;
  final String whyItMatters;
  final List<String> tags;
  final Continuity continuity;
  final List<SourceLink> sources;
}

class BriefAudio {
  const BriefAudio({
    required this.status,
    this.url,
    this.durationSeconds,
    this.transcript,
    this.cover,
  });

  factory BriefAudio.fromJson(Object? value) {
    final json = _map(value, 'audio');
    final status = _string(json, 'status');
    if (!const {'pending', 'failed', 'ready'}.contains(status)) {
      return _invalid('audio.status');
    }
    final cover = json['cover'] == null
        ? null
        : BriefCover.fromJson(json['cover']);
    if (status != 'ready') return BriefAudio(status: status, cover: cover);
    final duration = json['durationSeconds'];
    final url = json['url'];
    final transcript = json['transcript'];
    if (duration is! num || url is! String || transcript is! String) {
      return _invalid('audio.ready');
    }
    return BriefAudio(
      status: status,
      url: url,
      durationSeconds: duration.toDouble(),
      transcript: transcript,
      cover: cover,
    );
  }

  final String status;
  final String? url;
  final double? durationSeconds;
  final String? transcript;
  final BriefCover? cover;
}

class BriefCover {
  const BriefCover({required this.status, this.url, this.generatedAt});

  factory BriefCover.fromJson(Object? value) {
    final json = _map(value, 'cover');
    final status = _string(json, 'status');
    if (!const {'pending', 'failed', 'ready'}.contains(status)) {
      return _invalid('cover.status');
    }
    if (status != 'ready') return BriefCover(status: status);
    final url = json['url'];
    final generatedAt = json['generatedAt'];
    if (url is! String || generatedAt is! String) {
      return _invalid('cover.ready');
    }
    return BriefCover(
      status: status,
      url: url,
      generatedAt: DateTime.parse(generatedAt),
    );
  }

  final String status;
  final String? url;
  final DateTime? generatedAt;
}

class Brief {
  const Brief({
    required this.date,
    required this.status,
    required this.publishedAt,
    required this.generatedAt,
    required this.headline,
    required this.intro,
    required this.missingSources,
    required this.sourceCounts,
    required this.audio,
    required this.items,
  });

  factory Brief.fromJson(Map<String, dynamic> json) {
    final status = _string(json, 'status');
    if (!const {'complete', 'partial'}.contains(status)) {
      return _invalid('status');
    }
    final counts = _map(json['sourceCounts'], 'sourceCounts');
    return Brief(
      date: _string(json, 'date'),
      status: status,
      publishedAt: DateTime.parse(_string(json, 'publishedAt')),
      generatedAt: DateTime.parse(_string(json, 'generatedAt')),
      headline: _string(json, 'headline'),
      intro: _string(json, 'intro'),
      missingSources: _strings(json, 'missingSources'),
      sourceCounts: {
        for (final source in sourceNames.keys)
          source: counts[source] is int ? counts[source] as int : 0,
      },
      audio: json['audio'] == null ? null : BriefAudio.fromJson(json['audio']),
      items: _list(
        json,
        'items',
      ).map(BriefItem.fromJson).toList(growable: false),
    );
  }

  factory Brief.decode(String value) =>
      Brief.fromJson(_map(jsonDecode(value), 'brief'));

  final String date;
  final String status;
  final DateTime publishedAt;
  final DateTime generatedAt;
  final String headline;
  final String intro;
  final List<String> missingSources;
  final Map<String, int> sourceCounts;
  final BriefAudio? audio;
  final List<BriefItem> items;
}

class BriefSummary {
  const BriefSummary({
    required this.date,
    required this.status,
    required this.publishedAt,
    required this.itemCount,
    required this.missingSources,
  });

  factory BriefSummary.fromJson(Object? value) {
    final json = _map(value, 'briefSummary');
    final status = _string(json, 'status');
    if (!const {'complete', 'partial'}.contains(status)) {
      return _invalid('briefSummary.status');
    }
    return BriefSummary(
      date: _string(json, 'date'),
      status: status,
      publishedAt: DateTime.parse(_string(json, 'publishedAt')),
      itemCount: _int(json, 'itemCount'),
      missingSources: _strings(json, 'missingSources'),
    );
  }

  final String date;
  final String status;
  final DateTime publishedAt;
  final int itemCount;
  final List<String> missingSources;
}

class BriefListPage {
  const BriefListPage({required this.briefs, required this.nextCursor});

  factory BriefListPage.fromJson(Map<String, dynamic> json) {
    final cursor = json['nextCursor'];
    if (cursor != null && cursor is! String) return _invalid('nextCursor');
    return BriefListPage(
      briefs: _list(
        json,
        'briefs',
      ).map(BriefSummary.fromJson).toList(growable: false),
      nextCursor: cursor as String?,
    );
  }

  final List<BriefSummary> briefs;
  final String? nextCursor;
}
