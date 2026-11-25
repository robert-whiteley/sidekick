import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { type Draft, drafts, holdDraft, runAction } from '@/engine/actions';
import type { ChatTheme as Theme } from './theme';

/** The editable text of a draft: the message, email body or event title. */
function mainText(d: Draft): string {
  switch (d.kind) {
    case 'message':
      return d.fields.text;
    case 'email':
      return d.fields.body;
    case 'event':
      return d.fields.title;
    case 'call':
      return '';
  }
}

function detail(d: Draft): string {
  switch (d.kind) {
    case 'email':
      return d.fields.subject ? `Subject: ${d.fields.subject}` : '';
    case 'event': {
      const s = new Date(d.fields.start);
      return d.fields.allDay
        ? s.toLocaleDateString()
        : `${s.toLocaleDateString()} ${s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${d.fields.location ? ` · ${d.fields.location}` : ''}`;
    }
    default:
      return '';
  }
}

const ACTION: Record<Draft['kind'], string> = {
  message: 'Send',
  email: 'Send',
  event: 'Add',
  call: 'Call',
};

const STATUS: Record<Draft['status'], string> = {
  draft: '',
  queued: 'Waiting for internet: sends by itself',
  sent: 'Done',
  failed: "Didn't work",
  cancelled: 'Cancelled',
};

/** A phone action waiting for the user's OK: nothing is sent until Send is tapped. */
export function DraftCard({ id, theme }: { id: string; theme: Theme }) {
  const [d, setD] = useState(() => drafts.get(id));
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => (d ? mainText(d) : ''));
  useEffect(() => drafts.subscribe(() => setD(drafts.get(id))), [id]);
  // The countdown ("Sending in 4 s") ticks while a draft is about to send by itself.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!d?.sendAt || d.status !== 'draft') return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [d?.sendAt, d?.status]);
  if (!d) return null;
  const left = d.sendAt && d.status === 'draft' ? Math.ceil((d.sendAt - now) / 1000) : 0;

  const save = () => {
    setEditing(false);
    if (d.kind === 'message') drafts.update(id, { ...d.fields, text });
    else if (d.kind === 'email') drafts.update(id, { ...d.fields, body: text });
    else if (d.kind === 'event') drafts.update(id, { ...d.fields, title: text });
  };
  const open = d.status === 'draft' || d.status === 'failed';
  const status =
    left > 0
      ? `${ACTION[d.kind] === 'Add' ? 'Adding' : ACTION[d.kind] === 'Call' ? 'Calling' : 'Sending'} in ${left} s`
      : [STATUS[d.status], d.note].filter(Boolean).join(': ');

  return (
    <View style={[styles.card, { borderColor: theme.faint }]}>
      <Text style={[styles.title, { color: theme.text }]}>{d.title}</Text>
      {detail(d) ? <Text style={{ color: theme.faint }}>{detail(d)}</Text> : null}
      {d.kind !== 'call' &&
        (editing ? (
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            style={[styles.body, styles.input, { color: theme.text, borderColor: theme.faint }]}
          />
        ) : (
          <Text style={[styles.body, { color: theme.text }]}>{mainText(d)}</Text>
        ))}
      {status ? <Text style={{ color: theme.faint }}>{status}</Text> : null}
      {open && (
        <View style={styles.row}>
          {editing ? (
            <Btn label="Done" onPress={save} theme={theme} />
          ) : (
            <>
              <Btn
                label={ACTION[d.kind]}
                primary
                onPress={() => void runAction(id)}
                theme={theme}
              />
              {d.kind !== 'call' && (
                <Btn
                  label="Edit"
                  onPress={() => {
                    holdDraft(id);
                    setEditing(true);
                  }}
                  theme={theme}
                />
              )}
              <Btn label="Cancel" onPress={() => drafts.cancel(id)} theme={theme} />
            </>
          )}
        </View>
      )}
    </View>
  );
}

function Btn(p: { label: string; onPress: () => void; primary?: boolean; theme: Theme }) {
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="button"
      style={[styles.btn, p.primary && { backgroundColor: '#2f6fed' }]}
    >
      <Text style={{ color: p.primary ? '#fff' : p.theme.text, fontWeight: '600' }}>{p.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 6, marginVertical: 6 },
  title: { fontWeight: '600', fontSize: 15 },
  body: { fontSize: 16 },
  input: { borderWidth: 1, borderRadius: 8, padding: 8 },
  row: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18 },
});
