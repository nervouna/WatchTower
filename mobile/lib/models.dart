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
  });

  factory BriefAudio.fromJson(Object? value) {
    final json = _map(value, 'audio');
    final status = _string(json, 'status');
    if (!const {'pending', 'failed', 'ready'}.contains(status)) {
      return _invalid('audio.status');
    }
    if (status != 'ready') return BriefAudio(status: status);
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
    );
  }

  final String status;
  final String? url;
  final double? durationSeconds;
  final String? transcript;
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
    this.explorationEnabled = false,
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
      explorationEnabled:
          json['features'] is Map<String, dynamic> &&
          (json['features'] as Map<String, dynamic>)['exploration'] == true,
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
  final bool explorationEnabled;
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

class ExplorationSource {
  const ExplorationSource({
    required this.id,
    required this.title,
    required this.url,
    required this.domain,
    required this.queryKind,
  });
  factory ExplorationSource.fromJson(Object? value) {
    final json = _map(value, 'exploration.source');
    final queryKind = _string(json, 'queryKind');
    final url = Uri.tryParse(_string(json, 'url'));
    if (!const {
          'context',
          'products',
          'perspectives',
          'industry',
        }.contains(queryKind) ||
        url == null ||
        !const {'http', 'https'}.contains(url.scheme)) {
      return _invalid('exploration.source');
    }
    return ExplorationSource(
      id: _string(json, 'id'),
      title: _string(json, 'title'),
      url: url,
      domain: _string(json, 'domain'),
      queryKind: queryKind,
    );
  }
  final String id;
  final String title;
  final Uri url;
  final String domain;
  final String queryKind;
}

class CitedText {
  const CitedText({required this.text, required this.sourceIds});
  factory CitedText.fromJson(Object? value) {
    final json = _map(value, 'citedText');
    return CitedText(
      text: _string(json, 'text'),
      sourceIds: _strings(json, 'sourceIds'),
    );
  }
  final String text;
  final List<String> sourceIds;
}

class RelatedProduct {
  const RelatedProduct({
    required this.name,
    required this.relation,
    required this.summary,
    required this.sourceIds,
  });
  factory RelatedProduct.fromJson(Object? value) {
    final json = _map(value, 'relatedProduct');
    return RelatedProduct(
      name: _string(json, 'name'),
      relation: _string(json, 'relation'),
      summary: _string(json, 'summary'),
      sourceIds: _strings(json, 'sourceIds'),
    );
  }
  final String name;
  final String relation;
  final String summary;
  final List<String> sourceIds;
}

class ExternalPerspective {
  const ExternalPerspective({
    required this.label,
    required this.summary,
    required this.sourceIds,
  });
  factory ExternalPerspective.fromJson(Object? value) {
    final json = _map(value, 'perspective');
    return ExternalPerspective(
      label: _string(json, 'label'),
      summary: _string(json, 'summary'),
      sourceIds: _strings(json, 'sourceIds'),
    );
  }
  final String label;
  final String summary;
  final List<String> sourceIds;
}

class WatchSignal {
  const WatchSignal({required this.signal, required this.sourceIds});
  factory WatchSignal.fromJson(Object? value) {
    final json = _map(value, 'watchSignal');
    return WatchSignal(
      signal: _string(json, 'signal'),
      sourceIds: _strings(json, 'sourceIds'),
    );
  }
  final String signal;
  final List<String> sourceIds;
}

class ExplorationSections {
  const ExplorationSections({
    required this.overview,
    required this.relatedProducts,
    required this.perspectives,
    required this.industry,
    required this.watchNext,
  });
  factory ExplorationSections.fromJson(Object? value) {
    final json = _map(value, 'exploration.sections');
    return ExplorationSections(
      overview: CitedText.fromJson(json['overview']),
      relatedProducts: _list(
        json,
        'relatedProducts',
      ).map(RelatedProduct.fromJson).toList(growable: false),
      perspectives: _list(
        json,
        'perspectives',
      ).map(ExternalPerspective.fromJson).toList(growable: false),
      industry: json['industry'] == null
          ? null
          : CitedText.fromJson(json['industry']),
      watchNext: _list(
        json,
        'watchNext',
      ).map(WatchSignal.fromJson).toList(growable: false),
    );
  }
  final CitedText overview;
  final List<RelatedProduct> relatedProducts;
  final List<ExternalPerspective> perspectives;
  final CitedText? industry;
  final List<WatchSignal> watchNext;
}

class Exploration {
  const Exploration({
    required this.entityId,
    required this.title,
    required this.status,
    this.quality,
    this.generatedAt,
    this.expiresAt,
    this.stale = false,
    this.refreshing = false,
    this.refreshLimited = false,
    this.sections,
    this.sources = const [],
    this.pollAfterSeconds,
    this.retryAt,
  });

  factory Exploration.fromJson(Map<String, dynamic> json) {
    final status = _string(json, 'status');
    if (!const {
      'queued',
      'researching',
      'synthesizing',
      'ready',
      'failed',
    }.contains(status)) {
      return _invalid('exploration.status');
    }
    final quality = json['quality'];
    if (quality != null && !const {'complete', 'partial'}.contains(quality)) {
      return _invalid('exploration.quality');
    }
    final poll = json['pollAfterSeconds'];
    if (poll != null && poll is! int) {
      return _invalid('exploration.pollAfterSeconds');
    }
    return Exploration(
      entityId: _string(json, 'entityId'),
      title: _string(json, 'title'),
      status: status,
      quality: quality as String?,
      generatedAt: json['generatedAt'] is String
          ? DateTime.parse(json['generatedAt'] as String)
          : null,
      expiresAt: json['expiresAt'] is String
          ? DateTime.parse(json['expiresAt'] as String)
          : null,
      stale: json['stale'] == true,
      refreshing: json['refreshing'] == true,
      refreshLimited: json['refreshLimited'] == true,
      sections: json['sections'] == null
          ? null
          : ExplorationSections.fromJson(json['sections']),
      sources: json['sources'] == null
          ? const []
          : _list(
              json,
              'sources',
            ).map(ExplorationSource.fromJson).toList(growable: false),
      pollAfterSeconds: poll as int?,
      retryAt: json['retryAt'] is String
          ? DateTime.parse(json['retryAt'] as String)
          : null,
    );
  }

  factory Exploration.decode(String value) =>
      Exploration.fromJson(_map(jsonDecode(value), 'exploration'));
  final String entityId;
  final String title;
  final String status;
  final String? quality;
  final DateTime? generatedAt;
  final DateTime? expiresAt;
  final bool stale;
  final bool refreshing;
  final bool refreshLimited;
  final ExplorationSections? sections;
  final List<ExplorationSource> sources;
  final int? pollAfterSeconds;
  final DateTime? retryAt;
  bool get ready => status == 'ready' && sections != null;
}
