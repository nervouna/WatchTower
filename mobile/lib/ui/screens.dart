import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../app_model.dart';
import '../data/brief_repository.dart';
import '../models.dart';
import '../push/push_controller.dart';
import 'brief_view.dart';

double _horizontalPadding(BuildContext context, double minimum) {
  final width = MediaQuery.sizeOf(context).width;
  return width > 792 ? (width - 760) / 2 : minimum;
}

class LatestScreen extends StatefulWidget {
  const LatestScreen({super.key});
  @override
  State<LatestScreen> createState() => _LatestScreenState();
}

class _LatestScreenState extends State<LatestScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final push = context.read<PushController>();
      if (push.status == PushStatus.unknown) push.initialize();
    });
  }

  @override
  Widget build(BuildContext context) {
    final model = context.watch<AppModel>();
    final push = context.watch<PushController>();
    if (model.loadingLatest && model.latest == null) {
      return const LoadingState();
    }
    if (model.latest == null) {
      return ErrorState(
        message: model.latestError ?? '简报尚未发布。',
        onRetry: model.refreshLatest,
      );
    }
    return Column(
      children: [
        if (push.status == PushStatus.unknown) _NotificationPrompt(push: push),
        Expanded(
          child: RefreshIndicator(
            onRefresh: model.refreshLatest,
            child: BriefView(
              brief: model.latest!,
              offline: model.offline,
              fetchedAt: model.fetchedAt,
            ),
          ),
        ),
      ],
    );
  }
}

class _NotificationPrompt extends StatelessWidget {
  const _NotificationPrompt({required this.push});
  final PushController push;

  @override
  Widget build(BuildContext context) => Container(
    margin: EdgeInsets.fromLTRB(
      _horizontalPadding(context, 16),
      8,
      _horizontalPadding(context, 16),
      0,
    ),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Row(
      children: [
        Icon(
          Icons.notifications_none,
          color: Theme.of(context).colorScheme.primary,
        ),
        const SizedBox(width: 10),
        const Expanded(child: Text('新一期正式发布后提醒我')),
        TextButton(
          onPressed: push.busy ? null : push.enable,
          child: const Text('开启'),
        ),
      ],
    ),
  );
}

class ArchiveScreen extends StatefulWidget {
  const ArchiveScreen({super.key});
  @override
  State<ArchiveScreen> createState() => _ArchiveScreenState();
}

class _ArchiveScreenState extends State<ArchiveScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => context.read<AppModel>().initializeArchive(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final model = context.watch<AppModel>();
    if (!model.archiveInitialized ||
        (model.loadingArchive && model.archive.isEmpty)) {
      return const LoadingState();
    }
    if (model.archive.isEmpty && model.archiveError != null) {
      return ErrorState(
        message: model.archiveError!,
        onRetry: model.loadMoreArchive,
      );
    }
    if (model.archive.isEmpty) return const ErrorState(message: '第一期简报正在路上。');
    return ListView(
      padding: EdgeInsets.fromLTRB(
        _horizontalPadding(context, 16),
        12,
        _horizontalPadding(context, 16),
        32,
      ),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'ARCHIVE',
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.2,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  '历史归档',
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                Text('按日期回看每一期技术与产品热点简报。已缓存 ${model.archive.length} 期。'),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Column(
            children: [
              for (var index = 0; index < model.archive.length; index++) ...[
                _ArchiveRow(summary: model.archive[index]),
                if (index < model.archive.length - 1)
                  const Divider(height: 1, indent: 16, endIndent: 16),
              ],
            ],
          ),
        ),
        if (model.archiveHasMore || model.archiveError != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: OutlinedButton(
              onPressed: model.loadingArchive ? null : model.loadMoreArchive,
              child: Text(
                model.loadingArchive ? '正在加载…' : model.archiveError ?? '加载更多',
              ),
            ),
          ),
      ],
    );
  }
}

class _ArchiveRow extends StatelessWidget {
  const _ArchiveRow({required this.summary});
  final BriefSummary summary;
  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label:
        '${summary.date}，${summary.itemCount} 条热点，${summary.status == 'complete' ? '完整简报' : '部分简报'}',
    child: ListTile(
      minTileHeight: 64,
      onTap: () => context.push('/briefs/${summary.date}'),
      title: Text(
        summary.date,
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
      subtitle: Text(
        '${summary.itemCount} 条热点 · ${summary.status == 'complete' ? '完整' : '部分'}',
      ),
      trailing: const Icon(Icons.chevron_right),
    ),
  );
}

class BriefDetailScreen extends StatefulWidget {
  const BriefDetailScreen({required this.date, super.key});
  final String date;
  @override
  State<BriefDetailScreen> createState() => _BriefDetailScreenState();
}

