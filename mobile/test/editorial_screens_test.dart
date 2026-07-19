import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:watchtower/auth/auth_controller.dart';
import 'package:watchtower/data/api_client.dart';
import 'package:watchtower/push/push_controller.dart';
import 'package:watchtower/theme.dart';
import 'package:watchtower/ui/screens.dart';

Widget settingsApp(AuthController auth) => MultiProvider(
  providers: [
    ChangeNotifierProvider.value(value: auth),
    ChangeNotifierProvider(
      create: (_) =>
          PushController(api: ApiClient(baseUrl: 'https://example.com')),
    ),
  ],
  child: MaterialApp(
    theme: watchTowerTheme(Brightness.light),
    home: const Scaffold(body: SettingsScreen()),
  ),
);

void main() {
  testWidgets(
    'settings keeps anonymous account focused and uses continuous sections',
    (tester) async {
      final auth = AuthController(
        api: ApiClient(baseUrl: 'https://example.com'),
      )..loading = false;
      await tester.pumpWidget(settingsApp(auth));
      expect(find.text('使用 Apple 登录'), findsOneWidget);
      expect(find.text('每日提醒'), findsOneWidget);
      expect(find.text('隐私'), findsOneWidget);
      expect(find.text('应用信息'), findsOneWidget);
      expect(find.byType(Card), findsNothing);
    },
  );

  testWidgets(
    'signed-in settings exposes capability, machine id, secondary actions, and delete confirmation',
    (tester) async {
      final auth =
          AuthController(api: ApiClient(baseUrl: 'https://example.com'))
            ..loading = false
            ..userId = 'auth0|editorial-test'
            ..feedbackAllowed = true;
      await tester.pumpWidget(settingsApp(auth));
      expect(find.text('反馈与音频重试权限已启用。'), findsOneWidget);
      expect(find.textContaining('auth0|editorial-test'), findsOneWidget);
      expect(find.text('复制 user ID'), findsOneWidget);
      expect(find.text('退出登录'), findsOneWidget);
      await tester.tap(find.text('删除账号'));
      await tester.pumpAndSettle();
      expect(find.text('删除账号？'), findsOneWidget);
      expect(find.text('确认删除'), findsOneWidget);
      expect(
        Theme.of(tester.element(find.byType(AlertDialog))).dialogTheme.shape,
        isNotNull,
      );
    },
  );

  testWidgets('privacy is one continuous four-section article', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: watchTowerTheme(Brightness.light),
        home: const Scaffold(body: PrivacyScreen()),
      ),
    );
    for (final title in ['匿名阅读', '发布通知', '公开来源', '拓展阅读']) {
      await tester.scrollUntilVisible(find.text(title), 200);
      expect(find.text(title), findsOneWidget);
    }
    expect(find.byType(Card), findsNothing);
  });

  testWidgets('loading state uses static text skeletons without a spinner', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: watchTowerTheme(Brightness.light),
        home: const Scaffold(body: LoadingState(label: '正在加载归档')),
      ),
    );
    expect(find.text('正在加载归档'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.byType(Card), findsNothing);
  });
}
