import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../audio/audio_controller.dart';
import '../theme.dart';

class AppShell extends StatelessWidget {
  const AppShell({required this.child, super.key});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.path;
    final detail = location.startsWith('/briefs/');
    final selected = location == '/archive'
        ? 1
        : location == '/settings'
        ? 2
        : 0;
    final title = switch (location) {
      '/archive' => '归档',
      '/settings' => '设置',
      final path when path.startsWith('/briefs/') => '历史简报',
      _ => 'WatchTower',
    };
    final audio = context.watch<AudioController>();
    return Scaffold(
      appBar: AppBar(
        titleSpacing: detail ? 0 : 20,
        leading: detail
            ? BackButton(
                onPressed: () =>
                    context.canPop() ? context.pop() : context.go('/'),
              )
            : null,
        title: Text(
          title,
          style:
              (Theme.of(context).extension<LedgerTheme>() ??
                      const LedgerTheme(
                        serifFamily: 'Noto Serif',
                        serifFallback: ['Noto Serif CJK SC'],
                      ))
                  .serif(
                    size: location == '/' ? 24 : 22,
                    weight: FontWeight.w600,
                  ),
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Divider(color: Theme.of(context).dividerColor),
        ),
      ),
      body: SafeArea(top: false, bottom: false, child: child),
      bottomNavigationBar: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (audio.item != null) _MiniPlayer(audio: audio),
          if (!detail) ...[
            const Divider(),
            NavigationBar(
              selectedIndex: selected,
              onDestinationSelected: (index) => context.go(
                index == 0
                    ? '/'
                    : index == 1
                    ? '/archive'
                    : '/settings',
              ),
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
        ],
      ),
    );
  }
}

class _MiniPlayer extends StatelessWidget {
  const _MiniPlayer({required this.audio});
  final AudioController audio;
  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label: '正在播放 ${audio.item!.title}',
    child: DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        border: Border(top: BorderSide(color: Theme.of(context).dividerColor)),
      ),
      child: SafeArea(
        top: false,
        bottom: false,
        child: Row(
          children: [
            IconButton(
              onPressed: audio.toggleCurrent,
              tooltip: audio.playing ? '暂停' : '播放',
              icon: Icon(audio.playing ? Icons.pause : Icons.play_arrow),
            ),
            Expanded(
              child: Text(
                audio.item!.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            IconButton(
              onPressed: audio.stop,
              tooltip: '关闭播放器',
              icon: const Icon(Icons.close),
            ),
          ],
        ),
      ),
    ),
  );
}
