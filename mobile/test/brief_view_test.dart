import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:watchtower/models.dart';
import 'package:watchtower/theme.dart';
import 'package:watchtower/ui/brief_view.dart';
import 'package:watchtower/ui/screens.dart';

Brief _brief({List<BriefItem> items = const []}) => Brief(
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
  audio: null,
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
}
