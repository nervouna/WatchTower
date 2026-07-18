import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../audio/audio_controller.dart';
import '../auth/auth_controller.dart';
import '../config.dart';
import '../models.dart';
import '../theme.dart';

String _duration(double seconds) {
  final rounded = seconds.round();
  return '${rounded ~/ 60} 分 ${(rounded % 60).toString().padLeft(2, '0')} 秒';
}

class BriefView extends StatefulWidget {
  const BriefView({
    required this.brief,
    required this.offline,
    this.fetchedAt,
    super.key,
  });
  final Brief brief;
  final bool offline;
  final DateTime? fetchedAt;

  @override
  State<BriefView> createState() => _BriefViewState();
}

class _BriefViewState extends State<BriefView> {
  String? _feedbackUserId;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _loadFeedbackIfAvailable();
  }

  @override
  void didUpdateWidget(covariant BriefView oldWidget) {
    super.didUpdateWidget(oldWidget);
    final refreshed =
        oldWidget.fetchedAt != widget.fetchedAt ||
        oldWidget.brief.date != widget.brief.date ||
        (oldWidget.offline && !widget.offline);
    if (refreshed) _loadFeedbackIfAvailable(force: true);
  }

  void _loadFeedbackIfAvailable({bool force = false}) {
    final auth = context.read<AuthController?>();
    if (!widget.offline &&
        auth?.feedbackAllowed == true &&
        (force || auth?.userId != _feedbackUserId)) {
      _feedbackUserId = auth?.userId;
      unawaited(
        auth!.loadFeedback(widget.brief.items.map((item) => item.entityId)),
      );
    } else if (auth?.feedbackAllowed != true) {
      _feedbackUserId = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final brief = widget.brief;
    final offline = widget.offline;
    final fetchedAt = widget.fetchedAt;
    final auth = context.watch<AuthController?>();
    final theme = Theme.of(context);
    final width = MediaQuery.sizeOf(context).width;
    final horizontal = width > 792 ? (width - 760) / 2 : 16.0;
    return SelectionArea(
      child: ListView(
        padding: EdgeInsets.fromLTRB(horizontal, 12, horizontal, 32),
        children: [
          if (offline)
            _Notice(
              icon: Icons.cloud_off_outlined,
              text: fetchedAt == null
                  ? '当前显示离线内容。'
                  : '当前显示离线内容，缓存于 ${_time(fetchedAt)}。',
            ),
          if (brief.status == 'partial')
            _Notice(
              icon: Icons.info_outline,
              text:
                  '部分简报 · ${brief.missingSources.map((source) => sourceNames[source] ?? source).join('、')} 暂缺',
            ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    brief.headline,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      height: 1.2,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    brief.intro,
                    style: theme.textTheme.bodyLarge?.copyWith(
                      height: 1.65,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  if (brief.audio != null) ...[
                    const SizedBox(height: 20),
                    _AudioCard(brief: brief, offline: offline, auth: auth),
                  ],
                  const SizedBox(height: 20),
                  _Coverage(counts: brief.sourceCounts),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Text(
                  '本期热点',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${brief.items.length} 条经过筛选的技术与产品信号',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (brief.items.isEmpty)
            const _EmptyBrief()
          else
            for (final item in brief.items) ...[
              _BriefItemCard(
                item: item,
                briefDate: brief.date,
                offline: offline,
                auth: auth,
                explorationEnabled: brief.explorationEnabled,
              ),
              const SizedBox(height: 12),
            ],
        ],
      ),
    );
  }

  String _time(DateTime value) =>
      '${value.month}月${value.day}日 ${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 12),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(10),
    ),
    child: Row(
      children: [
        Icon(icon, size: 20),
        const SizedBox(width: 10),
        Expanded(child: Text(text)),
      ],
    ),
  );
}

class _Meta extends StatelessWidget {
  const _Meta({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(999),
    ),
    child: Text(
      text,
      style: Theme.of(
        context,
      ).textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w600),
    ),
  );
}

class _Coverage extends StatelessWidget {
  const _Coverage({required this.counts});
  final Map<String, int> counts;

  @override
  Widget build(BuildContext context) {
    final sources = sourceNames.entries
        .where((source) => (counts[source.key] ?? 0) > 0)
        .map((source) => '${source.value} ${counts[source.key]}')
        .toList(growable: false);
    if (sources.isEmpty) return const SizedBox.shrink();
    final visible = '来源：${sources.join(' · ')}';
    final semantics = '来源：${sources.join('，')}';
    return Semantics(
      container: true,
      label: semantics,
      excludeSemantics: true,
      child: Text(
        visible,
        textAlign: TextAlign.center,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
          color: Theme.of(context).colorScheme.onSurfaceVariant,
          height: 1.5,
        ),
      ),
    );
  }
}

