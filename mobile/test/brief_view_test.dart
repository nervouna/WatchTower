import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
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

final item = BriefItem(
  rank: 1,
  entityId: 'entity_00000000000000000000000000000001',
  title: '一条值得关注的产品信号',
  summary: '这是保持左对齐并允许 Dynamic Type 自然换行的正文摘要。',
  whyItMatters: '这项变化会影响产品团队接下来的判断。',
  tags: ['产品', 'AI'],
  continuity: const Continuity(
    kind: 'continuing',
    materialChange: '本周出现了新的公开证据。',
    previousDate: '2026-07-16',
  ),
  sources: [
    SourceLink(
      source: 'hacker-news',
      kind: 'original',
      label: '原文',
      url: Uri.parse('https://example.com/article'),
    ),
  ],
);

Brief brief({
  List<BriefItem>? items,
  BriefAudio? audio,
  bool exploration = true,
}) => Brief(
  date: '2026-07-17',
  status: 'partial',
  publishedAt: DateTime.utc(2026, 7, 17),
  generatedAt: DateTime.utc(2026, 7, 16, 23, 30),
  headline: '今天值得关注的技术信号',
  intro: '一份用于 Editorial Ledger 界面测试的简报。',
  missingSources: const ['kickstarter'],
  sourceCounts: const {
    'hacker-news': 1,
    'product-hunt': 2,
    'github': 0,
    'kickstarter': 0,
  },
  audio: audio,
  items: items ?? [item],
  explorationEnabled: exploration,
);

AudioController audioController() => AudioController(
  BriefRepository(
    api: ApiClient(baseUrl: 'https://example.com'),
    database: LocalDatabase(),
  ),
  initializer: () async => WatchTowerAudioHandler(),
);

class RetryAuth extends AuthController {
  RetryAuth() : super(api: ApiClient(baseUrl: 'https://example.com'));
  int retries = 0;
  @override
  Future<void> retryAudio(String date) async {
    retries += 1;
  }
}

Widget app(
  Widget child, {
  AudioController? audio,
  AuthController? auth,
  double scale = 1,
}) {
  Widget result = MaterialApp(
    theme: watchTowerTheme(Brightness.light),
    home: MediaQuery(
      data: MediaQueryData(textScaler: TextScaler.linear(scale)),
      child: Scaffold(body: child),
    ),
  );
  if (audio != null) {
    result = ChangeNotifierProvider<AudioController?>.value(
      value: audio,
      child: result,
    );
  }
  if (auth != null) {
    result = ChangeNotifierProvider<AuthController?>.value(
      value: auth,
      child: result,
    );
  }
  return result;
}

