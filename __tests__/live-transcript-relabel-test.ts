import { LiveTranscript } from '../src/engine/live-transcript';

it('relabels an unattributed line once its voice is known', () => {
  const t = new LiveTranscript();
  t.put({ at: 1, text: 'yes', speakerId: null, isOwner: false, saved: true });
  t.put({ at: 2, text: 'hi', speakerId: 4, isOwner: false, saved: true });
  t.relabel(1, 5);
  t.relabel(2, 5);
  expect(t.all.map((l) => l.speakerId)).toEqual([5, 4]);
});
