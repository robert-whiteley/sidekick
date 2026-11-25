import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import SidekickNative from '../../../modules/sidekick-native';
import { clipLabel } from './media-logic';
import { AppText, Button, space } from '@/ui';

/** A saved speech clip: a small play / stop button, or a note once the audio is no longer kept. */
export function AudioClip({ path }: { path: string }) {
  const kept = useMemo(() => {
    try {
      return SidekickNative.fileExists(path);
    } catch {
      return false;
    }
  }, [path]);
  if (!kept)
    return (
      <AppText variant="caption" tone="muted" style={styles.gone}>
        Audio no longer kept
      </AppText>
    );
  return <Player path={path} />;
}

function Player({ path }: { path: string }) {
  const player = useAudioPlayer({ uri: `file://${path}` });
  const status = useAudioPlayerStatus(player);
  const toggle = () => {
    if (status.playing) return player.pause();
    if (status.didJustFinish || status.currentTime >= status.duration) void player.seekTo(0);
    player.play();
  };
  return (
    <Button
      variant="tonal"
      title={clipLabel(status.playing, status.duration)}
      onPress={toggle}
      style={styles.button}
      accessibilityLabel={status.playing ? 'Stop the recording' : 'Play the recording'}
    />
  );
}

const styles = StyleSheet.create({
  button: { alignSelf: 'flex-start', marginTop: space.xs },
  gone: { marginTop: space.xs },
});
