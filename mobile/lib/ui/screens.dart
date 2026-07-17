import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app_model.dart';
import '../data/brief_repository.dart';
import '../data/api_client.dart';
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
      const SizedBox(height: 16),
      Text(
        '拓展阅读',
        style: Theme.of(
          context,
        ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 8),
      const Text(
        '点击“拓展阅读”会触发服务端检索公开资料。同一热点的结果会匿名共享和缓存；原始 IP 仅由 Cloudflare 临时用于宽松限流，不写入 WatchTower 数据库。',
        style: TextStyle(height: 1.7),
      ),
    ],
  );
}

class ExplorationScreen extends StatefulWidget {
  const ExplorationScreen({
    required this.briefDate,
    required this.entityId,
    super.key,
  });
  final String briefDate;
  final String entityId;
  @override
  State<ExplorationScreen> createState() => _ExplorationScreenState();
}

class _ExplorationScreenState extends State<ExplorationScreen> {
  Future<LoadResult<Exploration>>? _future;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= context.read<BriefRepository>().loadExploration(
      widget.briefDate,
      widget.entityId,
    );
  }

  void _retry() => setState(() {
    _future = context.read<BriefRepository>().loadExploration(
      widget.briefDate,
      widget.entityId,
    );
  });

  @override
  Widget build(BuildContext context) => FutureBuilder<LoadResult<Exploration>>(
    future: _future,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) {
        return const _ExplorationLoading();
      }
      if (snapshot.hasError || snapshot.data == null) {
        return ErrorState(
          message: snapshot.error is ApiException
              ? (snapshot.error! as ApiException).message
              : '本次探索未完成，可稍后重试。',
          onRetry: _retry,
        );
      }
      return _ExplorationResult(result: snapshot.data!);
    },
  );
}

