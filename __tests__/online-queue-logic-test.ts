import {
  addJob,
  answeredTitle,
  jobExpired,
  MAX_ONLINE_JOBS,
  nativeConfig,
  networkEdges,
  queuedLine,
  type OnlineJob,
} from '@/engine/online-queue-logic';
import { describeWhen, parseRoutine } from '@/engine/routines-logic';

const T = new Date(2026, 10, 25, 14, 5).getTime();
const job = (q: string, at = T, kind: OnlineJob['kind'] = 'lookup'): OnlineJob => ({
  id: `j${q}`,
  kind,
  question: q,
  askedAt: at,
});

describe('online queue logic', () => {
  it('dedupes the same question and keeps the newest 20', () => {
    let jobs = addJob([], job('Who won the match?'));
    jobs = addJob(jobs, job('who won the match'));
    expect(jobs).toHaveLength(1);
    for (let i = 0; i < 30; i++) jobs = addJob(jobs, job(`q ${i}`));
    expect(jobs).toHaveLength(MAX_ONLINE_JOBS);
    expect(jobs[jobs.length - 1].question).toBe('q 29');
  });

  it('weather goes stale after 6 hours, lookups keep 3 days', () => {
    expect(jobExpired(job('rain?', T, 'weather'), T + 5 * 3600_000)).toBe(false);
    expect(jobExpired(job('rain?', T, 'weather'), T + 7 * 3600_000)).toBe(true);
    expect(jobExpired(job('x'), T + 2 * 86400_000)).toBe(false);
    expect(jobExpired(job('x'), T + 4 * 86400_000)).toBe(true);
  });

  it('says what it will do and titles the answer', () => {
    expect(queuedLine('weather')).toMatch(/forecast as soon as you're back online/);
    expect(queuedLine('lookup')).toMatch(/look that up online/);
    expect(answeredTitle(job('who won?'), T + 60_000)).toBe('You asked at 14:05: who won?');
    expect(answeredTitle(job('who won?'), T + 86400_000)).toMatch(
      /^You asked Wed Nov 25: who won\?$/,
    );
  });

  it('finds network edges', () => {
    expect(networkEdges(null, { online: true, wifi: true })).toEqual([]);
    expect(networkEdges({ online: false, wifi: false }, { online: true, wifi: true })).toEqual([
      'online',
      'wifi',
    ]);
    expect(networkEdges({ online: true, wifi: true }, { online: true, wifi: false })).toEqual([
      'wifi-leave',
    ]);
    expect(networkEdges({ online: true, wifi: false }, { online: false, wifi: false })).toEqual([
      'offline',
    ]);
  });

  it('tells native what to wait for', () => {
    expect(nativeConfig(2, ['wifi'])).toEqual({
      pending: 2,
      online: false,
      wifi: true,
      offline: false,
      wifiLeave: false,
    });
  });
});

describe('network routines', () => {
  const NOW = new Date(2026, 10, 25, 12);
  const cases: [string, string, string][] = [
    ["when I'm back online tell me the news", 'online', "When you're back online"],
    ['when I connect to wifi, back up my notes', 'wifi', 'When you connect to Wi-Fi'],
    ['when I leave wi-fi, tell me the time', 'wifi-leave', 'When you leave Wi-Fi'],
    ['when I go offline tell me', 'offline', 'When you go offline'],
  ];
  it.each(cases)('%s', (text, edge, said) => {
    const r = parseRoutine(text, NOW);
    if (!r || !r.ok) throw new Error(`not parsed: ${JSON.stringify(r)}`);
    expect(r.when).toEqual({ type: 'network', edge });
    expect(describeWhen(r.when)).toBe(said);
  });
});
