import { lineFate } from '../src/memory/consent';
import { LiveTranscript } from '../src/engine/live-transcript';
import { jsPlan } from '../src/engine/memory-pressure';
import {
  downloadFits,
  FLOOR_BYTES,
  floorBytes,
  mayWrite,
  spaceLevel,
  spaceMessage,
  spaceStateMessage,
} from '../src/engine/storage-guard';
import { FORGET_MS, isUnsavedId, UnsavedVoices } from '../src/memory/unsaved-voices';
import { chooseSpeaker, matchSpeaker, RECENT_MS, type Speaker } from '../src/memory/voices';

jest.mock('../modules/sidekick-native', () => ({ __esModule: true, default: {} }));

/** A unit vector whose cosine with [1, 0] is [sim]. */
const at = (sim: number) => [sim, Math.sqrt(1 - sim * sim)];
const NOW = 10_000_000;

describe('voice matching: the conversation going on counts', () => {
  const old: Speaker = { id: 1, centroid: at(0.6), count: 30, isOwner: false, lastAt: 0 };
  const young: Speaker = {
    id: 2,
    centroid: at(0.53),
    count: 2,
    isOwner: false,
    lastAt: NOW - 60_000,
  };
  const voice = [1, 0];

  it('keeps a voice that just started in this conversation over an older one that sounds alike', () => {
    expect(matchSpeaker(voice, [old, young], undefined, NOW)?.id).toBe(2);
  });
  it('without a time (as before) the highest score wins, and the young voice is below threshold', () => {
    expect(matchSpeaker(voice, [old, young])?.id).toBe(1);
    expect(matchSpeaker(voice, [young])).toBeNull();
  });
  it('an older voice that scores clearly more still wins', () => {
    const clear = { ...old, centroid: at(0.75) };
    expect(matchSpeaker(voice, [clear, young], undefined, NOW)?.id).toBe(1);
  });
  it('only while the voice is young and was heard recently', () => {
    expect(matchSpeaker(voice, [old, { ...young, count: 10 }], undefined, NOW)?.id).toBe(1);
    const stale = { ...young, lastAt: NOW - RECENT_MS - 1 };
    expect(matchSpeaker(voice, [old, stale], undefined, NOW)?.id).toBe(1);
  });
  it('never loosens the match for the owner', () => {
    const owner = { ...young, isOwner: true };
    expect(matchSpeaker(voice, [owner], undefined, NOW)).toBeNull();
  });
  it('chooseSpeaker passes the time through', () => {
    const c = chooseSpeaker(voice, false, 3000, false, [old, young], undefined, NOW);
    expect(c.kind === 'join' && c.speaker.id).toBe(2);
  });
  it('a different voice is still a new person', () => {
    expect(matchSpeaker([0.1, -0.995], [old, young], undefined, NOW)).toBeNull();
  });
});

describe('consent mode: a voice is stored only with a kept line', () => {
  const base = {
    consentMode: true,
    isOwner: false,
    hasVoice: true,
    consented: false,
    agrees: false,
  };
  it('does not keep (or store) a voice that has not agreed', () => {
    expect(lineFate(base)).toEqual({ keep: false, consentNow: false });
  });
  it('keeps the yes and records consent', () => {
    expect(lineFate({ ...base, agrees: true })).toEqual({ keep: true, consentNow: true });
  });
  it('a yes with no voice to attach it to does not count', () => {
    expect(lineFate({ ...base, hasVoice: false, agrees: true }).keep).toBe(false);
  });
  it('keeps the owner and voices that agreed, and everything with consent mode off', () => {
    expect(lineFate({ ...base, isOwner: true }).keep).toBe(true);
    expect(lineFate({ ...base, consented: true })).toEqual({ keep: true, consentNow: false });
    expect(lineFate({ ...base, consentMode: false }).keep).toBe(true);
  });
});