class _AudioCard extends StatefulWidget {
  const _AudioCard({
    required this.brief,
    required this.offline,
    required this.auth,
  });
  final Brief brief;
  final bool offline;
  final AuthController? auth;
  @override
  State<_AudioCard> createState() => _AudioCardState();
}

class _AudioCardState extends State<_AudioCard> {
  bool retrying = false;
  bool queued = false;
  String? retryError;
  @override
  Widget build(BuildContext context) {
    final brief = widget.brief;
    final audioInfo = brief.audio!;
    final controller = context.watch<AudioController>();
    if (audioInfo.status != 'ready') {
      return _AudioCardShell(
        brief: brief,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _AudioTitle(),
            const SizedBox(height: 4),
            Text(
              queued || audioInfo.status == 'pending'
                  ? '语音版正在生成，文字简报可以正常阅读。'
                  : '语音版暂时不可用，文字简报不受影响。',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            if (audioInfo.status == 'failed' &&
                widget.auth?.audioRetryAllowed == true) ...[
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerLeft,
                child: FilledButton.tonal(
                  onPressed: widget.offline || retrying || queued
                      ? null
                      : () async {
                          setState(() => retrying = true);
                          try {
                            await widget.auth!.retryAudio(brief.date);
                            if (mounted) setState(() => queued = true);
                          } catch (_) {
                            if (mounted) {
                              setState(() => retryError = '提交失败，请重试。');
                            }
                          } finally {
                            if (mounted) setState(() => retrying = false);
                          }
                        },
                  child: Text(
                    widget.offline
                        ? '连接网络后重试'
                        : retrying
                        ? '正在提交…'
                        : queued
                        ? '语音正在重新生成'
                        : '重新生成语音',
                  ),
                ),
              ),
              if (retryError != null) ...[
                const SizedBox(height: 6),
                Text(
                  retryError!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
            ],
          ],
        ),
      );
    }
    if (controller.availability != AudioAvailability.ready) {
      return _AudioCardShell(
        brief: brief,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const _AudioTitle(),
            const SizedBox(height: 4),
            Text(
              controller.availability == AudioAvailability.initializing
                  ? '正在准备播放器，文字简报可以正常阅读。'
                  : '音频暂时不可用，文字简报不受影响。',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      );
    }
    final active = controller.item?.id == brief.date;
    return _AudioCardShell(
      brief: brief,
      highlighted: true,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _AudioTitle(
                  text:
                      '约 ${_approximateMinutes(audioInfo.durationSeconds!)} 分钟听完本期',
                ),
                const SizedBox(height: 4),
                Text(
                  controller.error ??
                      'AI 语音 · ${_duration(audioInfo.durationSeconds!)}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: controller.error == null
                        ? Theme.of(context).colorScheme.onSurfaceVariant
                        : Theme.of(context).colorScheme.error,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          IconButton.filled(
            onPressed: controller.loading
                ? null
                : () => controller.toggle(brief),
            tooltip: active && controller.playing ? '暂停语音简报' : '播放语音简报',
            icon: Icon(
              controller.loading && active
                  ? Icons.hourglass_top
                  : active && controller.playing
                  ? Icons.pause_rounded
                  : Icons.play_arrow_rounded,
            ),
          ),
        ],
      ),
    );
  }
}

int _approximateMinutes(double seconds) {
  final minutes = (seconds / 60).round();
  return minutes < 1 ? 1 : minutes;
}

class _AudioCardShell extends StatelessWidget {
  const _AudioCardShell({
    required this.brief,
    required this.child,
    this.highlighted = false,
  });
  final Brief brief;
  final Widget child;
  final bool highlighted;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: highlighted
          ? Theme.of(context).colorScheme.primary.withValues(alpha: 0.08)
          : Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(10),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        _PodcastCover(brief: brief),
        const SizedBox(width: 12),
        Expanded(child: child),
      ],
    ),
  );
}

class _AudioTitle extends StatelessWidget {
  const _AudioTitle({this.text = '语音简报'});
  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: Theme.of(
      context,
    ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
  );
}

class _PodcastCover extends StatelessWidget {
  const _PodcastCover({required this.brief});
  final Brief brief;

