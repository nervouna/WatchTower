import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:watchtower/audio/audio_controller.dart';
import 'package:watchtower/data/api_client.dart';
import 'package:watchtower/data/brief_repository.dart';
import 'package:watchtower/data/local_database.dart';
import 'package:watchtower/models.dart';
import 'package:watchtower/theme.dart';
import 'package:watchtower/ui/brief_view.dart';
import 'package:watchtower/ui/screens.dart';

Brief _brief({List<BriefItem> items = const [], BriefAudio? audio}) => Brief(
  date: '2026-07-17',
  status: 'partial',
  publishedAt: DateTime.utc(2026, 7, 17),
  generatedAt: DateTime.utc(2026, 7, 16, 23, 30),
  headline: '今天值得关注的技术信号',
  intro: '一份用于界面测试的简报。',
  missingSources: const ['kickstarter'],
  sourceCounts: const {
    'hacker-news': 1,
    'product-hunt': 1,
    'github': 1,
    'kickstarter': 0,
  },
  audio: audio,
  items: items,
);

void main() {
  testWidgets('renders offline and partial states without hiding content', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: watchTowerTheme(Brightness.light),
        home: Scaffold(
          body: BriefView(
            brief: _brief(),
            offline: true,
            fetchedAt: DateTime(2026, 7, 17, 8),
          ),
        ),
      ),
    );
    expect(find.textContaining('离线内容'), findsOneWidget);
    expect(find.textContaining('本期为部分简报'), findsOneWidget);
    expect(find.text('今天值得关注的技术信号'), findsOneWidget);
    expect(find.text('本期暂无可发布热点'), findsOneWidget);
  });

  testWidgets('error state exposes a recovery action', (tester) async {
    var retried = false;
    await tester.pumpWidget(
      MaterialApp(
        theme: watchTowerTheme(Brightness.light),
        home: ErrorState(message: '网络错误', onRetry: () => retried = true),
      ),
    );
    await tester.tap(find.text('重试'));
    expect(retried, isTrue);
  });

  testWidgets('audio initialization failure keeps the brief readable', (
    tester,
  ) async {
    final repository = BriefRepository(
      api: ApiClient(baseUrl: 'https://example.com'),
      database: LocalDatabase(),
    );
    final controller = AudioController(
      repository,
      initializer: () async => throw StateError('audio unavailable'),
    );
    await controller.initialize();

    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: controller,
        child: MaterialApp(
          theme: watchTowerTheme(Brightness.light),
          home: Scaffold(
            body: BriefView(
              brief: _brief(
                audio: const BriefAudio(
                  status: 'ready',
                  url: '/api/briefs/2026-07-17/audio',
                  durationSeconds: 180,
                  transcript: '测试逐字稿',
                ),
              ),
              offline: false,
            ),
          ),
        ),
      ),
    );

    expect(find.text('今天值得关注的技术信号'), findsOneWidget);
    expect(find.text('音频暂时不可用，文字简报不受影响。'), findsOneWidget);
    expect(find.byIcon(Icons.play_arrow_rounded), findsNothing);
  });
}
