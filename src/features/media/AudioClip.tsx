import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import SidekickNative from '../../../modules/sidekick-native';
import { clipLabel } from './media-logic';

/** A saved speech clip: a small play / stop button, or a note once the audio is no longer kept. */
export function AudioClip({ path }: { path: string }) {
  const kept = useMemo(() => {
    try {
      return SidekickNative.fileExists(path);
    } catch {
      return false;
    }
  }, [path]);
  if (!kept) return <Text style={styles.gone}>Audio no longer kept</Text>;
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
    <Pressable
      onPress={toggle}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={status.playing ? 'Stop the recording' : 'Play the recording'}
    >
      <Text style={styles.text}>{clipLabel(status.playing, status.duration)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#e8eefc',
    marginTop: 4,
  },
  text: { color: '#2f6fed', fontSize: 13 },
  gone: { color: '#888', fontSize: 12, marginTop: 4 },
});
