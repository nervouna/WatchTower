import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../audio/audio_controller.dart';

class AppShell extends StatelessWidget {
  const AppShell({required this.child, super.key});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.path;
    final selected = location.startsWith('/archive') ? 1 : 0;
    final audio = context.watch<AudioController>();
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.asset(
                'assets/app-icon-input-1024.png',
                width: 30,
                height: 30,
                semanticLabel: 'WatchTower',
              ),
            ),
            const SizedBox(width: 10),
            const Text(
              'WatchTower',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
          ],
        ),
        actions: [
          IconButton(
            onPressed: () => context.push('/settings'),
            tooltip: '设置',
            icon: const Icon(Icons.settings_outlined),
          ),
          const SizedBox(width: 4),
        ],
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
          NavigationBar(
            selectedIndex: selected,
            onDestinationSelected: (index) =>
                context.go(index == 0 ? '/' : '/archive'),
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
            ],
          ),
        ],
      ),
    );
  }
}
