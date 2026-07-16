import 'dart:async';

import 'package:audio_service/audio_service.dart';
import 'package:audio_session/audio_session.dart';
import 'package:flutter/foundation.dart';
import 'package:just_audio/just_audio.dart' as audio;

import '../data/brief_repository.dart';
import '../models.dart';

class WatchTowerAudioHandler extends BaseAudioHandler with SeekHandler {
  WatchTowerAudioHandler() {
    _player.playbackEventStream.listen(_broadcastState);
    _player.durationStream.listen((duration) {
      final item = mediaItem.value;
      if (item != null && duration != null) {
        mediaItem.add(item.copyWith(duration: duration));
      }
    });
  }

  final audio.AudioPlayer _player = audio.AudioPlayer();

  Future<void> configure() async {
    final session = await AudioSession.instance;
    await session.configure(const AudioSessionConfiguration.speech());
  }

  Future<void> setBrief(Brief brief, Uri uri) async {
    final current = mediaItem.value;
    if (current?.id != brief.date) {
      final item = MediaItem(
        id: brief.date,
        title: brief.headline,
        album: 'WatchTower 每日简报',
        duration: brief.audio?.durationSeconds == null
            ? null
            : Duration(
                milliseconds: (brief.audio!.durationSeconds! * 1000).round(),
              ),
        extras: {'briefDate': brief.date},
      );
      mediaItem.add(item);
      await _player.setUrl(uri.toString());
    }
  }

  void _broadcastState(audio.PlaybackEvent event) {
    playbackState.add(
      PlaybackState(
        controls: [
          MediaControl.rewind,
          _player.playing ? MediaControl.pause : MediaControl.play,
          MediaControl.fastForward,
          MediaControl.stop,
        ],
        systemActions: const {MediaAction.seek},
        processingState: switch (_player.processingState) {
          audio.ProcessingState.idle => AudioProcessingState.idle,
          audio.ProcessingState.loading => AudioProcessingState.loading,
          audio.ProcessingState.buffering => AudioProcessingState.buffering,
          audio.ProcessingState.ready => AudioProcessingState.ready,
          audio.ProcessingState.completed => AudioProcessingState.completed,
        },
        playing: _player.playing,
        updatePosition: _player.position,
        bufferedPosition: _player.bufferedPosition,
        speed: _player.speed,
        queueIndex: event.currentIndex,
      ),
    );
  }

  @override
  Future<void> play() => _player.play();
  @override
  Future<void> pause() => _player.pause();
  @override
  Future<void> stop() async {
    await _player.stop();
    mediaItem.add(null);
    await super.stop();
  }

  @override
  Future<void> seek(Duration position) => _player.seek(position);
  @override
  Future<void> fastForward() =>
      seek(_player.position + const Duration(seconds: 15));
  @override
  Future<void> rewind() => seek(_player.position - const Duration(seconds: 15));
}

class AudioController extends ChangeNotifier {
  AudioController({required this._handler, required this._repository}) {
    _subscriptions.add(
      _handler.playbackState.listen((value) {
        state = value;
        notifyListeners();
      }),
    );
    _subscriptions.add(
      _handler.mediaItem.listen((value) {
        item = value;
        notifyListeners();
      }),
    );
  }

  final WatchTowerAudioHandler _handler;
  final BriefRepository _repository;
  final List<StreamSubscription<Object?>> _subscriptions = [];
  PlaybackState state = PlaybackState();
  MediaItem? item;
  bool loading = false;
  String? error;

  bool get playing => state.playing;

  Future<void> toggle(Brief brief) async {
    final audioInfo = brief.audio;
    if (audioInfo?.status != 'ready' || audioInfo?.url == null) return;
    loading = true;
    error = null;
    notifyListeners();
    try {
      await _handler.setBrief(brief, _repository.resolve(audioInfo!.url!));
      if (_handler.playbackState.value.playing) {
        await _handler.pause();
      } else {
        await _handler.play();
      }
    } catch (_) {
      error = '音频加载失败，请稍后重试。';
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> toggleCurrent() => playing ? _handler.pause() : _handler.play();
  Future<void> stop() => _handler.stop();

  @override
  void dispose() {
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    super.dispose();
  }
}
