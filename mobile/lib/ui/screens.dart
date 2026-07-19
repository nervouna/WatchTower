import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app_model.dart';
import '../auth/auth_controller.dart';
import '../data/api_client.dart';
import '../data/brief_repository.dart';
import '../models.dart';
import '../push/push_controller.dart';
import 'brief_view.dart';
import 'ledger.dart';

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
      return const LoadingState(label: '正在加载简报');
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
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(
      ledgerHorizontalPadding(context),
      8,
      ledgerHorizontalPadding(context),
      0,
    ),
    child: Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: Theme.of(context).dividerColor),
        ),
      ),
      child: Row(
        children: [
          const Expanded(child: Text('新一期正式发布后提醒我')),
          TextButton(
            onPressed: push.busy ? null : push.enable,
            child: const Text('开启'),
          ),
        ],
      ),
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
      return const LoadingState(label: '正在加载归档');
    }
    if (model.archive.isEmpty && model.archiveError != null) {
      return ErrorState(
        message: model.archiveError!,
        onRetry: model.loadMoreArchive,
      );
    }
    if (model.archive.isEmpty) {
      return const ErrorState(title: '归档尚为空', message: '第一期简报发布后会出现在这里。');
    }
    final groups = <String, List<BriefSummary>>{};
    for (final summary in model.archive) {
      groups.putIfAbsent(summary.date.substring(0, 7), () => []).add(summary);
    }
    return ListView(
      padding: EdgeInsets.fromLTRB(
        ledgerHorizontalPadding(context),
        20,
        ledgerHorizontalPadding(context),
        40,
      ),
      children: [
        for (final group in groups.entries) ...[
          LedgerSectionTitle(_month(group.key)),
          const SizedBox(height: 8),
          for (final summary in group.value) _ArchiveRow(summary: summary),
          const SizedBox(height: 28),
        ],
        if (model.archiveError != null) ...[
          LedgerNotice(model.archiveError!, error: true),
          const SizedBox(height: 8),
        ],
        if (model.archiveHasMore || model.archiveError != null)
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: model.loadingArchive ? null : model.loadMoreArchive,
              child: Text(
                model.loadingArchive
                    ? '正在加载…'
                    : model.archiveError != null
                    ? '重试加载'
                    : '加载更多',
              ),
            ),
          ),
      ],
    );
  }

  String _month(String value) {
    final parts = value.split('-');
    return '${parts[0]} 年 ${int.parse(parts[1])} 月';
  }
}

class _ArchiveRow extends StatelessWidget {
  const _ArchiveRow({required this.summary});
  final BriefSummary summary;
  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: '${summary.date}，${summary.itemCount} 条热点',
    excludeSemantics: true,
    child: InkWell(
      onTap: () => context.push('/briefs/${summary.date}'),
      child: Container(
        constraints: const BoxConstraints(minHeight: 56),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(color: Theme.of(context).dividerColor),
          ),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                summary.date,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
            Text(
              '${summary.itemCount} 条热点',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right, size: 20),
          ],
        ),
      ),
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
        return const LoadingState(label: '正在加载简报');
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
    final auth = context.watch<AuthController>();
    return ListView(
      padding: EdgeInsets.fromLTRB(
        ledgerHorizontalPadding(context),
        20,
        ledgerHorizontalPadding(context),
        40,
      ),
      children: [
        _AccountSection(auth: auth),
        const LedgerRule(),
        const LedgerSectionTitle('每日提醒'),
        const SizedBox(height: 8),
        Text(
          '只在新一期简报正式发布后提醒。不会上传阅读历史，也不会用于广告追踪。',
          style: Theme.of(context).textTheme.bodyLarge,
        ),
        const SizedBox(height: 12),
        if (push.status == PushStatus.unsupported)
          const Text('当前平台暂不支持发布通知。')
        else if (push.status == PushStatus.authorized)
          OutlinedButton(
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
        if (push.error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              push.error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        const LedgerRule(),
        const LedgerSectionTitle('隐私'),
        LedgerTextLink(
          label: '阅读隐私说明',
          onPressed: () => context.push('/privacy'),
        ),
        const LedgerRule(),
        const LedgerSectionTitle('应用信息'),
        const SizedBox(height: 8),
        const Text('WatchTower\n每日中文科技与产品情报简报\n外观跟随系统设置。'),
      ],
    );
  }
}

