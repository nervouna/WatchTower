import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../app_model.dart';
import '../audio/audio_controller.dart';

class AppShell extends StatelessWidget {
  const AppShell({required this.child, super.key});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.path;
    final isDetail = location.startsWith('/briefs/');
    final selected = switch (location) {
      '/archive' => 1,
      '/settings' => 2,
      _ => 0,
    };
    final latestDate = context.watch<AppModel>().latest?.date;
    final title = switch (location) {
      '/archive' => '归档',
      '/settings' => '设置',
      final path when path.startsWith('/briefs/') => path.split('/').last,
      _ => latestDate ?? '今日',
    };
    final audio = context.watch<AudioController>();
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        centerTitle: true,
        leading: isDetail
            ? BackButton(
                onPressed: () {
                  if (context.canPop()) {
                    context.pop();
                  } else {
                    context.go('/');
                  }
                },
              )
            : null,
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
      ),
      body: SafeArea(bottom: false, child: child),
      bottomNavigationBar: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (audio.item != null)
            Material(
              color: Theme.of(context).colorScheme.surfaceContainerHigh,
              child: SafeArea(
                top: false,
                bottom: false,
                child: SizedBox(
                  height: 64,
                  child: Row(
                    children: [
                      const SizedBox(width: 12),
                      IconButton.filledTonal(
                        onPressed: audio.toggleCurrent,
                        tooltip: audio.playing ? '暂停' : '播放',
                        icon: Icon(
                          audio.playing ? Icons.pause : Icons.play_arrow,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              audio.item!.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const Text(
                              'WatchTower 语音简报',
                              style: TextStyle(fontSize: 12),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        onPressed: audio.stop,
                        tooltip: '关闭播放器',
                        icon: const Icon(Icons.close),
                      ),
                      const SizedBox(width: 4),
                    ],
                  ),
                ),
              ),
            ),
          if (!isDetail)
            NavigationBar(
              selectedIndex: selected,
              onDestinationSelected: (index) => context.go(switch (index) {
                0 => '/',
                1 => '/archive',
                _ => '/settings',
              }),
              destinations: const [
                NavigationDestination(
                  icon: Icon(Icons.today_outlined),
                  selectedIcon: Icon(Icons.today),
                  label: '今日',
                ),
                NavigationDestination(
                  icon: Icon(Icons.inventory_2_outlined),
                  selectedIcon: Icon(Icons.inventory_2),
                  label: '归档',
                ),
                NavigationDestination(
                  icon: Icon(Icons.settings_outlined),
                  selectedIcon: Icon(Icons.settings),
                  label: '设置',
                ),
              ],
            ),
        ],
      ),
    );
  }
}
