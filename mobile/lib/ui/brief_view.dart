import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../audio/audio_controller.dart';
import '../auth/auth_controller.dart';
import '../models.dart';
import '../theme.dart';
import 'ledger.dart';

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
  late List<GlobalKey> _itemKeys;

  @override
  void initState() {
    super.initState();
    _itemKeys = List.generate(widget.brief.items.length, (_) => GlobalKey());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _loadFeedback();
  }

  @override
  void didUpdateWidget(covariant BriefView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.brief.date != widget.brief.date ||
        oldWidget.brief.items.length != widget.brief.items.length) {
      _itemKeys = List.generate(widget.brief.items.length, (_) => GlobalKey());
    }
    if (oldWidget.fetchedAt != widget.fetchedAt ||
        oldWidget.offline != widget.offline) {
      _loadFeedback(force: true);
    }
  }

  void _loadFeedback({bool force = false}) {
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
    final auth = context.watch<AuthController?>();
    final width = MediaQuery.sizeOf(context).width;
    final headlineSize = width >= 700 ? 46.0 : 36.0;
    final ledger = Theme.of(context).extension<LedgerTheme>()!;
    return SelectionArea(
      child: ListView(
        padding: EdgeInsets.fromLTRB(
          ledgerHorizontalPadding(context),
          16,
          ledgerHorizontalPadding(context),
          48,
        ),
        children: [
          if (widget.offline)
            Padding(
              padding: const EdgeInsets.only(bottom: 24),
              child: LedgerNotice(
                widget.fetchedAt == null
                    ? '当前显示离线内容。'
                    : '当前显示离线内容，缓存于 ${_time(widget.fetchedAt!)}。',
              ),
            ),
          Text(
            '${brief.date} / 更新 ${brief.generatedAt.toUtc().hour.toString().padLeft(2, '0')}:${brief.generatedAt.toUtc().minute.toString().padLeft(2, '0')} UTC',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 16),
          Text(
            brief.headline,
            textAlign: TextAlign.left,
            style: ledger
                .serif(
                  size: headlineSize,
                  weight: FontWeight.w600,
                  height: 1.16,
                )
                .copyWith(color: Theme.of(context).colorScheme.onSurface),
          ),
          const SizedBox(height: 20),
          Text(brief.intro, style: Theme.of(context).textTheme.bodyLarge),
          if (_coverage(brief.sourceCounts) case final coverage?) ...[
            const SizedBox(height: 20),
            Text(
              '来源覆盖 / $coverage',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
          if (brief.audio != null) ...[
            const SizedBox(height: 20),
            _AudioToolbar(brief: brief, offline: widget.offline, auth: auth),
          ],
          if (brief.items.isNotEmpty) ...[
            const LedgerRule(),
            Semantics(
              label: '本期目录，共 ${brief.items.length} 条',
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (var index = 0; index < brief.items.length; index++)
                    TextButton(
                      onPressed: () {
                        final target = _itemKeys[index].currentContext;
                        if (target != null) {
                          Scrollable.ensureVisible(
                            target,
                            duration: Duration.zero,
                            alignment: 0.05,
                          );
                        }
                      },
                      child: Text((index + 1).toString().padLeft(2, '0')),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
          ],
          if (brief.items.isEmpty)
            const _EmptyBrief()
          else
            for (var index = 0; index < brief.items.length; index++)
              _BriefEntry(
                key: _itemKeys[index],
                item: brief.items[index],
                itemCount: brief.items.length,
                briefDate: brief.date,
                offline: widget.offline,
                auth: auth,
                explorationEnabled: brief.explorationEnabled,
              ),
        ],
      ),
    );
  }

  String _time(DateTime value) =>
      '${value.month}月${value.day}日 ${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
}

String? _coverage(Map<String, int> counts) {
  final values = <String>[];
  for (final source in sourceNames.entries) {
    final count = counts[source.key] ?? 0;
    if (count > 0) values.add('${source.value} $count');
  }
  return values.isEmpty ? null : values.join(' / ');
}

class _AudioToolbar extends StatefulWidget {
  const _AudioToolbar({
    required this.brief,
    required this.offline,
    required this.auth,
  });
  final Brief brief;
  final bool offline;
  final AuthController? auth;
  @override
  State<_AudioToolbar> createState() => _AudioToolbarState();
}

class _AudioToolbarState extends State<_AudioToolbar> {
  bool retrying = false;
  bool queued = false;
  String? error;

  @override
  Widget build(BuildContext context) {
    final info = widget.brief.audio!;
    final audio = context.watch<AudioController?>();
    String copy;
    VoidCallback? play;
    IconData icon = Icons.play_arrow;
    if (widget.offline) {
      copy = '音频需要联网播放。';
    } else if (info.status == 'pending' || queued) {
      copy = queued ? '语音已加入生成队列。' : '语音版正在生成，文字简报可以正常阅读。';
    } else if (info.status == 'failed') {
      copy = '语音版暂时不可用，文字简报不受影响。';
    } else if (audio == null ||
        audio.availability == AudioAvailability.initializing) {
      copy = '正在准备播放器，文字简报可以正常阅读。';
    } else if (audio.availability != AudioAvailability.ready) {
      copy = '音频暂时不可用，文字简报不受影响。';
    } else {
      final seconds = info.durationSeconds ?? 0;
      final active = audio.item?.id == widget.brief.date;
      copy =
          audio.error ??
          '约 ${((seconds / 60).round()).clamp(1, 999)} 分钟听完 / ${_duration(seconds)}';
      play = audio.loading ? null : () => audio.toggle(widget.brief);
      icon = active && audio.playing ? Icons.pause : Icons.play_arrow;
    }
    final canRetry =
        (info.status == 'failed' || info.status == 'pending') &&
        widget.auth?.audioRetryAllowed == true;
    return Semantics(
      container: true,
      label: '语音简报，$copy',
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          border: Border.symmetric(
            horizontal: BorderSide(color: Theme.of(context).dividerColor),
          ),
        ),
        child: Wrap(
          spacing: 12,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            if (play != null)
              IconButton(
                onPressed: play,
                tooltip: icon == Icons.pause ? '暂停语音简报' : '播放语音简报',
                icon: Icon(icon),
              ),
            const Text('语音简报', style: TextStyle(fontWeight: FontWeight.w700)),
            Text(copy, style: Theme.of(context).textTheme.bodySmall),
            if (canRetry)
              TextButton(
                onPressed: widget.offline || retrying || queued ? null : _retry,
                child: Text(
                  widget.offline
                      ? '连接网络后重试'
                      : retrying
                      ? '正在提交…'
                      : queued
                      ? '已提交生成'
                      : '重新生成语音',
                ),
              ),
            if (error != null)
              Text(
                error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _retry() async {
    setState(() {
      retrying = true;
      error = null;
    });
    try {
      await widget.auth!.retryAudio(widget.brief.date);
      if (mounted) setState(() => queued = true);
    } catch (_) {
      if (mounted) setState(() => error = '提交失败，请重试。');
    } finally {
      if (mounted) setState(() => retrying = false);
    }
  }
}

class _BriefEntry extends StatelessWidget {
  const _BriefEntry({
    required this.item,
    required this.itemCount,
    required this.briefDate,
    required this.offline,
    required this.auth,
    required this.explorationEnabled,
    super.key,
  });
  final BriefItem item;
  final int itemCount;
  final String briefDate;
  final bool offline;
  final AuthController? auth;
  final bool explorationEnabled;

  @override
  Widget build(BuildContext context) {
    final ledger = Theme.of(context).extension<LedgerTheme>()!;
    return Semantics(
      container: true,
      label: '第 ${item.rank} 条，共 $itemCount 条',
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 28),
        decoration: BoxDecoration(
          border: Border(
            top: BorderSide(color: Theme.of(context).dividerColor),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              item.rank.toString().padLeft(2, '0'),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.primary,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              item.title,
              textAlign: TextAlign.left,
              style: ledger
                  .serif(size: 26, weight: FontWeight.w600, height: 1.28)
                  .copyWith(color: Theme.of(context).colorScheme.onSurface),
            ),
            const SizedBox(height: 16),
            Text(item.summary, style: Theme.of(context).textTheme.bodyLarge),
            const SizedBox(height: 16),
            Text.rich(
              TextSpan(
                children: [
                  const TextSpan(
                    text: '为什么值得看：',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                  TextSpan(text: item.whyItMatters),
                ],
              ),
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            if (item.continuity.kind == 'continuing') ...[
              const SizedBox(height: 16),
              Text.rich(
                TextSpan(
                  children: [
                    const TextSpan(
                      text: '持续关注：',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    TextSpan(text: item.continuity.materialChange),
                  ],
                ),
                style: Theme.of(context).textTheme.bodyLarge,
              ),
            ],
            if (item.tags.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(
                item.tags.join(' / '),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            const SizedBox(height: 12),
            Wrap(
              spacing: 4,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text('来源 /', style: Theme.of(context).textTheme.bodySmall),
                for (final source in item.sources)
                  LedgerTextLink(
                    label: source.label,
                    onPressed: () => launchUrl(
                      source.url,
                      mode: LaunchMode.inAppBrowserView,
                    ),
                  ),
                if (explorationEnabled)
                  LedgerTextLink(
                    label: '拓展阅读',
                    onPressed: () => context.push(
                      '/explorations/$briefDate/${item.entityId}',
                      extra: item.title,
                    ),
                  ),
              ],
            ),
            if (auth?.feedbackAllowed == true) ...[
              const SizedBox(height: 16),
              _FeedbackControls(
                item: item,
                briefDate: briefDate,
                offline: offline,
                auth: auth!,
              ),
            ],
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
    return Semantics(
      container: true,
      label: '这条内容',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('这条内容', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final choice in choices.entries)
                SizedBox(
                  height: 48,
                  child: OutlinedButton(
                    onPressed: offline || saving
                        ? null
                        : () => auth.setFeedback(
                            item.entityId,
                            briefDate,
                            current == choice.key ? null : choice.key,
                          ),
                    style: OutlinedButton.styleFrom(
                      backgroundColor: current == choice.key
                          ? Theme.of(
                              context,
                            ).colorScheme.surfaceContainerHighest
                          : Colors.transparent,
                      foregroundColor: current == choice.key
                          ? Theme.of(context).colorScheme.primary
                          : Theme.of(context).colorScheme.onSurface,
                    ),
                    child: Text(choice.value),
                  ),
                ),
            ],
          ),
          if (offline)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('连接网络后可提交反馈。'),
            ),
          if (saving)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('正在保存…'),
            ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                error,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
        ],
      ),
    );
  }
}

class _EmptyBrief extends StatelessWidget {
  const _EmptyBrief();
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 32),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const LedgerSectionTitle('本期暂无可发布热点'),
        const SizedBox(height: 12),
        Text('当前信号还不足以形成可靠简报。', style: Theme.of(context).textTheme.bodyLarge),
      ],
    ),
  );
}