class _AccountSection extends StatelessWidget {
  const _AccountSection({required this.auth});
  final AuthController auth;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const LedgerSectionTitle('账号'),
      const SizedBox(height: 8),
      if (auth.loading)
        const Text('正在检查登录状态…')
      else if (!auth.signedIn) ...[
        Text(
          auth.error ?? '无需账号即可阅读。登录后可以查看反馈权限。',
          style: Theme.of(context).textTheme.bodyLarge,
        ),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: auth.busy ? null : auth.login,
          child: Text(auth.busy ? '正在登录…' : '使用 Apple 登录'),
        ),
      ] else ...[
        Text(auth.feedbackAllowed ? '反馈与音频重试权限已启用。' : '当前账号未加入白名单。'),
        const SizedBox(height: 8),
        SelectableText(
          'user ID：${auth.userId}',
          style: const TextStyle(fontFamily: 'monospace'),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton(
              onPressed: () =>
                  Clipboard.setData(ClipboardData(text: auth.userId!)),
              child: const Text('复制 user ID'),
            ),
            OutlinedButton(
              onPressed: auth.busy ? null : auth.logout,
              child: const Text('退出登录'),
            ),
          ],
        ),
        const LedgerRule(margin: EdgeInsets.symmetric(vertical: 20)),
        Text(
          '危险操作',
          style: TextStyle(
            color: Theme.of(context).colorScheme.error,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: auth.busy ? null : () => _deleteAccount(context, auth),
          child: const Text('删除账号'),
        ),
      ],
      if (auth.error != null && auth.signedIn)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            auth.error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ),
    ],
  );

  Future<void> _deleteAccount(BuildContext context, AuthController auth) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('删除账号？'),
        content: const Text('账号与白名单身份会被删除，此操作无法撤销。匿名阅读不受影响。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认删除'),
          ),
        ],
      ),
    );
    if (confirmed == true) await auth.deleteAccount();
  }
}

