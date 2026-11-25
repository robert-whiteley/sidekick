import { useEventListener } from 'expo';
import { Album, Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { framesNear, videoSegments } from '@/memory/frames';
import {
  awayFromMoment,
  cleanAlbum,
  clock,
  fractionOf,
  nearestIndex,
  spotAt,
  spotAtFraction,
  step,
  suggestFolder,
  timeOf,
  type Segment,
  type Spot,
} from './media-logic';
import { AudioClip } from './AudioClip';
import { keptFile } from '@/memory/media-files';

export type MomentPlayerProps = {
  /** Wall-clock time (ms) of the found moment: the player opens here. */
  momentAt: number;
  /** 'audio': a saved speech clip (path), played with a small button. */
  kind: 'video' | 'photo' | 'audio';
  /** The stored still for the moment (shown when no video is kept). */
  path?: string;
  /** What the user asked about ("red car"): picks the Save folder. */
  topic?: string;
};

/** How much stored video either side of the moment the scrub bar covers. */
const RANGE_MS = 60 * 60_000;
const uri = (p: string) => (p.startsWith('file://') || p.includes('://') ? p : `file://${p}`);

/**
 * The actual stored moment in the chat: video opened at that moment (scrub, tap left/right for
 * ±5 s, free scroll with "Back to moment"), or the photo with its neighbouring frames (swipe,
 * pinch to zoom). Tap to open full screen. Share and Save (folder suggested from the question).
 */
export function MomentPlayer(props: MomentPlayerProps) {
  if (props.kind === 'audio') return props.path ? <AudioClip path={props.path} /> : null;
  return <VisualMoment {...props} kind={props.kind} />;
}

function VisualMoment(props: MomentPlayerProps & { kind: 'video' | 'photo' }) {
  const [full, setFull] = useState(false);
  const body = (isFull: boolean) =>
    props.kind === 'video' ? (
      <VideoMoment {...props} full={isFull} onExpand={() => setFull(true)} />
    ) : (
      <PhotoMoment {...props} full={isFull} onExpand={() => setFull(true)} />
    );
  return (
    <>
      {body(false)}
      <Modal visible={full} animationType="fade" onRequestClose={() => setFull(false)}>
        <View style={styles.fullScreen}>
          {full && body(true)}
          <Pressable
            style={styles.close}
            onPress={() => setFull(false)}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

/** The stored segments played as one video: loads the right file, then seeks inside it. */
class Timeline {
  loaded = -1;
  constructor(
    private player: VideoPlayer,
    private segs: Segment[],
  ) {
    player.timeUpdateEventInterval = 0.25;
  }
  async go(s: Spot, play = false) {
    if (this.loaded !== s.index) {
      this.loaded = s.index;
      await this.player.replaceAsync({ uri: uri(this.segs[s.index].path) });
    }
    this.player.currentTime = s.offsetSec;
    if (play) this.player.play();
  }
  toggle(playing: boolean) {
    if (playing) this.player.pause();
    else this.player.play();
  }
}

type Inner = MomentPlayerProps & { full: boolean; onExpand: () => void };

/** Loads the stored video around the moment, then shows the timeline player. */
function VideoMoment(props: Inner) {
  const { momentAt, path, full, onExpand } = props;
  const [segs, setSegs] = useState<Segment[] | null>(null);
  useEffect(() => {
    let live = true;
    void videoSegments(momentAt - RANGE_MS, momentAt + RANGE_MS).then((s) => live && setSegs(s));
    return () => {
      live = false;
    };
  }, [momentAt]);
  if (!segs) {
    return path ? <ZoomImage path={path} full={full} onTap={onExpand} /> : null;
  }
  return <VideoTimeline {...props} segs={segs} />;
}

function VideoTimeline({
  momentAt,
  path,
  topic,
  full,
  onExpand,
  segs,
}: Inner & { segs: Segment[] }) {
  const [spot, setSpot] = useState<Spot | null>(() => spotAt(segs, momentAt));
  const [playing, setPlaying] = useState(false);
  const player = useVideoPlayer(null);
  const ctl = useMemo(() => new Timeline(player, segs), [player, segs]);

  const moveTo = (s: Spot, play: boolean) => {
    setSpot(s);
    void ctl.go(s, play);
  };

  useEffect(() => {
    const s = spotAt(segs, momentAt);
    if (s) void ctl.go(s);
  }, [ctl, segs, momentAt]);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (ctl.loaded >= 0) setSpot({ index: ctl.loaded, offsetSec: currentTime });
  });
  // One segment ends: carry on with the next, so the timeline plays as one video.
  useEventListener(player, 'playToEnd', () => {
    const next = ctl.loaded + 1;
    if (next < segs.length) moveTo({ index: next, offsetSec: 0 }, true);
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => setPlaying(isPlaying));

  if (!segs.length || !spot) {
    return (
      <View>
        {path ? <ZoomImage path={path} full={full} onTap={onExpand} /> : null}
        <Text style={styles.note}>No clip: found the moment but its video isn&apos;t kept.</Text>
        {path ? <SaveShare file={path} kind="photo" topic={topic} /> : null}
      </View>
    );
  }

  const nudge = (sec: number) => moveTo(step(segs, spot, sec), playing);
  return (
    <View style={full ? styles.fullBody : styles.card}>
      <View style={full ? styles.fullMedia : styles.media}>
        <VideoView
          player={player}
          nativeControls={false}
          contentFit="contain"
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.taps}>
          <Pressable
            style={styles.tap}
            onPress={() => nudge(-5)}
            accessibilityLabel="Back 5 seconds"
          />
          <Pressable
            style={styles.tap}
            onPress={() => ctl.toggle(playing)}
            onLongPress={onExpand}
            accessibilityLabel={playing ? 'Pause' : 'Play'}
          >
            {!playing && <Text style={styles.play}>▶</Text>}
          </Pressable>
          <Pressable
            style={styles.tap}
            onPress={() => nudge(5)}
            accessibilityLabel="Forward 5 seconds"
          />
        </View>
      </View>
      <ScrubBar
        fraction={fractionOf(segs, spot)}
        moment={fractionOf(segs, spotAt(segs, momentAt)!)}
        onSeek={(f) => {
          const s = spotAtFraction(segs, f);
          if (s) moveTo(s, playing);
        }}
      />
      <View style={styles.row}>
        <Text style={styles.time}>{clock(timeOf(segs, spot))}</Text>
        {awayFromMoment(segs, spot, momentAt) && (
          <Pressable
            style={styles.chip}
            onPress={() => moveTo(spotAt(segs, momentAt)!, playing)}
            accessibilityRole="button"
          >
            <Text style={styles.chipText}>Back to moment</Text>
          </Pressable>
        )}
        {!full && (
          <Pressable style={styles.chip} onPress={onExpand} accessibilityRole="button">
            <Text style={styles.chipText}>Full screen</Text>
          </Pressable>
        )}
      </View>
      <SaveShare file={segs[spot.index].path} kind="video" topic={topic} />
    </View>
  );
}

function ScrubBar(p: { fraction: number; moment: number; onSeek: (f: number) => void }) {
  const [width, setWidth] = useState(1);
  const at = (e: GestureResponderEvent) => p.onSeek(e.nativeEvent.locationX / width);
  return (
    <View
      style={styles.scrub}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width || 1)}
      accessibilityRole="adjustable"
      accessibilityLabel="Video position"
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={at}
      onResponderMove={at}
    >
      <View pointerEvents="none" style={styles.track} />
      <View pointerEvents="none" style={[styles.done, { width: `${p.fraction * 100}%` }]} />
      <View pointerEvents="none" style={[styles.mark, { left: `${p.moment * 100}%` }]} />
      <View pointerEvents="none" style={[styles.knob, { left: `${p.fraction * 100}%` }]} />
    </View>
  );
}