describe('UnsavedVoices', () => {
  it('tells voices apart in memory with negative ids and their own labels', () => {
    const u = new UnsavedVoices();
    const a = u.add([1, 0], 1, 4, NOW);
    const b = u.add([0, 1], 1, 5, NOW);
    expect(a.id).toBeLessThan(0);
    expect(b.id).not.toBe(a.id);
    expect(isUnsavedId(a.id)).toBe(true);
    expect(isUnsavedId(3)).toBe(false);
    expect(u.labels(NOW)).toEqual([4, 5]);
    expect(u.people(NOW).map((p) => p.labelNo)).toEqual([4, 5]);
  });
  it('learns in memory and forgets a voice unheard for a conversation gap', () => {
    const u = new UnsavedVoices();
    const a = u.add([1, 0], 1, 1, NOW);
    u.heard(a.id, NOW + 1000, [0, 1]);
    expect(u.all(NOW + 1000)[0].count).toBe(2);
    expect(u.all(NOW + 1000)[0].centroid[1]).toBeGreaterThan(0);
    expect(u.all(NOW + 1000 + FORGET_MS + 1)).toEqual([]);
  });
  it('hands a voice over when it is saved', () => {
    const u = new UnsavedVoices();
    const a = u.add([1, 0], 1, 1, NOW);
    expect(u.take(a.id)?.id).toBe(a.id);
    expect(u.all(NOW)).toEqual([]);
  });
});

describe('LiveTranscript.respeak', () => {
  it('moves the lines of an unsaved voice to its stored id', () => {
    const t = new LiveTranscript();
    t.put({ at: 1, text: 'a', speakerId: -1, isOwner: false, saved: false });
    t.put({ at: 2, text: 'b', speakerId: 3, isOwner: false, saved: true });
    t.respeak(-1, 7);
    expect(t.all.map((l) => l.speakerId)).toEqual([7, 3]);
  });
});

describe('storage guard', () => {
  const GB = 1e9;
  const total = 109 * GB;
  const reserve = 11 * GB;
  it('has three levels', () => {
    expect(spaceLevel(13 * GB, total, reserve)).toBe('ok');
    expect(spaceLevel(5 * GB, total, reserve)).toBe('low');
    expect(spaceLevel(0.9 * GB, total, reserve)).toBe('full');
  });
  it('the floor is 500 MB or 1% of the phone, never above the reserve', () => {
    expect(floorBytes(32 * GB, 3 * GB)).toBe(FLOOR_BYTES);
    expect(floorBytes(total, reserve)).toBeCloseTo(1.09 * GB);
    expect(floorBytes(total, 0.2 * GB)).toBe(0.2 * GB);
  });
  it('under the reserve, recordings pause; photos and memories go on', () => {
    expect(mayWrite('audio', 'low')).toBe(false);
    expect(mayWrite('camera', 'low')).toBe(false);
    expect(mayWrite('photo', 'low')).toBe(true);
    expect(mayWrite('memory', 'low')).toBe(true);
  });
  it('when full, nothing big is written', () => {
    for (const k of ['photo', 'audio', 'camera', 'memory', 'download'] as const)
      expect(mayWrite(k, 'full')).toBe(false);
    for (const k of ['photo', 'audio', 'camera', 'memory', 'download'] as const)
      expect(mayWrite(k, 'ok')).toBe(true);
  });
  it('a download must leave the reserve free', () => {
    expect(downloadFits(1 * GB, 13 * GB, reserve)).toEqual({ ok: true, shortBy: 0 });
    expect(downloadFits(3 * GB, 13 * GB, reserve)).toEqual({ ok: false, shortBy: 1 * GB });
  });
  it('says what happened in plain words', () => {
    expect(spaceMessage('photo', 0.4 * GB)).toMatch(/full \(400 MB free\)/);
    expect(spaceMessage('download', 13 * GB, 1 * GB)).toMatch(/free up 1\.0 GB/);
    expect(spaceStateMessage('ok', 13 * GB)).toBeNull();
    expect(spaceStateMessage('low', 5 * GB)).toMatch(/video, camera stills and conversation audio/);
    expect(spaceStateMessage('full', 0.4 * GB)).toMatch(/Heard lines wait/);
  });
});

describe('memory pressure (JS side)', () => {
  it('Android frees models natively; JS drops caches only', () => {
    expect(jsPlan({ platform: 'android', llmBusy: false })).toEqual({
      caches: true,
      embedder: false,
      llm: false,
    });
  });
  it('iPhone frees the embedder, and the chat model unless it is answering', () => {
    expect(jsPlan({ platform: 'ios', llmBusy: false }).llm).toBe(true);
    expect(jsPlan({ platform: 'ios', llmBusy: true })).toEqual({
      caches: true,
      embedder: true,
      llm: false,
    });
  });
});
