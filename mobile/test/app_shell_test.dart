import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:watchtower/app_model.dart';
import 'package:watchtower/audio/audio_controller.dart';
import 'package:watchtower/data/api_client.dart';
import 'package:watchtower/data/brief_repository.dart';
import 'package:watchtower/data/local_database.dart';
import 'package:watchtower/ui/app_shell.dart';

BriefRepository _repository() => BriefRepository(
  api: ApiClient(baseUrl: 'https://example.com'),
  database: LocalDatabase(),
);

GoRouter _router({required String initialLocation}) => GoRouter(
  initialLocation: initialLocation,
  routes: [
    ShellRoute(
      builder: (context, state, child) => AppShell(child: child),
      routes: [
        GoRoute(path: '/', builder: (context, state) => const Text('今日内容')),
        GoRoute(
          path: '/archive',
          builder: (context, state) => Center(
            child: TextButton(
              onPressed: () => context.push('/briefs/2026-07-17'),
              child: const Text('打开归档简报'),
            ),
          ),
        ),
        GoRoute(
          path: '/briefs/:date',
          builder: (context, state) => const Text('简报详情'),
        ),
        GoRoute(
          path: '/settings',
          builder: (context, state) => const Text('设置内容'),
        ),
      ],
    ),
  ],
);

Widget _app(GoRouter router) {
  final repository = _repository();
  return MultiProvider(
    providers: [
      ChangeNotifierProvider(create: (_) => AppModel(repository)),
      ChangeNotifierProvider(create: (_) => AudioController(repository)),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
}

void main() {
  testWidgets('root shell uses three tabs and centered text-only titles', (
    tester,
  ) async {
    final router = _router(initialLocation: '/');
    await tester.pumpWidget(_app(router));

    final appBar = tester.widget<AppBar>(find.byType(AppBar));
    expect(appBar.centerTitle, isTrue);
    expect(find.byType(Image), findsNothing);
    expect(find.byType(NavigationDestination), findsNWidgets(3));
    expect(find.byType(BackButton), findsNothing);

    await tester.tap(find.text('设置'));
    await tester.pumpAndSettle();

    expect(find.text('设置内容'), findsOneWidget);
    expect(find.byType(BackButton), findsNothing);
  });

  testWidgets('archive detail is a spoke screen that returns to the archive', (
    tester,
  ) async {
    final router = _router(initialLocation: '/archive');
    await tester.pumpWidget(_app(router));

    expect(find.byType(NavigationBar), findsOneWidget);
    await tester.tap(find.text('打开归档简报'));
    await tester.pumpAndSettle();

    expect(find.text('简报详情'), findsOneWidget);
    expect(find.byType(BackButton), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
    expect(find.byIcon(Icons.settings_outlined), findsNothing);

    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();

    expect(find.text('打开归档简报'), findsOneWidget);
    expect(find.byType(NavigationBar), findsOneWidget);
  });

  testWidgets(
    'direct detail link returns to today without navigation history',
    (tester) async {
      final router = _router(initialLocation: '/briefs/2026-07-17');
      await tester.pumpWidget(_app(router));

      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();

      expect(find.text('今日内容'), findsOneWidget);
    },
  );
}
