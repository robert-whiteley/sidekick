import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  cancelTurn,
  dismissNotice,
  downloadStt,
  finishTurn,
  interpreter,
  type InterpretState,
  listen,
  openVoiceDownloads,
  recheckVoices,
  repeat,
  sttBytes,
  stopInterpreter,
} from '@/engine/interpreter';
import type { InterpretSide, InterpretTurn } from '@/engine/interpreter-logic';
import {
  AppText,
  Button,
  IconButton,
  makeStyles,
  ProgressBar,
  space,
  TextButton,
  useColors,
} from '@/ui';

/**
 * The interpreter: the phone lies between two people. The top half faces the other person
 * (turned upside down, in their language), the bottom half faces the owner. Each half has its
 * own mic; what one side says appears, translated, on the other side and is spoken there.
 */
export function InterpreterScreen() {
  const [st, setSt] = useState<InterpretState>(interpreter.get());
  const insets = useSafeAreaInsets();
  const s = useStyles();
  useEffect(() => interpreter.subscribe(setSt), []);

  // The model ended it ("that's enough interpreting") or nothing is running: leave.
  useEffect(() => {
    if (st.ended || !st.active) {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    }
  }, [st.ended, st.active]);

  // Coming back from the phone's voice settings: look again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (a) => {
      if (a === 'active') void recheckVoices();
    });
    return () => sub.remove();
  }, []);

  // Leaving the screen ends the session (nothing is kept).
  useEffect(
    () => () => {
      cancelTurn();
      stopInterpreter();
    },
    [],
  );

  return (
    <View style={[s.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.half, styles.flipped]}>
        <Side st={st} side="them" />
      </View>
      <View style={s.middle}>
        <AppText variant="label" tone="muted" style={styles.pair}>
          English ⇄ {st.theirs.name}
        </AppText>
        <Button title="Done" variant="text" onPress={() => stopInterpreter()} />
      </View>
      <Status st={st} />
      <View style={styles.half}>
        <Side st={st} side="me" />
      </View>
    </View>
  );
}

/** One person's half: what the other one said (translated), their own last line, their mic. */
function Side({ st, side }: { st: InterpretState; side: InterpretSide }) {
  const c = useColors();
  const s = useStyles();
  const other: InterpretSide = side === 'me' ? 'them' : 'me';
  const lang = side === 'me' ? st.mine : st.theirs;
  const forMe = last(st.turns, other);
  const mine = last(st.turns, side);
  const live = st.busy === 'translating' && last(st.turns)?.side === other ? st.live : null;
  const listening = st.listening === side;
  const canHear = side === 'me' || st.stt === 'ready';
  return (
    <View style={styles.side}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {live || forMe?.said ? (
          <AppText
            variant="headline"
            onPress={forMe && !live ? () => repeat(forMe) : undefined}
            accessibilityHint={side === 'me' ? 'Says it again' : undefined}
          >
            {live ?? forMe?.said}
          </AppText>
        ) : null}
        {mine ? (
          <AppText variant="bodySmall" tone="muted" style={styles.own}>
            {mine.heard}
          </AppText>
        ) : null}
      </ScrollView>
      <View style={styles.micRow}>
        <AppText variant="titleSmall" tone={listening ? 'primary' : 'muted'}>
          {lang.own}
        </AppText>
        <IconButton
          name="mic"
          size={40}
          selected={listening}
          color={listening ? c.recording : c.primary}
          disabled={!canHear || (!!st.busy && !listening) || (!!st.listening && !listening)}
          accessibilityLabel={
            listening
              ? 'Done speaking'
              : side === 'me'
                ? 'Speak English'
                : `Speak ${st.theirs.name}`
          }
          onPress={() => (listening ? void finishTurn() : void listen(side))}
          style={s.mic}
        />
      </View>
    </View>
  );
}

/** The owner's notices: downloads, missing voices, what is happening. */
function Status({ st }: { st: InterpretState }) {
  const lines: React.ReactNode[] = [];
  const mb = Math.round(sttBytes(st.theirs) / 1e6);
  if (st.stt === 'download')
    lines.push(
      <View key="dl" style={styles.notice}>
        <AppText variant="bodySmall">
          To hear {st.theirs.name}, Sidekick needs a {mb} MB download once (then it works offline).
          You can still speak; they can reply after it is in.
        </AppText>
        <TextButton title="Download" onPress={() => void downloadStt(true)} />
      </View>,
    );
  if (st.stt === 'downloading')
    lines.push(
      <View key="dling" style={styles.notice}>
        <AppText variant="bodySmall" tone="muted">
          Getting {st.theirs.name} speech ({mb} MB){st.sttProgress ? `: ${st.sttProgress}` : '…'}
        </AppText>
        <ProgressBar fraction={st.sttFraction} />
      </View>,
    );
  if (st.stt === 'unavailable')
    lines.push(
      <AppText key="un" variant="bodySmall" tone="warning" style={styles.notice}>
        This iPhone can&apos;t hear {st.theirs.name} offline. You can still speak; your words are
        shown and spoken in {st.theirs.name}.
      </AppText>,
    );
  for (const side of ['them', 'me'] as const) {
    const v = st.voices[side];
    const name = side === 'me' ? st.mine.name : st.theirs.name;
    if (v === 'missing' || v === 'download')
      lines.push(
        <View key={`v${side}`} style={styles.notice}>
          <AppText variant="bodySmall">
            {v === 'download'
              ? `The ${name} voice isn't downloaded, so it can't be spoken offline. Translations are still shown.`
              : `This phone has no ${name} voice, so translations are shown but not spoken.`}
          </AppText>
          {openVoiceDownloadsAvailable() ? (
            <TextButton title="Get voice" onPress={() => openVoiceDownloads()} />
          ) : (
            <AppText variant="caption" tone="muted">
              Add one in Settings › Accessibility › Spoken Content › Voices.
            </AppText>
          )}
        </View>,
      );
  }
  if (st.busy)
    lines.push(
      <AppText key="busy" variant="caption" tone="muted" style={styles.notice}>
        {st.busy === 'hearing' ? 'Listening back…' : 'Translating…'}
      </AppText>,
    );
  if (st.notice)
    lines.push(
      <View key="n" style={styles.notice}>
        <AppText variant="bodySmall" tone="warning">
          {st.notice}
        </AppText>
        <TextButton title="OK" onPress={dismissNotice} />
      </View>,
    );
  return lines.length ? <View style={styles.status}>{lines}</View> : null;
}

const openVoiceDownloadsAvailable = () => process.env.EXPO_OS === 'android';

function last(turns: InterpretTurn[], side?: InterpretSide): InterpretTurn | undefined {
  for (let i = turns.length - 1; i >= 0; i--) if (!side || turns[i].side === side) return turns[i];
  return undefined;
}

const useStyles = makeStyles((c) => ({
  page: { flex: 1, backgroundColor: c.bg },
  middle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  mic: { backgroundColor: c.primaryContainer, borderRadius: 999 },
}));

const styles = StyleSheet.create({
  half: { flex: 1 },
  flipped: { transform: [{ rotate: '180deg' }] },
  side: { flex: 1, padding: space.lg, gap: space.md },
  scroll: { flex: 1 },
  scrollContent: { gap: space.sm },
  own: { marginTop: space.sm },
  micRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pair: { flex: 1 },
  status: { paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm },
  notice: { gap: space.xs },
});