  @override
  Widget build(BuildContext context) {
    final cover = brief.audio?.cover;
    final ready = cover?.status == 'ready' && cover?.url != null;
    final imageUrl = ready
        ? Uri.parse(AppConfig.apiBaseUrl).resolve(cover!.url!).toString()
        : null;
    final size = MediaQuery.sizeOf(context).width >= 600 ? 96.0 : 72.0;
    return ExcludeSemantics(
      child: SizedBox.square(
        dimension: size,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: Stack(
            fit: StackFit.expand,
            children: [
              const _CoverFallback(),
              if (imageUrl != null)
                Image.network(
                  imageUrl,
                  fit: BoxFit.cover,
                  excludeFromSemantics: true,
                  errorBuilder: (_, _, _) => const SizedBox.shrink(),
                  loadingBuilder: (context, child, progress) =>
                      progress == null ? child : const SizedBox.shrink(),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CoverFallback extends StatelessWidget {
  const _CoverFallback();

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.primary,
      gradient: RadialGradient(
        center: const Alignment(0.55, -0.5),
        radius: 0.72,
        colors: [
          Theme.of(context).colorScheme.primary,
          const Color(0xFF18343D),
        ],
      ),
    ),
  );
}

class _BriefItemCard extends StatelessWidget {
  const _BriefItemCard({
    required this.item,
    required this.briefDate,
    required this.offline,
    required this.auth,
    required this.explorationEnabled,
  });
  final BriefItem item;
  final String briefDate;
  final bool offline;
  final AuthController? auth;
  final bool explorationEnabled;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              item.rank.toString().padLeft(2, '0'),
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium?.copyWith(
                color: theme.colorScheme.primary,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              item.title,
              textAlign: TextAlign.center,
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w700,
                height: 1.3,
              ),
            ),
            const SizedBox(height: 14),
            Text(
              item.summary,
              style: theme.textTheme.bodyLarge?.copyWith(height: 1.65),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    '为什么值得看',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.labelLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    item.whyItMatters,
                    style: theme.textTheme.bodyMedium?.copyWith(height: 1.6),
                  ),
                ],
              ),
            ),
            if (item.continuity.kind == 'continuing') ...[
              const SizedBox(height: 14),
              Text(
                '持续关注：${item.continuity.materialChange}',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.primary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
            const SizedBox(height: 14),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 8,
              runSpacing: 8,
              children: [for (final tag in item.tags) _Meta(text: tag)],
            ),
            if (auth?.feedbackAllowed == true) ...[
              const SizedBox(height: 12),
              _FeedbackControls(
                item: item,
                briefDate: briefDate,
                offline: offline,
                auth: auth!,
              ),
            ],
            if (explorationEnabled) ...[
              const SizedBox(height: 10),
              FilledButton.icon(
                onPressed: () => context.push(
                  '/explorations/$briefDate/${item.entityId}',
                  extra: item.title,
                ),
                icon: const Icon(Icons.manage_search),
                label: const Text('拓展阅读'),
              ),
            ],
            const SizedBox(height: 14),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 8,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  '来源',
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                for (final source in item.sources)
                  TextButton.icon(
                    onPressed: () => launchUrl(
                      source.url,
                      mode: LaunchMode.inAppBrowserView,
                    ),
                    icon: const Icon(Icons.open_in_new, size: 16),
                    label: Text(source.label),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _FeedbackControls extends StatelessWidget {
  const _FeedbackControls({
    required this.item,
    required this.briefDate,
    required this.offline,
    required this.auth,
  });
  final BriefItem item;
  final String briefDate;
  final bool offline;
  final AuthController auth;

  @override
  Widget build(BuildContext context) {
    final current = auth.feedback[item.entityId];
    final saving = auth.savingFeedback.contains(item.entityId);
    final error = auth.feedbackErrors[item.entityId];
    const choices = {
      'follow': '持续关注',
      'irrelevant': '不相关',
      'uninteresting': '没意思',
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('指导后续筛选', style: Theme.of(context).textTheme.labelMedium),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final choice in choices.entries)
              FilterChip(
                label: Text(choice.value),
                selected: current == choice.key,
                onSelected: offline || saving
                    ? null
                    : (_) => auth.setFeedback(
                        item.entityId,
                        briefDate,
                        current == choice.key ? null : choice.key,
                      ),
              ),
          ],
        ),
        if (offline)
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text('连接网络后可提交反馈。'),
          ),
        if (saving)
          const Padding(padding: EdgeInsets.only(top: 6), child: Text('正在保存…')),
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              error,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
      ],
    );
  }
}

class _EmptyBrief extends StatelessWidget {
  const _EmptyBrief();
  @override
  Widget build(BuildContext context) => const Card(
    child: Padding(
      padding: EdgeInsets.all(24),
      child: Column(
        children: [
          Icon(Icons.radar, size: 36, color: radarCyan),
          SizedBox(height: 12),
          Text('本期暂无可发布热点'),
          SizedBox(height: 6),
          Text('当前信号还不足以形成可靠简报。', textAlign: TextAlign.center),
        ],
      ),
    ),
  );
}