function PhotoMoment({ momentAt, path, topic, full, onExpand }: Inner) {
  const { width } = useWindowDimensions();
  const still = keptFile(path);
  const [frames, setFrames] = useState<{ at: number; path: string }[]>(
    still ? [{ at: momentAt, path: still }] : [],
  );
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<{ at: number; path: string }>>(null);
  useEffect(() => {
    let live = true;
    framesNear(momentAt, 10)
      .then((f) => {
        if (!live || !f.length) return;
        setFrames(f);
        setIndex(
          nearestIndex(
            f.map((x) => x.at),
            momentAt,
          ),
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [momentAt]);
  const w = full ? width : Math.min(width - 48, 320);
  if (!frames.length)
    return path ? <Text style={styles.goneText}>Photo no longer kept</Text> : null;
  const current = frames[Math.min(index, frames.length - 1)];
  return (
    <View style={full ? styles.fullBody : styles.card}>
      <FlatList
        ref={list}
        data={frames}
        horizontal
        pagingEnabled
        initialScrollIndex={index}
        key={`${frames.length}-${full}`}
        getItemLayout={(_, i) => ({ length: w, offset: w * i, index: i })}
        keyExtractor={(f) => String(f.at)}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / w))}
        renderItem={({ item }) => (
          <View style={{ width: w }}>
            <ZoomImage path={item.path} full={full} onTap={onExpand} />
          </View>
        )}
      />
      <View style={styles.row}>
        <Text style={styles.time}>{clock(current.at)}</Text>
        {current.at !== momentAt && Math.abs(current.at - momentAt) > 500 && (
          <Pressable
            style={styles.chip}
            onPress={() => {
              const i = nearestIndex(
                frames.map((x) => x.at),
                momentAt,
              );
              setIndex(i);
              list.current?.scrollToIndex({ index: i, animated: true });
            }}
            accessibilityRole="button"
          >
            <Text style={styles.chipText}>Back to moment</Text>
          </Pressable>
        )}
      </View>
      <SaveShare file={current.path} kind="photo" topic={topic} />
    </View>
  );
}

/** Pinch / drag state between touch events (kept out of React state: it changes every move). */
class Pinch {
  dist = 0;
  base = { scale: 1, x: 0, y: 0 };
  moved = false;
  start() {
    this.dist = 0;
    this.moved = false;
  }
  move(e: GestureResponderEvent, dx: number, dy: number, now: Zoom): Zoom | null {
    const touches = e.nativeEvent.touches;
    if (touches.length === 2) {
      const d = Math.hypot(
        touches[0].pageX - touches[1].pageX,
        touches[0].pageY - touches[1].pageY,
      );
      if (!this.dist) this.dist = d;
      this.moved = true;
      return { ...now, scale: Math.min(5, Math.max(1, (this.base.scale * d) / this.dist)) };
    }
    if (this.base.scale > 1 || now.scale > 1) {
      this.moved = true;
      return { ...now, x: this.base.x + dx, y: this.base.y + dy };
    }
    return null;
  }
  end(now: Zoom): Zoom {
    const z = now.scale > 1 ? now : { scale: 1, x: 0, y: 0 };
    this.base = z;
    return z;
  }
}
type Zoom = { scale: number; x: number; y: number };

/** A photo with pinch-to-zoom and drag when zoomed (full screen); tap opens full screen. */
function ZoomImage({ path, full, onTap }: { path: string; full: boolean; onTap: () => void }) {
  const [t, setT] = useState<Zoom>({ scale: 1, x: 0, y: 0 });
  const [pinch] = useState(() => new Pinch());
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const zoomHandlers = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: (e: GestureResponderEvent) =>
      e.nativeEvent.touches.length === 2 || t.scale > 1,
    onResponderGrant: (e: GestureResponderEvent) => {
      pinch.start();
      setOrigin({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const z = pinch.move(e, e.nativeEvent.pageX - origin.x, e.nativeEvent.pageY - origin.y, t);
      if (z) setT(z);
    },
    onResponderRelease: () => setT(pinch.end(t)),
  };
  return (
    <View style={full ? styles.fullMedia : styles.media} {...(full ? zoomHandlers : {})}>
      <Pressable style={StyleSheet.absoluteFill} onPress={full ? undefined : onTap} disabled={full}>
        <Image
          source={{ uri: uri(path) }}
          resizeMode="contain"
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ translateX: t.x }, { translateY: t.y }, { scale: t.scale }] },
          ]}
        />
      </Pressable>
    </View>
  );
}