class PrivacyScreen extends StatelessWidget {
  const PrivacyScreen({super.key});
  @override
  Widget build(BuildContext context) {
    const sections = [
      (
        '匿名阅读',
        'WatchTower 无需账号即可使用，不包含广告或跨应用追踪 SDK。你阅读过哪些简报、播放到哪里，只保存在设备本地。只有在你主动使用 Apple 登录后，服务端才会保存 Auth0 user ID、白名单状态和共享反馈；账号可随时删除。',
      ),
      (
        '发布通知',
        '只有在你主动开启提醒后，App 才会把 APNs 设备令牌加密发送给 WatchTower。令牌只用于发送新简报通知；关闭提醒后，服务端会删除对应订阅。',
      ),
      ('公开来源', '简报中的外部链接会通过应用内浏览器打开，目标网站适用其各自的隐私政策。'),
      (
        '拓展阅读',
        '点击“拓展阅读”会触发服务端检索公开资料。同一热点的结果会匿名共享和缓存；原始 IP 仅由 Cloudflare 临时用于宽松限流，不写入 WatchTower 数据库。',
      ),
    ];
    return SelectionArea(
      child: ListView(
        padding: EdgeInsets.fromLTRB(
          ledgerHorizontalPadding(context),
          24,
          ledgerHorizontalPadding(context),
          48,
        ),
        children: [
          for (var index = 0; index < sections.length; index++) ...[
            LedgerSectionTitle(sections[index].$1),
            const SizedBox(height: 12),
            Text(
              sections[index].$2,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            if (index < sections.length - 1) const LedgerRule(),
          ],
        ],
      ),
    );
  }
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

  void _retry() => setState(
    () => _future = context.read<BriefRepository>().loadExploration(
      widget.briefDate,
      widget.entityId,
    ),
  );
  @override
  Widget build(BuildContext context) => FutureBuilder<LoadResult<Exploration>>(
    future: _future,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) {
        return const LoadingState(
          label: '正在加载拓展阅读',
          detail: '正在查找背景、相关产品和外部观点。',
        );
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
    final notices = <String>[
      if (result.offline) '当前显示离线缓存，生成于 ${_utc(exploration.generatedAt)} UTC。',
      if (exploration.refreshing)
        '正在后台更新，当前先显示上一次结果。'
      else if (exploration.stale)
        '当前结果已过期，可联网后重新打开刷新。',
      if (exploration.refreshLimited) '今日刷新额度已用完，当前继续显示已有结果。',
      if (exploration.quality == 'partial') '现有资料只支持部分结论，以下内容按实际证据展示。',
    ];
    final blocks = <(String, List<Widget>)>[
      (
        '展开说明',
        [
          _CitedCopy(
            text: sections.overview.text,
            sourceIds: sections.overview.sourceIds,
            sources: sources,
          ),
        ],
      ),
      (
        '相关产品',
        sections.relatedProducts.isEmpty
            ? [const Text('现有资料不足以确认相关产品关系。')]
            : [
                for (final item in sections.relatedProducts)
                  _ExplorationEntry(
                    title: '${item.name} / ${item.relation}',
                    summary: item.summary,
                    sourceIds: item.sourceIds,
                    sources: sources,
                  ),
              ],
      ),
      (
        '外部观点',
        sections.perspectives.isEmpty
            ? [const Text('暂未找到足够可靠的外部观点。')]
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
      (
        '行业位置',
        [
          sections.industry == null
              ? const Text('现有资料不足以判断行业位置。')
              : _CitedCopy(
                  text: sections.industry!.text,
                  sourceIds: sections.industry!.sourceIds,
                  sources: sources,
                ),
        ],
      ),
      (
        '接下来关注什么',
        sections.watchNext.isEmpty
            ? [const Text('暂时没有足够证据支持可验证的后续信号。')]
            : [
                for (final item in sections.watchNext)
                  _CitedCopy(
                    text: item.signal,
                    sourceIds: item.sourceIds,
                    sources: sources,
                  ),
              ],
      ),
      (
        '资料来源',
        [
          for (final source in exploration.sources)
            LedgerTextLink(
              label: '${source.title} / ${source.domain}',
              onPressed: () =>
                  launchUrl(source.url, mode: LaunchMode.inAppBrowserView),
            ),
        ],
      ),
    ];
    return SelectionArea(
      child: ListView(
        padding: EdgeInsets.fromLTRB(
          ledgerHorizontalPadding(context),
          20,
          ledgerHorizontalPadding(context),
          48,
        ),
        children: [
          for (final notice in notices) ...[
            LedgerNotice(notice),
            const SizedBox(height: 12),
          ],
          for (var index = 0; index < blocks.length; index++) ...[
            LedgerSectionTitle(blocks[index].$1),
            const SizedBox(height: 12),
            for (var child = 0; child < blocks[index].$2.length; child++) ...[
              blocks[index].$2[child],
              if (child < blocks[index].$2.length - 1)
                const SizedBox(height: 20),
            ],
            if (index < blocks.length - 1) const LedgerRule(),
          ],
          const SizedBox(height: 24),
          Text(
            'AI 基于公开资料整理，信息可能随时间变化，请以原始来源为准。更新于 ${_utc(exploration.generatedAt)} UTC。',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
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
      Text(title, style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8),
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
      Text(text, style: Theme.of(context).textTheme.bodyLarge),
      const SizedBox(height: 6),
      Wrap(
        spacing: 4,
        runSpacing: 4,
        children: [
          for (final id in sourceIds)
            if (sources[id] != null)
              LedgerTextLink(
                label: '来源 ${id.replaceFirst('source_', '')}',
                onPressed: () => launchUrl(
                  sources[id]!.url,
                  mode: LaunchMode.inAppBrowserView,
                ),
              ),
        ],
      ),
    ],
  );
}

class LoadingState extends StatelessWidget {
  const LoadingState({
    this.label = '正在加载简报',
    this.detail = '正在获取今天值得关注的技术与产品变化。',
    super.key,
  });
  final String label;
  final String detail;
  @override
  Widget build(BuildContext context) => ListView(
    padding: EdgeInsets.fromLTRB(
      ledgerHorizontalPadding(context),
      32,
      ledgerHorizontalPadding(context),
      40,
    ),
    children: [
      LedgerSectionTitle(label),
      const SizedBox(height: 12),
      Text(detail, style: Theme.of(context).textTheme.bodyLarge),
      const SizedBox(height: 28),
      const _Skeleton(width: 280, height: 28),
      const SizedBox(height: 12),
      const _Skeleton(width: double.infinity, height: 16),
      const SizedBox(height: 8),
      const _Skeleton(width: 240, height: 16),
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
    color: Theme.of(context).colorScheme.surfaceContainerHighest,
  );
}

class ErrorState extends StatelessWidget {
  const ErrorState({
    required this.message,
    this.title = '暂时无法加载',
    this.onRetry,
    super.key,
  });
  final String title;
  final String message;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) => ListView(
    padding: EdgeInsets.fromLTRB(
      ledgerHorizontalPadding(context),
      32,
      ledgerHorizontalPadding(context),
      40,
    ),
    children: [
      LedgerSectionTitle(title),
      const SizedBox(height: 12),
      Text(message, style: Theme.of(context).textTheme.bodyLarge),
      if (onRetry != null) ...[
        const SizedBox(height: 20),
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton(onPressed: onRetry, child: const Text('重试')),
        ),
      ],
    ],
  );
}

String _utc(DateTime? value) => value == null
    ? '未知时间'
    : value.toUtc().toIso8601String().replaceFirst('T', ' ').substring(0, 16);