class _BriefDetailScreenState extends State<BriefDetailScreen> {
  Future<LoadResult<Brief>>? _future;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= context.read<BriefRepository>().loadBrief(widget.date);
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<LoadResult<Brief>>(
    future: _future,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) {
        return const LoadingState();
      }
      if (snapshot.hasError || snapshot.data == null) {
        return ErrorState(
          message: '暂时无法加载 ${widget.date} 的简报。',
          onRetry: () => setState(
            () => _future = context.read<BriefRepository>().loadBrief(
              widget.date,
            ),
          ),
        );
      }
      return BriefView(
        brief: snapshot.data!.value,
        offline: snapshot.data!.offline,
        fetchedAt: snapshot.data!.fetchedAt,
      );
    },
  );
}

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final push = context.watch<PushController>();
    return ListView(
      padding: EdgeInsets.fromLTRB(
        _horizontalPadding(context, 16),
        16,
        _horizontalPadding(context, 16),
        32,
      ),
      children: [
        Text(
          '设置',
          style: Theme.of(
            context,
          ).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '每日简报提醒',
                  style: Theme.of(
                    context,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                const Text('只在新一期简报正式发布后提醒。不会上传阅读历史，也不会用于广告追踪。'),
                const SizedBox(height: 16),
                if (push.status == PushStatus.unsupported)
                  const Text('当前平台暂不支持发布通知。')
                else if (push.status == PushStatus.authorized)
                  FilledButton.tonal(
                    onPressed: push.busy ? null : push.disable,
                    child: const Text('关闭提醒'),
                  )
                else if (push.status == PushStatus.denied)
                  FilledButton(
                    onPressed: push.openSettings,
                    child: const Text('前往系统设置'),
                  )
                else
                  FilledButton(
                    onPressed: push.busy ? null : push.enable,
                    child: Text(push.busy ? '正在开启…' : '开启每日提醒'),
                  ),
                if (push.error != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    push.error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Column(
            children: [
              ListTile(
                title: const Text('隐私说明'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/privacy'),
              ),
              const Divider(height: 1, indent: 16, endIndent: 16),
              const ListTile(title: Text('外观'), subtitle: Text('跟随系统亮色或暗色模式')),
              const Divider(height: 1, indent: 16, endIndent: 16),
              const ListTile(
                title: Text('WatchTower'),
                subtitle: Text('每日中文科技与产品情报简报'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        const _Skeleton(width: 120, height: 22),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                _Skeleton(width: 260, height: 22),
                SizedBox(height: 16),
                _Skeleton(width: double.infinity, height: 16),
                SizedBox(height: 8),
                _Skeleton(width: 300, height: 16),
                SizedBox(height: 18),
                _Skeleton(width: double.infinity, height: 72),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class PrivacyScreen extends StatelessWidget {
  const PrivacyScreen({super.key});
  @override
  Widget build(BuildContext context) => ListView(
    padding: EdgeInsets.fromLTRB(
      _horizontalPadding(context, 20),
      20,
      _horizontalPadding(context, 20),
      32,
    ),
    children: [
      Text(
        '隐私说明',
        style: Theme.of(
          context,
        ).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 16),
      const Text(
        'WatchTower 无需账号即可使用，不包含广告或跨应用追踪 SDK。你阅读过哪些简报、播放到哪里，只保存在设备本地。',
        style: TextStyle(height: 1.7),
      ),
      const SizedBox(height: 16),
      Text(
        '发布通知',
        style: Theme.of(
          context,
        ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 8),
      const Text(
        '只有在你主动开启提醒后，App 才会把 APNs 设备令牌加密发送给 WatchTower。令牌只用于发送新简报通知；关闭提醒后，服务端会删除对应订阅。',
        style: TextStyle(height: 1.7),
      ),
      const SizedBox(height: 16),
      Text(
        '公开来源',
        style: Theme.of(
          context,
        ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 8),
      const Text(
        '简报中的外部链接会通过系统浏览器打开，目标网站适用其各自的隐私政策。',
        style: TextStyle(height: 1.7),
      ),
    ],
  );
}

class LoadingState extends StatelessWidget {
  const LoadingState({super.key});
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(16),
    children: [
      Card(
        child: Padding(
          padding: const EdgeInsets.all(22),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'WATCHTOWER',
                style: TextStyle(
                  color: Theme.of(context).colorScheme.primary,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.2,
                ),
              ),
              const SizedBox(height: 16),
              const _Skeleton(width: 280, height: 28),
              const SizedBox(height: 12),
              const _Skeleton(width: double.infinity, height: 16),
              const SizedBox(height: 8),
              const _Skeleton(width: 240, height: 16),
            ],
          ),
        ),
      ),
    ],
  );
}

class _Skeleton extends StatelessWidget {
  const _Skeleton({required this.width, required this.height});
  final double width;
  final double height;
  @override
  Widget build(BuildContext context) => Container(
    width: width,
    height: height,
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(6),
    ),
  );
}

class ErrorState extends StatelessWidget {
  const ErrorState({required this.message, this.onRetry, super.key});
  final String message;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.signal_wifi_connected_no_internet_4_outlined,
                size: 36,
              ),
              const SizedBox(height: 12),
              Text(
                '暂时无法加载',
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Text(message, textAlign: TextAlign.center),
              if (onRetry != null) ...[
                const SizedBox(height: 16),
                FilledButton(onPressed: onRetry, child: const Text('重试')),
              ],
            ],
          ),
        ),
      ),
    ),
  );
}
