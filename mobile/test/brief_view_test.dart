import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:watchtower/audio/audio_controller.dart';
import 'package:watchtower/auth/auth_controller.dart';
import 'package:watchtower/data/api_client.dart';
import 'package:watchtower/data/brief_repository.dart';
import 'package:watchtower/data/local_database.dart';
import 'package:watchtower/models.dart';
import 'package:watchtower/theme.dart';
import 'package:watchtower/ui/brief_view.dart';
import 'package:watchtower/ui/screens.dart';

Brief _brief({
  List<BriefItem> items = const [],
  BriefAudio? audio,
  bool explorationEnabled = false,
  String status = 'partial',
  List<String> missingSources = const ['kickstarter'],
  Map<String, int> sourceCounts = const {
    'hacker-news': 1,
    'product-hunt': 1,
    'github': 1,
    'kickstarter': 0,
  },
}) => Brief(
  date: '2026-07-17',
  status: status,
  publishedAt: DateTime.utc(2026, 7, 17),
  generatedAt: DateTime.utc(2026, 7, 16, 23, 30),
  headline: '今天值得关注的技术信号',
  intro: '一份用于界面测试的简报。',
  missingSources: missingSources,
  sourceCounts: sourceCounts,
  audio: audio,
  items: items,
  explorationEnabled: explorationEnabled,
);

final _item = BriefItem(
  rank: 1,
  entityId: 'entity_00000000000000000000000000000001',
  title: '一条值得关注的产品信号',
  summary: '这是需要保持左对齐的正文摘要。',
  whyItMatters: '这是需要保持左对齐的正文解释。',
  tags: ['产品', 'AI'],
  continuity: const Continuity(kind: 'new'),
  sources: [
    SourceLink(
      source: 'hacker-news',
      kind: 'original',
      label: '原文',
      url: Uri.parse('https://example.com/article'),
    ),
  ],
);

const _readyAudio = BriefAudio(
  status: 'ready',
  url: '/api/briefs/2026-07-17/audio',
  durationSeconds: 147,
  transcript: '测试逐字稿',
  cover: BriefCover(status: 'pending'),
);

AudioController _readyAudioController() {
  final repository = BriefRepository(
    api: ApiClient(baseUrl: 'https://example.com'),
    database: LocalDatabase(),
  );
  return AudioController(
    repository,
    initializer: () async => WatchTowerAudioHandler(),
  );
}

class _TrackingAuthController extends AuthController {
  _TrackingAuthController()
    : super(api: ApiClient(baseUrl: 'https://example.com'));

  int feedbackLoads = 0;

  @override
  Future<void> loadFeedback(Iterable<String> entityIds) async {
    feedbackLoads += 1;
  }
}

class _RetryTrackingAuthController extends AuthController {
  _RetryTrackingAuthController()
    : super(api: ApiClient(baseUrl: 'https://example.com'));

  int retries = 0;

  @override
  Future<void> retryAudio(String date) async {
    retries += 1;
  }
}