class _ExplorationLoading extends StatelessWidget {
  const _ExplorationLoading();
  @override
  Widget build(BuildContext context) => ListView(
    padding: EdgeInsets.fromLTRB(
      _horizontalPadding(context, 16),
      16,
      _horizontalPadding(context, 16),
      32,
    ),
    children: [
      Card(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const SizedBox(
                width: 32,
                height: 32,
                child: CircularProgressIndicator(strokeWidth: 3),
              ),
              const SizedBox(height: 18),
              Text(
                '正在查找背景、相关产品和外部观点…',
                textAlign: TextAlign.center,
                style: Theme.of(
                  context,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Text(
                '通常会在 90 秒内完成，原简报内容不受影响。',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    ],
  );
}

class _ExplorationResult extends StatelessWidget {
  const _ExplorationResult({required this.result});
  final LoadResult<Exploration> result;

  @override
  Widget build(BuildContext context) {
    final exploration = result.value;
    final sections = exploration.sections!;
    final sources = {
      for (final source in exploration.sources) source.id: source,
    };
    return SelectionArea(
      child: ListView(
        padding: EdgeInsets.fromLTRB(
          _horizontalPadding(context, 16),
          12,
          _horizontalPadding(context, 16),
          40,
        ),
        children: [
          if (result.offline)
            _ExplorationNotice(
              '当前显示离线缓存，生成于 ${_utc(exploration.generatedAt)} UTC。',
            ),
          if (exploration.stale || exploration.refreshing)
            _ExplorationNotice(
              exploration.refreshing
                  ? '正在后台更新，当前先显示上一次结果。'
                  : '当前结果已过期，可联网后重新打开刷新。',
            ),
          if (exploration.refreshLimited)
            const _ExplorationNotice('今日刷新额度已用完，当前继续显示已有结果。'),
          _ExplorationSection(
            title: '展开说明',
            children: [
              _CitedCopy(
                text: sections.overview.text,
                sourceIds: sections.overview.sourceIds,
                sources: sources,
              ),
            ],
          ),
          _ExplorationSection(
            title: '相关产品',
            children: sections.relatedProducts.isEmpty
                ? const [Text('现有资料不足以确认相关产品关系。')]
                : [
                    for (final item in sections.relatedProducts)
                      _ExplorationEntry(
                        title: '${item.name} · ${item.relation}',
                        summary: item.summary,
                        sourceIds: item.sourceIds,
                        sources: sources,
                      ),
                  ],
          ),
          _ExplorationSection(
            title: '外部观点',
            children: sections.perspectives.isEmpty
                ? const [Text('暂未找到足够可靠的外部观点。')]
                : [
                    for (final item in sections.perspectives)
                      _ExplorationEntry(
                        title: item.label,
                        summary: item.summary,
                        sourceIds: item.sourceIds,
                        sources: sources,
                      ),
                  ],
          ),
          _ExplorationSection(
            title: '行业位置',
            children: [
              sections.industry == null
                  ? const Text('现有资料不足以判断行业位置。')
                  : _CitedCopy(
                      text: sections.industry!.text,
                      sourceIds: sections.industry!.sourceIds,
                      sources: sources,
                    ),
            ],
          ),
          _ExplorationSection(
            title: '接下来关注什么',
            children: sections.watchNext.isEmpty
                ? const [Text('暂时没有足够证据支持可验证的后续信号。')]
                : [
                    for (final item in sections.watchNext)
                      _CitedCopy(
                        text: item.signal,
                        sourceIds: item.sourceIds,
                        sources: sources,
                      ),
                  ],
          ),
          _ExplorationSection(
            title: '资料来源',
            children: [
              for (final source in exploration.sources)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  minTileHeight: 56,
                  title: Text(source.title),
                  subtitle: Text(source.domain),
                  trailing: const Icon(Icons.open_in_new, size: 20),
                  onTap: () =>
                      launchUrl(source.url, mode: LaunchMode.inAppBrowserView),
                ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 8, 4, 0),
            child: Text(
              'AI 基于公开资料整理，信息可能随时间变化，请以原始来源为准。更新于 ${_utc(exploration.generatedAt)} UTC。',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
                height: 1.5,
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _utc(DateTime? value) => value == null
      ? '未知时间'
      : value.toUtc().toIso8601String().replaceFirst('T', ' ').substring(0, 16);
}

class _ExplorationNotice extends StatelessWidget {
  const _ExplorationNotice(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 12),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(10),
    ),
    child: Text(text),
  );
}

class _ExplorationSection extends StatelessWidget {
  const _ExplorationSection({required this.title, required this.children});
  final String title;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Card(
    margin: const EdgeInsets.only(bottom: 12),
    child: Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            title,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),
          for (var index = 0; index < children.length; index++) ...[
            children[index],
            if (index < children.length - 1) const SizedBox(height: 16),
          ],
        ],
      ),
    ),
  );
}

class _ExplorationEntry extends StatelessWidget {
  const _ExplorationEntry({
    required this.title,
    required this.summary,
    required this.sourceIds,
    required this.sources,
  });
  final String title;
  final String summary;
  final List<String> sourceIds;
  final Map<String, ExplorationSource> sources;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        title,
        style: Theme.of(
          context,
        ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 6),
      _CitedCopy(text: summary, sourceIds: sourceIds, sources: sources),
    ],
  );
}

class _CitedCopy extends StatelessWidget {
  const _CitedCopy({
    required this.text,
    required this.sourceIds,
    required this.sources,
  });
  final String text;
  final List<String> sourceIds;
  final Map<String, ExplorationSource> sources;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        text,
        style: Theme.of(context).textTheme.bodyLarge?.copyWith(height: 1.65),
      ),
      const SizedBox(height: 6),
      Wrap(
        spacing: 4,
        runSpacing: 4,
        children: [
          for (final id in sourceIds)
            if (sources[id] != null)
              TextButton(
                onPressed: () => launchUrl(
                  sources[id]!.url,
                  mode: LaunchMode.inAppBrowserView,
                ),
                child: Text('来源 ${id.replaceFirst('source_', '')}'),
              ),
        ],
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
