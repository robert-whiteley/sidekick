import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { type Draft, drafts, holdDraft, runAction } from '@/engine/actions';
import { sendsAtText } from '@/integrations/schedule-logic';
import type { ChatTheme as Theme } from './theme';
import { AppText, Button, radius, space, TextField } from '@/ui';

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
  const scheduled =
    d.scheduledAt && d.status === 'draft' ? sendsAtText(d.scheduledAt, new Date(now)) : '';
  const status =
    left > 0
      ? `${d.scheduledAt ? 'Scheduling' : ACTION[d.kind] === 'Add' ? 'Adding' : ACTION[d.kind] === 'Call' ? 'Calling' : 'Sending'} in ${left} s`
      : d.status === 'queued' && d.scheduledAt
        ? (d.note ?? '')
        : [STATUS[d.status], d.note].filter(Boolean).join(': ');

  return (
    <View style={[styles.card, { borderColor: theme.faint }]}>
      <AppText variant="bodyStrong" style={{ color: theme.text }}>
        {d.title}
      </AppText>
      {detail(d) ? (
        <AppText variant="bodySmall" style={{ color: theme.faint }}>
          {detail(d)}
        </AppText>
      ) : null}
      {d.kind !== 'call' &&
        (editing ? (
          <TextField
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            accessibilityLabel="Draft text"
          />
        ) : (
          <AppText style={{ color: theme.text }}>{mainText(d)}</AppText>
        ))}
      {scheduled ? (
        <AppText variant="bodySmall" style={{ color: theme.faint }}>
          {scheduled}
        </AppText>
      ) : null}
      {status ? (
        <AppText variant="bodySmall" style={{ color: theme.faint }}>
          {status}
        </AppText>
      ) : null}
      {d.status === 'queued' && d.scheduledAt ? (
        <View style={styles.row}>
          <Btn label="Cancel" onPress={() => drafts.cancel(id)} theme={theme} />
        </View>
      ) : null}
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
  return <Button title={p.label} onPress={p.onPress} variant={p.primary ? 'filled' : 'text'} />;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.xs,
    marginVertical: space.xs,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
});
