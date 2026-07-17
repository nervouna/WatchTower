import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:watchtower/data/api_client.dart';
import 'package:watchtower/data/brief_repository.dart';
import 'package:watchtower/data/local_database.dart';
import 'package:watchtower/models.dart';
import 'package:watchtower/ui/screens.dart';

class FakeExplorationRepository extends BriefRepository {
  FakeExplorationRepository(this.result)
    : super(
        api: ApiClient(baseUrl: 'https://example.com'),
        database: LocalDatabase(),
      );
  final LoadResult<Exploration> result;
  @override
  Future<LoadResult<Exploration>> loadExploration(
    String briefDate,
    String entityId,
  ) async => result;
}

void main() {
  testWidgets(
    'renders the fixed exploration sections, sources, and offline state',
    (tester) async {
      final source = ExplorationSource(
        id: 'source_01',
        title: 'Official source',
        url: Uri(scheme: 'https', host: 'example.com'),
        domain: 'example.com',
        queryKind: 'context',
      );
      final exploration = Exploration(
        entityId: 'entity_00000000000000000000000000000001',
        title: 'Acme',
        status: 'ready',
        quality: 'partial',
        generatedAt: DateTime.utc(2026, 7, 17),
        sections: const ExplorationSections(
          overview: CitedText(text: '这是有来源的展开说明。', sourceIds: ['source_01']),
          relatedProducts: [],
          perspectives: [],
          industry: null,
          watchNext: [],
        ),
        sources: [source],
      );
      final repository = FakeExplorationRepository(
        LoadResult(
          value: exploration,
          fetchedAt: DateTime.utc(2026, 7, 17),
          offline: true,
        ),
      );
      await tester.pumpWidget(
        Provider<BriefRepository>.value(
          value: repository,
          child: const MaterialApp(
            home: Scaffold(
              body: ExplorationScreen(
                briefDate: '2026-07-17',
                entityId: 'entity_00000000000000000000000000000001',
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('展开说明'), findsOneWidget);
      expect(find.text('相关产品'), findsOneWidget);
      expect(find.text('外部观点'), findsOneWidget);
      expect(find.text('行业位置'), findsOneWidget);
      expect(find.text('接下来关注什么'), findsOneWidget);
      expect(find.textContaining('离线缓存'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('资料来源'), 400);
      expect(find.text('资料来源'), findsOneWidget);
      await tester.scrollUntilVisible(find.textContaining('AI 基于公开资料整理'), 400);
      expect(find.textContaining('AI 基于公开资料整理'), findsOneWidget);
    },
  );
}
