import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import SidekickNative from '../../../modules/sidekick-native';
import { type LiveLine, liveTranscript, ORPHAN_WAIT_MS } from '@/engine/live-transcript';
import { configureListening } from '@/engine/listen';
import { getSettings, onSettingsChange, updateSettings } from '@/engine/settings';
import { labelFor, type PersonRef } from '@/memory/people-logic';
import { ingestJournal, listSpeakers, nameSpeaker } from '@/memory/store';

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
      <Chip label="Instructions only" value={commandsOnly} onChange={setInstructionsOnly} />
      <Chip label="Show conversation" value={show} onChange={setShowing} />
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
    <View>
      {modes}
      <View style={local.box}>
        {commandsOnly && (
          <Text style={local.small}>
            Instructions only: nothing around you is transcribed; say &quot;Sidekick …&quot; or hold
            the mic.
          </Text>
        )}
        {renaming && (
          <View style={local.renameRow}>
            <TextInput
              style={local.input}
              value={renaming.name}
              onChangeText={(name) => setRenaming({ ...renaming, name })}
              onSubmitEditing={() => void saveName()}
              placeholder="Name"
              accessibilityLabel="Name"
              autoFocus
            />
            <Pressable onPress={() => void saveName()}>
              <Text style={local.link}>Save</Text>
            </Pressable>
            <Pressable onPress={() => setRenaming(null)}>
              <Text style={local.link}>Cancel</Text>
            </Pressable>
          </View>
        )}
        <ScrollView
          ref={scroll}
          style={local.scroll}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        >
          {lines.length === 0 && !commandsOnly && (
            <Text style={local.small}>Nothing heard yet.</Text>
          )}
          {lines.map((l) => {
            const p = l.speakerId != null ? people.get(l.speakerId) : undefined;
            const label = l.isOwner ? 'You' : labelFor(l.speakerId, people);
            const canRename = !l.isOwner && p && !p.isOwner;
            return (
              <View key={l.at} style={local.line}>
                <Pressable
                  disabled={!canRename}
                  onPress={() => p && setRenaming({ id: p.id, name: p.name ?? '' })}
                  accessibilityRole={canRename ? 'button' : undefined}
                  accessibilityLabel={canRename ? `Rename ${label}` : undefined}
                >
                  <Text style={[local.who, !l.saved && local.notSaved]}>
                    {label}
                    {p?.nameAuto ? ' (auto)' : ''}
                  </Text>
                </Pressable>
                <Text style={[local.text, !l.saved && local.notSaved]}>
                  {l.text}
                  {!l.saved ? '  · not saved' : ''}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

function Chip(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      onPress={() => props.onChange(!props.value)}
      style={[local.chip, props.value && local.chipOn]}
      accessibilityRole="switch"
      accessibilityState={{ checked: props.value }}
    >
      <Text style={[local.chipText, props.value && local.chipTextOn]}>{props.label}</Text>
    </Pressable>
  );
}

const local = StyleSheet.create({
  box: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#f6f6f8',
  },
  link: { fontSize: 14, color: '#2f6fed' },
  scroll: { maxHeight: 150, marginTop: 4 },
  line: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
  who: { fontSize: 14, fontWeight: '600', color: '#2f6fed' },
  text: { fontSize: 14, color: '#222', flexShrink: 1 },
  notSaved: { color: '#999' },
  small: { fontSize: 13, color: '#777' },
  modes: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 8 },
  chip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14, backgroundColor: '#eee' },
  chipOn: { backgroundColor: '#2f6fed' },
  chipText: { fontSize: 13, color: '#333' },
  chipTextOn: { color: 'white' },
  renameRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  input: {
    flex: 1,
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'white',
  },
});