void main() {
  testWidgets('centers editorial chrome while keeping prose left aligned', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: watchTowerTheme(Brightness.light),
        home: Scaffold(
          body: BriefView(brief: _brief(items: [_item]), offline: false),
        ),
      ),
    );

    expect(
      tester.widget<Text>(find.text('今天值得关注的技术信号')).textAlign,
      TextAlign.center,
    );
    expect(tester.widget<Text>(find.text('本期热点')).textAlign, TextAlign.center);
    expect(
      tester.widget<Text>(find.text(_item.title)).textAlign,
      TextAlign.center,
    );
    expect(
      tester.widget<Text>(find.text(_item.summary)).textAlign,
      isNot(TextAlign.center),
    );
    expect(
      tester.widget<Text>(find.text(_item.whyItMatters)).textAlign,
      isNot(TextAlign.center),
    );
  });

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
    expect(find.textContaining('暂缺'), findsNothing);
    expect(find.text('今天值得关注的技术信号'), findsOneWidget);
    expect(find.text('2026-07-17 · UTC'), findsNothing);
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
                  cover: BriefCover(
                    status: 'ready',
                    url: '/api/briefs/2026-07-17/cover',
                    generatedAt: null,
                  ),
                ),
              ),
              offline: false,
            ),
          ),
        ),
      ),
    );

    expect(find.text('今天值得关注的技术信号'), findsOneWidget);
    expect(find.byType(Image), findsOneWidget);
    expect(find.text('音频暂时不可用，文字简报不受影响。'), findsOneWidget);
    expect(find.byIcon(Icons.play_arrow_rounded), findsNothing);
  });

  testWidgets('audio copy adapts to ready and pending duration states', (
    tester,
  ) async {
    final repository = BriefRepository(
      api: ApiClient(baseUrl: 'https://example.com'),
      database: LocalDatabase(),
    );
    final controller = AudioController(
      repository,
      initializer: () async => WatchTowerAudioHandler(),
    );
    await controller.initialize();
    addTearDown(controller.dispose);
    Future<void> pump(BriefAudio audio) => tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: controller,
        child: MaterialApp(
          theme: watchTowerTheme(Brightness.light),
          home: Scaffold(
            body: BriefView(brief: _brief(audio: audio), offline: false),
          ),
        ),
      ),
    );

    await pump(
      const BriefAudio(
        status: 'ready',
        url: '/api/briefs/2026-07-17/audio',
        durationSeconds: 70,
        transcript: '测试逐字稿',
        cover: null,
      ),
    );
    expect(find.text('约 1 分钟听完本期'), findsOneWidget);
    expect(find.text('AI 语音 · 1 分 10 秒'), findsOneWidget);

    await pump(
      const BriefAudio(
        status: 'pending',
        url: null,
        durationSeconds: null,
        transcript: null,
        cover: null,
      ),
    );
    expect(find.text('语音简报'), findsOneWidget);
    expect(find.textContaining('分钟听完本期'), findsNothing);
  });

  testWidgets('keeps brief metadata in one responsible location', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: watchTowerTheme(Brightness.light),
        home: Scaffold(
          body: BriefView(
            brief: _brief(
              items: [_item],
              status: 'complete',
              missingSources: const [],
            ),
            offline: false,
          ),
        ),
      ),
    );

    expect(find.text('完整简报'), findsNothing);
    expect(find.text('1 条热点'), findsNothing);
    expect(find.text('1 条经过筛选的技术与产品信号'), findsOneWidget);
  });

  testWidgets('renders compact positive-only source summary with semantics', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      MaterialApp(
        theme: watchTowerTheme(Brightness.light),
        home: Scaffold(
          body: BriefView(brief: _brief(items: [_item]), offline: false),
        ),
      ),
    );

    final coverage = find.textContaining('来源：');
    expect(coverage, findsOneWidget);
    expect(find.textContaining('Hacker News 1'), findsOneWidget);
    expect(tester.widget<Text>(coverage).data, isNot(contains('Kickstarter')));
    expect(
      tester.getSemantics(coverage),
      matchesSemantics(label: '来源：Hacker News 1，Product Hunt 1，GitHub 1'),
    );
    semantics.dispose();
  });

  testWidgets('omits the source summary when every count is zero', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: watchTowerTheme(Brightness.light),
        home: Scaffold(
          body: BriefView(
            brief: _brief(
              sourceCounts: const {
                'hacker-news': 0,
                'product-hunt': 0,
                'github': 0,
                'kickstarter': 0,
              },
            ),
            offline: false,
          ),
        ),
      ),
    );

    expect(find.textContaining('来源：'), findsNothing);
  });

  testWidgets('ready audio preserves adaptive copy in the compact card', (
    tester,
  ) async {
    final controller = _readyAudioController();
    await controller.initialize();
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: controller,
        child: MaterialApp(
          theme: watchTowerTheme(Brightness.light),
          home: Scaffold(
            body: BriefView(
              brief: _brief(items: [_item], audio: _readyAudio),
              offline: false,
            ),
          ),
        ),
      ),
    );

    expect(find.text('今天值得关注的技术信号'), findsOneWidget);
    expect(find.text('约 2 分钟听完本期'), findsOneWidget);
    expect(find.text('语音简报'), findsNothing);
    expect(find.textContaining('AI 语音'), findsOneWidget);
    expect(find.textContaining('2 分 27 秒'), findsOneWidget);
    expect(find.byTooltip('播放语音简报'), findsOneWidget);
  });

  testWidgets('compact audio states keep their shared skeleton', (
    tester,
  ) async {
    final controller = _readyAudioController();
    addTearDown(controller.dispose);
    Future<void> pumpAudio(BriefAudio audio) => tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: controller,
        child: MaterialApp(
          theme: watchTowerTheme(Brightness.light),
          home: Scaffold(
            body: BriefView(
              brief: _brief(items: [_item], audio: audio),
              offline: false,
            ),
          ),
        ),
      ),
    );

    await pumpAudio(const BriefAudio(status: 'pending'));
    expect(find.text('语音简报'), findsOneWidget);
    expect(find.textContaining('正在生成'), findsOneWidget);
    expect(find.byType(Image), findsNothing);

    await pumpAudio(const BriefAudio(status: 'failed'));
    expect(find.text('语音简报'), findsOneWidget);
    expect(find.textContaining('暂时不可用'), findsOneWidget);
  });

  testWidgets('failed audio retry respects offline and authorized states', (
    tester,
  ) async {
    final auth = _RetryTrackingAuthController()..audioRetryAllowed = true;
    final audio = _readyAudioController();
    addTearDown(audio.dispose);

    Future<void> pump({required bool offline}) => tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthController?>.value(value: auth),
          ChangeNotifierProvider.value(value: audio),
        ],
        child: MaterialApp(
          theme: watchTowerTheme(Brightness.light),
          home: Scaffold(
            body: BriefView(
              brief: _brief(
                items: [_item],
                audio: const BriefAudio(status: 'failed'),
              ),
              offline: offline,
            ),
          ),
        ),
      ),
    );

    await pump(offline: true);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    expect(find.text('连接网络后重试'), findsOneWidget);

    await pump(offline: false);
    await tester.tap(find.text('重新生成语音'));
    await tester.pump();
    expect(auth.retries, 1);
    expect(find.text('语音正在重新生成'), findsOneWidget);
  });

  testWidgets('phone viewport has no overflow and reaches the first hotspot', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: watchTowerTheme(Brightness.light),
        home: Scaffold(
          body: BriefView(brief: _brief(items: [_item]), offline: false),
        ),
      ),
    );

    expect(tester.takeException(), isNull);
    expect(find.text('本期热点'), findsOneWidget);
    expect(find.text(_item.title), findsOneWidget);
    expect(tester.getTopLeft(find.text(_item.title)).dy, lessThan(852));
  });

  testWidgets('wide large-text partial brief has no overflow', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1024, 1366);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: watchTowerTheme(Brightness.light),
        home: MediaQuery(
          data: const MediaQueryData(
            size: Size(1024, 1366),
            textScaler: TextScaler.linear(2),
          ),
          child: Scaffold(
            body: BriefView(
              brief: _brief(
                items: [_item],
                missingSources: const [
                  'hacker-news',
                  'product-hunt',
                  'github',
                  'kickstarter',
                ],
              ),
              offline: false,
            ),
          ),
        ),
      ),
    );

    expect(tester.takeException(), isNull);
    expect(find.textContaining('暂缺'), findsNothing);
  });

  testWidgets(
    'feedback controls require allowlist capability and stay disabled offline',
    (tester) async {
      final auth =
          AuthController(api: ApiClient(baseUrl: 'https://example.com'))
            ..userId = 'apple|user'
            ..feedbackAllowed = true;
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthController?>.value(
          value: auth,
          child: MaterialApp(
            theme: watchTowerTheme(Brightness.light),
            home: Scaffold(
              body: BriefView(brief: _brief(items: [_item]), offline: true),
            ),
          ),
        ),
      );
      expect(find.text('持续关注'), findsOneWidget);
      expect(
        tester
            .widget<FilterChip>(find.widgetWithText(FilterChip, '持续关注'))
            .onSelected,
        isNull,
      );
      expect(find.text('连接网络后可提交反馈。'), findsOneWidget);
    },
  );

  testWidgets('refreshing the same brief reloads shared feedback', (
    tester,
  ) async {
    final auth = _TrackingAuthController()
      ..userId = 'apple|user'
      ..feedbackAllowed = true;

    Future<void> pump(DateTime fetchedAt) => tester.pumpWidget(
      ChangeNotifierProvider<AuthController?>.value(
        value: auth,
        child: MaterialApp(
          theme: watchTowerTheme(Brightness.light),
          home: Scaffold(
            body: BriefView(
              brief: _brief(items: [_item]),
              offline: false,
              fetchedAt: fetchedAt,
            ),
          ),
        ),
      ),
    );

    await pump(DateTime.utc(2026, 7, 18, 1));
    await tester.pump();
    expect(auth.feedbackLoads, 1);

    await pump(DateTime.utc(2026, 7, 18, 2));
    await tester.pump();
    expect(auth.feedbackLoads, 2);
  });

  testWidgets(
    'shows exploration only when enabled and opens the full-screen route',
    (tester) async {
      final router = GoRouter(
        routes: [
          GoRoute(
            path: '/',
            builder: (context, state) => Scaffold(
              body: BriefView(
                brief: _brief(items: [_item], explorationEnabled: true),
                offline: false,
              ),
            ),
          ),
          GoRoute(
            path: '/explorations/:date/:entityId',
            builder: (context, state) => const Scaffold(body: Text('探索详情页')),
          ),
        ],
      );
      await tester.pumpWidget(
        MaterialApp.router(
          theme: watchTowerTheme(Brightness.light),
          routerConfig: router,
        ),
      );
      await tester.scrollUntilVisible(find.text('拓展阅读'), 300);
      await tester.ensureVisible(find.text('拓展阅读'));
      await tester.pumpAndSettle();
      expect(find.text('拓展阅读'), findsOneWidget);
      await tester.tap(find.text('拓展阅读'));
      await tester.pumpAndSettle();
      expect(find.text('探索详情页'), findsOneWidget);
    },
  );
}