void main() {
  test(
    'theme exposes exact Editorial Ledger tokens and platform serif fallback',
    () {
      final light = watchTowerTheme(Brightness.light);
      final dark = watchTowerTheme(Brightness.dark);
      expect(light.scaffoldBackgroundColor, ledgerLightPage);
      expect(light.colorScheme.onSurface, ledgerLightText);
      expect(light.colorScheme.onSurfaceVariant, ledgerLightSecondary);
      expect(light.dividerColor, ledgerLightDivider);
      expect(light.colorScheme.primary, ledgerLightAccent);
      expect(dark.scaffoldBackgroundColor, ledgerDarkPage);
      expect(dark.colorScheme.onSurface, ledgerDarkText);
      expect(dark.colorScheme.onSurfaceVariant, ledgerDarkSecondary);
      expect(dark.dividerColor, ledgerDarkDivider);
      expect(dark.colorScheme.primary, ledgerDarkAccent);
      expect(light.textTheme.bodyLarge!.fontSize, 17);
      expect(light.textTheme.titleMedium!.color, ledgerLightText);
      expect(dark.textTheme.titleMedium!.color, ledgerDarkText);
      expect(light.extension<LedgerTheme>()!.serifFallback, isNotEmpty);
    },
  );

  testWidgets(
    'renders left-aligned hierarchy, metadata, coverage, issue navigation, and continuous entries',
    (tester) async {
      await tester.pumpWidget(app(BriefView(brief: brief(), offline: false)));
      expect(
        tester.widget<Text>(find.text('今天值得关注的技术信号')).textAlign,
        TextAlign.left,
      );
      expect(find.textContaining('2026-07-17 / 更新 23:30 UTC'), findsOneWidget);
      expect(
        find.text('来源覆盖 / Hacker News 1 / Product Hunt 2'),
        findsOneWidget,
      );
      expect(find.text('01'), findsWidgets);
      expect(
        find.textContaining('为什么值得看：', findRichText: true),
        findsOneWidget,
      );
      expect(find.textContaining('持续关注：', findRichText: true), findsOneWidget);
      expect(find.text('产品 / AI'), findsOneWidget);
      expect(find.byType(Card), findsNothing);
      expect(find.byType(FilterChip), findsNothing);
      expect(find.byType(Image), findsNothing);
      expect(find.text('本期热点'), findsNothing);
    },
  );

  testWidgets('keeps offline and empty states in the reading surface', (
    tester,
  ) async {
    await tester.pumpWidget(
      app(
        BriefView(
          brief: brief(items: []),
          offline: true,
          fetchedAt: DateTime(2026, 7, 17, 8),
        ),
      ),
    );
    expect(find.textContaining('离线内容'), findsOneWidget);
    expect(find.text('本期暂无可发布热点'), findsOneWidget);
    expect(find.textContaining('部分资料'), findsNothing);
    expect(find.byType(Card), findsNothing);
  });

  testWidgets(
    'audio ready, initializing, pending, failed, retry, queued, and offline states remain readable',
    (tester) async {
      final audio = audioController();
      final auth = RetryAuth()..audioRetryAllowed = true;
      addTearDown(audio.dispose);
      await audio.initialize();
      await tester.pumpWidget(
        app(
          BriefView(
            brief: brief(
              audio: const BriefAudio(
                status: 'ready',
                url: '/audio',
                durationSeconds: 147,
                transcript: '逐字稿',
              ),
            ),
            offline: false,
          ),
          audio: audio,
          auth: auth,
        ),
      );
      expect(find.textContaining('约 2 分钟听完'), findsOneWidget);
      expect(find.byTooltip('播放语音简报'), findsOneWidget);
      await tester.pumpWidget(
        app(
          BriefView(
            brief: brief(audio: const BriefAudio(status: 'pending')),
            offline: false,
          ),
          audio: audio,
          auth: auth,
        ),
      );
      expect(find.textContaining('正在生成'), findsOneWidget);
      expect(find.text('重新生成语音'), findsOneWidget);
      await tester.tap(find.text('重新生成语音'));
      await tester.pump();
      expect(auth.retries, 1);
      expect(find.text('已提交生成'), findsOneWidget);
      await tester.pumpWidget(
        app(
          BriefView(
            brief: brief(audio: const BriefAudio(status: 'failed')),
            offline: true,
          ),
          audio: audio,
          auth: auth,
        ),
      );
      expect(find.text('音频需要联网播放。'), findsOneWidget);
      expect(find.text('连接网络后重试'), findsOneWidget);
    },
  );

  testWidgets(
    'feedback uses equal rectangular controls and remains disabled offline',
    (tester) async {
      final auth = RetryAuth()
        ..userId = 'auth0|user'
        ..feedbackAllowed = true;
      await tester.pumpWidget(
        app(BriefView(brief: brief(), offline: true), auth: auth),
      );
      expect(find.text('这条内容'), findsOneWidget);
      expect(find.byType(OutlinedButton), findsNWidgets(3));
      for (final button in tester.widgetList<OutlinedButton>(
        find.byType(OutlinedButton),
      )) {
        expect(button.onPressed, isNull);
      }
      expect(find.text('连接网络后可提交反馈。'), findsOneWidget);
    },
  );

  testWidgets('320px and 200% text scaling do not overflow or hide prose', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      app(BriefView(brief: brief(), offline: false), scale: 2),
    );
    expect(tester.takeException(), isNull);
    await tester.scrollUntilVisible(find.text(item.summary), 300);
    expect(find.text(item.summary), findsOneWidget);
    await tester.scrollUntilVisible(find.text('拓展阅读'), 300);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'error state has text and one recovery action without a state card',
    (tester) async {
      var retried = false;
      await tester.pumpWidget(
        app(ErrorState(message: '网络错误', onRetry: () => retried = true)),
      );
      expect(find.byType(Card), findsNothing);
      await tester.tap(find.text('重试'));
      expect(retried, isTrue);
    },
  );
}
