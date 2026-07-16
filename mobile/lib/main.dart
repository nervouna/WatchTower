import 'dart:async';

import 'package:audio_service/audio_service.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'app_model.dart';
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
  final handler = await AudioService.init(
    builder: WatchTowerAudioHandler.new,
    config: const AudioServiceConfig(
      androidNotificationChannelId: 'io.damao.watchtower.audio',
      androidNotificationChannelName: 'WatchTower 语音简报',
      androidNotificationOngoing: false,
    ),
  );
  await handler.configure();
  final audio = AudioController(handler: handler, repository: repository);
  final push = PushController(api: api);
  final router = _router();
  push.onNotificationOpened = (date) => router.go('/briefs/$date');
  unawaited(appModel.initialize());
  unawaited(push.initialize());
  runApp(
    WatchTowerApp(
      repository: repository,
      appModel: appModel,
      audio: audio,
      push: push,
      router: router,
    ),
  );
}

GoRouter _router() => GoRouter(
  routes: [
    ShellRoute(
      builder: (context, state, child) => AppShell(child: child),
      routes: [
        GoRoute(path: '/', builder: (context, state) => const LatestScreen()),
        GoRoute(
          path: '/archive',
          builder: (context, state) => const ArchiveScreen(),
        ),
        GoRoute(
          path: '/briefs/:date',
          builder: (context, state) =>
              BriefDetailScreen(date: state.pathParameters['date']!),
        ),
      ],
    ),
    GoRoute(
      path: '/settings',
      builder: (context, state) => const Scaffold(
        appBar: _BackAppBar(title: '设置'),
        body: SafeArea(child: SettingsScreen()),
      ),
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
  Widget build(BuildContext context) => AppBar(title: Text(title));
}

class WatchTowerApp extends StatelessWidget {
  const WatchTowerApp({
    required this.repository,
    required this.appModel,
    required this.audio,
    required this.push,
    required this.router,
    super.key,
  });
  final BriefRepository repository;
  final AppModel appModel;
  final AudioController audio;
  final PushController push;
  final GoRouter router;

  @override
  Widget build(BuildContext context) => MultiProvider(
    providers: [
      Provider.value(value: repository),
      ChangeNotifierProvider.value(value: appModel),
      ChangeNotifierProvider.value(value: audio),
      ChangeNotifierProvider.value(value: push),
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
