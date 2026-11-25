import { useEffect, useRef, useState } from 'react';
import { ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';

import SidekickNative from '../../../modules/sidekick-native';
import { type LiveLine, liveTranscript, ORPHAN_WAIT_MS } from '@/engine/live-transcript';
import { configureListening } from '@/engine/listen';
import { getSettings, onSettingsChange, updateSettings } from '@/engine/settings';
import { labelFor, type PersonRef } from '@/memory/people-logic';
import { inferNamesIfIdle } from '@/engine/name-inference';
import { ingestJournal, listSpeakers, nameSpeaker } from '@/memory/store';
import { AppText, makeStyles, radius, space, Tappable, TextButton, TextField, Toggle } from '@/ui';

type People = Map<number, PersonRef & { nameAuto: boolean }>;

async function loadPeople(): Promise<People> {
  return new Map((await listSpeakers()).map((p) => [p.id, p]));
}

/**
 * While listening: each phrase as soon as it is transcribed, labelled with who said it. Lines from
 * voices that haven't agreed (consent mode) are greyed and marked "not saved": they are shown
 * because they are on screen only, never stored. Tap a name to rename that person everywhere.
 */
export function LiveConversation({ listening }: { listening: boolean }) {
  const st = useStyles();
  const [lines, setLines] = useState<LiveLine[]>(liveTranscript.all);
  const [people, setPeople] = useState<People>(new Map());
  const [show, setShow] = useState(getSettings().showConversation);
  const [commandsOnly, setCommandsOnly] = useState(getSettings().instructionsOnly);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);

  useEffect(
    () =>
      onSettingsChange((s) => {
        setShow(s.showConversation);
        setCommandsOnly(s.instructionsOnly);
      }),
    [],
  );

  useEffect(() => {
    const unsub = liveTranscript.subscribe((l) => {
      setLines(l);
      loadPeople()
        .then(setPeople)
        .catch(() => {});
    });
    // Each transcribed phrase: move it into memory now (assigns the voice), so it shows at once.
    const sub = SidekickNative.addListener('onTranscript', (e) => {
      void ingestJournal()
        // Who is who, worked out live from what has just been said.
        .then(() => inferNamesIfIdle())
        .catch((err) => console.log(`[live] ingest failed: ${String(err)}`))
        .finally(() => {
          // Not journaled (e.g. "Remember conversations" off): show it, with no voice, not saved.
          setTimeout(() => {
            if (!liveTranscript.has(e.at))
              liveTranscript.put({
                at: e.at,
                text: e.text,
                speakerId: null,
                isOwner: e.kind === 'question',
                saved: false,
              });
          }, ORPHAN_WAIT_MS);
        });
    });
    return () => {
      unsub();
      sub.remove();
    };
  }, []);

  if (!listening && !lines.length) return null;
  const setShowing = (v: boolean) => updateSettings({ showConversation: v });
  const setInstructionsOnly = (v: boolean) => {
    updateSettings({ instructionsOnly: v });
    configureListening();
  };
  // Two separate switches: what is heard (instructions only) vs what is shown (conversation).
  const modes = (
    <View style={local.modes}>
      <MiniSwitch label="Instructions only" value={commandsOnly} onChange={setInstructionsOnly} />
      <MiniSwitch label="Show conversation" value={show} onChange={setShowing} />
    </View>
  );

  if (!show) return modes;

  const saveName = async () => {
    if (!renaming) return;
    await nameSpeaker(renaming.id, renaming.name);
    setRenaming(null);
    setPeople(await loadPeople());
  };

  return (
    <View style={local.shrink}>
      {modes}
      <View style={[st.box, local.shrink]}>
        {commandsOnly && (
          <AppText variant="caption" tone="muted">
            Instructions only: nothing around you is transcribed; say &quot;Sidekick …&quot; or hold
            the mic.
          </AppText>
        )}
        {renaming && (
          <View style={local.renameRow}>
            <TextField
              containerStyle={local.flex}
              value={renaming.name}
              onChangeText={(name) => setRenaming({ ...renaming, name })}
              onSubmitEditing={() => void saveName()}
              placeholder="Name"
              accessibilityLabel="Name"
              autoFocus
            />
            <TextButton title="Save" onPress={() => void saveName()} />
            <TextButton title="Cancel" onPress={() => setRenaming(null)} />
          </View>
        )}
        <ScrollView
          ref={scroll}
          style={local.scroll}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        >
          {lines.length === 0 && !commandsOnly && (
            <AppText variant="caption" tone="muted">
              Nothing heard yet.
            </AppText>
          )}
          {lines.map((l) => {
            const p = l.speakerId != null ? people.get(l.speakerId) : undefined;
            const label = l.isOwner ? 'You' : labelFor(l.speakerId, people);
            const canRename = !l.isOwner && p && !p.isOwner;
            return (
              <View key={l.at} style={local.line}>
                <Tappable
                  feedback="dim"
                  hitSlop={4}
                  disabled={!canRename}
                  onPress={() => p && setRenaming({ id: p.id, name: p.name ?? '' })}
                  accessibilityRole={canRename ? 'button' : undefined}
                  accessibilityLabel={canRename ? `Rename ${label}` : undefined}
                >
                  <AppText variant="label" tone={l.saved ? 'primary' : 'faint'}>
                    {label}
                    {p?.nameAuto ? ' (auto)' : ''}
                  </AppText>
                </Tappable>
                <AppText
                  variant="bodySmall"
                  tone={l.saved ? 'default' : 'faint'}
                  style={local.text}
                >
                  {l.text}
                  {!l.saved ? '  · not saved' : ''}
                </AppText>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

/** A compact labelled switch for the two live modes above the transcript. */
function MiniSwitch(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={local.mini}>
      <AppText variant="bodySmall" tone="muted">
        {props.label}
      </AppText>
      <Toggle value={props.value} onChange={props.onChange} accessibilityLabel={props.label} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  box: {
    marginHorizontal: space.lg,
    marginTop: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: c.surface,
  },
}));

const local = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { maxHeight: 150, flexShrink: 1, marginTop: space.xs },
  shrink: { flexShrink: 1, minHeight: 0 },
  line: { flexDirection: 'row', gap: space.sm, paddingVertical: space.xxs },
  text: { flexShrink: 1 },
  modes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space.lg,
    rowGap: space.xs,
    marginHorizontal: space.lg,
    marginTop: space.sm,
  },
  mini: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  renameRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center', marginTop: space.xs },
});
