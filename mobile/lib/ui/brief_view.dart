import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../audio/audio_controller.dart';
import '../models.dart';
import '../theme.dart';

String _duration(double seconds) {
  final rounded = seconds.round();
  return '${rounded ~/ 60} 分 ${(rounded % 60).toString().padLeft(2, '0')} 秒';
}

class BriefView extends StatelessWidget {
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
  Widget build(BuildContext context) {
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
                  : '当前显示离线内容，缓存于 ${_time(fetchedAt!)}。',
            ),
          if (brief.status == 'partial')
            _Notice(
              icon: Icons.info_outline,
              text:
                  '本期为部分简报，暂缺：${brief.missingSources.map((source) => sourceNames[source] ?? source).join('、')}',
            ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    brief.headline,
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
                  const SizedBox(height: 18),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _Meta(text: brief.status == 'complete' ? '完整简报' : '部分简报'),
                      _Meta(text: '${brief.items.length} 条热点'),
                    ],
                  ),
                  if (brief.audio != null) ...[
                    const SizedBox(height: 20),
                    _AudioCard(brief: brief),
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
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '本期热点',
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${brief.items.length} 条经过筛选的技术与产品信号',
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
              _BriefItemCard(item: item),
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
  Widget build(BuildContext context) => Wrap(
    spacing: 16,
    runSpacing: 12,
    children: [
      for (final source in sourceNames.entries)
        SizedBox(
          width: 132,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                source.value,
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                '${counts[source.key] ?? 0} 条',
                style: Theme.of(
                  context,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
              ),
            ],
          ),
        ),
    ],
  );
}

class _AudioCard extends StatelessWidget {
  const _AudioCard({required this.brief});
  final Brief brief;
  @override
  Widget build(BuildContext context) {
    final audioInfo = brief.audio!;
    final controller = context.watch<AudioController>();
    if (audioInfo.status != 'ready') {
      return Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          audioInfo.status == 'pending'
              ? '语音版正在生成，文字简报可以正常阅读。'
              : '语音版暂时不可用，文字简报不受影响。',
        ),
      );
    }
    if (controller.availability != AudioAvailability.ready) {
      return Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          controller.availability == AudioAvailability.initializing
              ? '正在准备播放器，文字简报可以正常阅读。'
              : '音频暂时不可用，文字简报不受影响。',
        ),
      );
    }
    final active = controller.item?.id == brief.date;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
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
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '约 3 分钟听完本期',
                  style: Theme.of(
                    context,
                  ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 3),
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
        ],
      ),
    );
  }
}

class _BriefItemCard extends StatelessWidget {
  const _BriefItemCard({required this.item});
  final BriefItem item;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.rank.toString().padLeft(2, '0'),
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: theme.colorScheme.primary,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    item.title,
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                      height: 1.3,
                    ),
                  ),
                ),
              ],
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
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '为什么值得看',
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
              spacing: 8,
              runSpacing: 8,
              children: [for (final tag in item.tags) _Meta(text: tag)],
            ),
            const SizedBox(height: 14),
            Wrap(
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
          Text('当前信号还不足以形成可靠简报。'),
        ],
      ),
    ),
  );
}