/** Share, and Save to a suggested folder (one tap), or another folder the user types. */
function SaveShare({
  file,
  kind,
  topic,
}: {
  file: string;
  kind: 'video' | 'photo';
  topic?: string;
}) {
  const suggestion = suggestFolder(topic, kind);
  const [editing, setEditing] = useState(false);
  const [album, setAlbum] = useState(suggestion.album);
  const [status, setStatus] = useState<string | null>(null);
  const save = async (name: string) => {
    setEditing(false);
    try {
      const p = await requestPermissionsAsync(true, [kind]);
      if (!p.granted) return setStatus('Saving needs access to your photos');
      const clean = cleanAlbum(name);
      try {
        await Album.create(clean, [uri(file)], false);
      } catch {
        // The phone's media store refused the folder: save to the main gallery instead.
        await Asset.create(uri(file));
      }
      setStatus(`Saved to ${clean}`);
    } catch (e) {
      setStatus(`Couldn't save: ${String(e).slice(0, 80)}`);
    }
  };
  return (
    <View>
      <View style={styles.row}>
        <Pressable
          style={styles.chip}
          onPress={() => void Sharing.shareAsync(uri(file)).catch(() => {})}
          accessibilityRole="button"
        >
          <Text style={styles.chipText}>Share</Text>
        </Pressable>
        <Pressable style={styles.chip} onPress={() => void save(album)} accessibilityRole="button">
          <Text style={styles.chipText}>
            Save to {album === suggestion.album ? suggestion.label : album}
          </Text>
        </Pressable>
        <Pressable
          style={styles.chip}
          onPress={() => setEditing((x) => !x)}
          accessibilityRole="button"
        >
          <Text style={styles.chipText}>Other folder</Text>
        </Pressable>
      </View>
      {editing && (
        <TextInput
          style={styles.input}
          value={album}
          onChangeText={setAlbum}
          autoFocus
          placeholder="Sidekick/Trips"
          placeholderTextColor="#888"
          onSubmitEditing={() => void save(album)}
          returnKeyType="done"
        />
      )}
      {status && <Text style={styles.note}>{status}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  goneText: { color: '#888', fontSize: 12, marginTop: 4 },
  card: { width: 320, maxWidth: '100%', gap: 6 },
  fullBody: { flex: 1, justifyContent: 'center', gap: 8, paddingBottom: 24 },
  fullScreen: { flex: 1, backgroundColor: '#000' },
  media: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  fullMedia: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  taps: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' },
  tap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  play: { color: '#fff', fontSize: 34, opacity: 0.85 },
  scrub: { height: 28, justifyContent: 'center', marginHorizontal: 8 },
  track: { height: 4, borderRadius: 2, backgroundColor: '#8886' },
  done: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: '#e33' },
  mark: { position: 'absolute', width: 3, height: 12, marginLeft: -1, backgroundColor: '#fc3' },
  knob: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: -7,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#0003',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  time: { color: '#888', fontVariant: ['tabular-nums'], fontSize: 13 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: '#8882' },
  chipText: { color: '#888', fontSize: 13 },
  note: { color: '#888', fontSize: 13, padding: 4 },
  input: {
    margin: 4,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#8886',
    color: '#888',
  },
  close: {
    position: 'absolute',
    top: 40,
    right: 16,
    padding: 10,
    borderRadius: 20,
    backgroundColor: '#0008',
  },
  closeText: { color: '#fff', fontSize: 18 },
});
