import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'app_model.dart';
import 'auth/auth_controller.dart';
import 'audio/audio_controller.dart';
import 'data/api_client.dart';
import 'data/brief_repository.dart';
import 'data/local_database.dart';
import 'push/push_controller.dart';
import 'theme.dart';
import 'ui/app_shell.dart';
import 'ui/screens.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final api = ApiClient();
  final repository = BriefRepository(api: api, database: LocalDatabase());
  final appModel = AppModel(repository);
  final audio = AudioController(repository);
  final push = PushController(api: api);
  final auth = AuthController(api: api);
  final router = _router();
  push.onNotificationOpened = (date) => router.go('/briefs/$date');
  runApp(
    WatchTowerApp(
      repository: repository,
      appModel: appModel,
      audio: audio,
      push: push,
      auth: auth,
      router: router,
    ),
  );
  unawaited(appModel.initialize());
  unawaited(audio.initialize());
  unawaited(push.initialize());
  unawaited(auth.initialize());
}

GoRouter _router() => GoRouter(
  routes: [
    ShellRoute(
      builder: (context, state, child) => AppShell(child: child),
      routes: [
        GoRoute(
          path: '/',
          pageBuilder: (context, state) =>
              NoTransitionPage(key: state.pageKey, child: const LatestScreen()),
        ),
        GoRoute(
          path: '/archive',
          pageBuilder: (context, state) => NoTransitionPage(
            key: state.pageKey,
            child: const ArchiveScreen(),
          ),
        ),
        GoRoute(
          path: '/briefs/:date',
          builder: (context, state) =>
              BriefDetailScreen(date: state.pathParameters['date']!),
        ),
        GoRoute(
          path: '/settings',
          pageBuilder: (context, state) => NoTransitionPage(
            key: state.pageKey,
            child: const SettingsScreen(),
          ),
        ),
      ],
    ),
    GoRoute(
      path: '/privacy',
      builder: (context, state) => const Scaffold(
        appBar: _BackAppBar(title: '隐私说明'),
        body: SafeArea(child: PrivacyScreen()),
      ),
    ),
  ],
);

class _BackAppBar extends StatelessWidget implements PreferredSizeWidget {
  const _BackAppBar({required this.title});
  final String title;
  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);
  @override
  Widget build(BuildContext context) =>
      AppBar(centerTitle: true, title: Text(title));
}

class WatchTowerApp extends StatelessWidget {
  const WatchTowerApp({
    required this.repository,
    required this.appModel,
    required this.audio,
    required this.push,
    required this.auth,
    required this.router,
    super.key,
  });
  final BriefRepository repository;
  final AppModel appModel;
  final AudioController audio;
  final PushController push;
  final AuthController auth;
  final GoRouter router;

  @override
  Widget build(BuildContext context) => MultiProvider(
    providers: [
      Provider.value(value: repository),
      ChangeNotifierProvider.value(value: appModel),
      ChangeNotifierProvider.value(value: audio),
      ChangeNotifierProvider.value(value: push),
      ChangeNotifierProvider.value(value: auth),
    ],
    child: MaterialApp.router(
      title: 'WatchTower',
      debugShowCheckedModeBanner: false,
      theme: watchTowerTheme(Brightness.light),
      darkTheme: watchTowerTheme(Brightness.dark),
      themeMode: ThemeMode.system,
      routerConfig: router,
    ),
  );
}
