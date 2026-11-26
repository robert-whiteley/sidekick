// Voice bench scorer: replays the pipeline's lines (segments.json) through the app's own voice
// and name logic (src/memory/voices.ts, names.ts), one line at a time as the app ingests them
// live, with one speaker table kept across all conversations like the phone's. Prints who-said-it
// and name metrics per condition.
//
//   node bench/voice/score.mjs DATA_DIR [--rules '{"sameVoice":0.5}'] [--no-defer] [--no-group]
//     [--group-sim 0.5] [--dump] [--json] COND...
// --no-defer / --no-group: name cues settled at once / no new voices from short clips (as before).
import { readFileSync } from 'node:fs';

import {
  addToCentroid,
  chooseSpeaker,
  claimPending,
  GROUP_SIM,
  VOICE_RULES,
  voiceFromPending,
} from '../../src/memory/voices.ts';
// SK_NAMES: another copy of names.ts (e.g. the previous release's, for before/after numbers).
const names = await import(process.env.SK_NAMES ?? '../../src/memory/names.ts');

const args = process.argv.slice(2);
const data = args.shift();
let rules = { ...VOICE_RULES };
let asJson = false;
let opts = {};
const conds = [];
while (args.length) {
  const a = args.shift();
  if (a === '--rules') rules = { ...rules, ...JSON.parse(args.shift()) };
  else if (a === '--opts') opts = JSON.parse(args.shift());
  else if (a === '--json') asJson = true;
  else if (a === '--dump') opts.dump = true;
  else if (a === '--no-defer') opts.noDefer = true;
  else if (a === '--no-group') opts.noGroup = true;
  else if (a === '--group-sim') opts.groupSim = Number(args.shift());
  else conds.push(a);
}
const truth = JSON.parse(readFileSync(`${data}/truth.json`, 'utf8'));
const HOUR = 3_600_000;

/** One run of the app's ingest over every conversation in order. */
export function replay(rows, rules, opts = {}) {
  const convIndex = new Map(truth.convs.map((c, i) => [c.id, i]));
  const speakers = []; // { id, centroid, count, isOwner, name, suggested, suggestedCount }
  let pending = [];
  const lines = []; // ingested: { at, speakerId, isOwner, row }
  const deferred = []; // name cues waiting for their reply (see store.ts)
  let nextId = 1;
  const byId = (id) => speakers.find((s) => s.id === id);
  // What each voice is shown as at the end of each conversation (name or description).
  const shown = {};
  const snap = (conv) => {
    shown[conv] = new Map(
      speakers.map((x) => [x.id, { name: x.name, description: x.description }]),
    );
  };
  let prevConv = null;

  const suggest = (id, name, weight = 1) => {
    const s = byId(id);
    if (!s || s.name || s.isOwner) return;
    const next = names.addEvidence({ name: s.suggested, count: s.suggestedCount }, name, weight);
    if (!next) return;
    if (next.apply) {
      s.name = name;
      s.suggested = null;
      s.suggestedCount = 0;
      return;
    }
    s.suggested = name;
    s.suggestedCount = next.count;
  };
  const applyAuto = (id, name) => {
    const s = byId(id);
    if (!s || s.name || s.isOwner) return false;
    s.name = name;
    return true;
  };
  const resolve = (line, cue, nearby) => {
    const target = names.addresseeOf(line, nearby, cue.replyExpected);
    if (target != null) suggest(target, cue.name);
  };

  for (const row of rows) {
    if (prevConv && row.conv !== prevConv) snap(prevConv);
    prevConv = row.conv;
    const at = convIndex.get(row.conv) * HOUR + Math.round(row.start * 1000);
    const choice = chooseSpeaker(row.voice, row.owner, row.durationMs, false, speakers, rules);
    let s = null;
    let isOwner = choice.owner;
    const newSpeaker = (centroid, count) => {
      const x = { id: nextId++, centroid, count, isOwner: false, name: null, suggested: null };
      x.suggestedCount = 0;
      x.description = null;
      speakers.push(x);
      return x;
    };
    const claim = (x) => {
      const { claimed, waiting } = claimPending(pending, x, speakers, at, rules);
      pending = waiting;
      for (const c of claimed) {
        const l = lines.find((y) => y.at === c.at);
        if (l && l.speakerId == null) l.speakerId = x.id;
      }
    };
    if (choice.kind === 'none' && !choice.owner && row.voice && !opts.noGroup) {
      const found = voiceFromPending(
        row.voice,
        row.durationMs,
        pending,
        speakers,
        at,
        rules,
        opts.groupSim ?? GROUP_SIM,
      );
      if (found) {
        s = newSpeaker(found.centroid, found.group.length + 1);
        pending = pending.filter((p) => !found.group.includes(p));
        for (const c of found.group) {
          const l = lines.find((y) => y.at === c.at);
          if (l && l.speakerId == null) l.speakerId = s.id;
        }
        claim(s);
      }
    }
    if (choice.kind === 'join') {
      s = choice.speaker;
      if (choice.learn) {
        s.centroid = addToCentroid(s, row.voice);
        s.count++;
      }
      isOwner = s.isOwner;
    } else if (choice.kind === 'new') {
      s = newSpeaker(row.voice, 1);
      s.isOwner = choice.owner;
      if (!s.isOwner) claim(s);
    }
    const line = { at, speakerId: s?.id ?? null, isOwner, row };
    if (!s && !isOwner && row.voice)
      pending.push({ at, voice: row.voice, momentId: null, durationMs: row.durationMs });
    lines.push(line);
    // Descriptions (as name-inference.ts): the role each unnamed voice's own lines in this
    // conversation show. The model's reading runs only on the phone, so it isn't scored here.
    if (names.roleFromLines)
      for (const x of speakers) {
        if (x.isOwner || x.name) continue;
        const own = lines.filter((l) => l.speakerId === x.id && l.row.conv === row.conv);
        const role = own.length ? names.roleFromLines(own.map((l) => l.row.text)) : null;
        if (role) x.description = role;
      }
    const nearbyOf = (l) =>
      lines
        .filter((x) => x.speakerId != null && Math.abs(x.at - l.at) <= names.ADDRESS_WINDOW_MS)
        .map((x) => ({ at: x.at, speakerId: x.speakerId, isOwner: x.isOwner }));
    // Names (as suggestNamesFrom in store.ts). opts.noDefer: as before (settled at once).
    for (const cue of names.findNameCues(row.text)) {
      if (cue.who === 'speaker') {
        const target = isOwner ? null : line.speakerId;
        if (target == null) continue;
        if (!(cue.strong && applyAuto(target, cue.name))) suggest(target, cue.name);
      } else if (!opts.noDefer && cue.replyExpected) {
        deferred.push({ line, cue });
      } else resolve(line, cue, nearbyOf(line));
    }
    // Cues held back until the person spoken to answers (or the reply window closes).
    for (const d of [...deferred]) {
      if (names.replySettled(d.line, nearbyOf(d.line), at)) {
        deferred.splice(deferred.indexOf(d), 1);
        resolve(d.line, d.cue, nearbyOf(d.line));
      }
    }
  }
  for (const d of deferred) resolve(d.line, d.cue, []);
  if (prevConv) snap(prevConv);
  return { speakers, lines, shown };
}

const dur = (l) => l.row.end - l.row.start;

/** Edit distance, for names the speech model spells differently ("Okolo" for Okello). */
function edits(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length][b.length];
}
/** The same name as heard: equal, or at most 2 letters off (Ren / Wren, Lucas / Lukas). */
const sameName = (heard, real) =>
  !!heard && !!real && edits(heard.toLowerCase(), real.toLowerCase()) <= 2;

/** Optimal one-to-one matching (small sizes: Hungarian via brute-force-ish greedy refinement). */
function bestMatch(weights) {
  // weights: Map<cluster, Map<pid, seconds>>. Greedy on largest overlaps (fine at these sizes).
  const pairs = [];
  for (const [c, m] of weights) for (const [p, w] of m) pairs.push([w, c, p]);
  pairs.sort((a, b) => b[0] - a[0]);
  const usedC = new Set();
  const usedP = new Set();
  const map = new Map();
  for (const [, c, p] of pairs) {
    if (usedC.has(c) || usedP.has(p)) continue;
    usedC.add(c);
    usedP.add(p);
    map.set(c, p);
  }
  return map;
}

function score(rows) {
  const { speakers, lines, shown } = replay(rows, rules, opts);
  if (opts.dump)
    for (const l of lines) {
      const s = speakers.find((x) => x.id === l.speakerId);
      const who = l.isOwner ? 'You' : s ? `s${s.id}${s.name ? `(${s.name})` : ''}` : 'Someone';
      const truthLabel = Object.entries(l.row.share)
        .map(([p, w]) => `${p}:${w.toFixed(1)}`)
        .join(' ');
      console.log(
        `${l.row.conv.padEnd(12)} ${(l.row.durationMs / 1000).toFixed(1).padStart(4)}s ${who.padEnd(14)} [${truthLabel}] ${l.row.text}`,
      );
    }
  const talk = lines.filter((l) => !l.row.conv.startsWith('owner-q') && l.row.truth);
  const label = (l) => (l.isOwner ? 'owner' : l.speakerId == null ? null : `s${l.speakerId}`);
  // Time each line spends with each true person (a line that merged two turns counts for both).
  const add = (m, k, p, w) => {
    if (!m.has(k)) m.set(k, new Map());
    m.get(k).set(p, (m.get(k).get(p) ?? 0) + w);
  };
  const spans = (l) => Object.entries(l.row.share);
  let total = 0;
  let unattributed = 0;
  let ownerTime = 0;
  let ownerHit = 0;
  let othersTime = 0;
  let othersAsOwner = 0;
  for (const l of talk)
    for (const [p, w] of spans(l)) {
      total += w;
      if (p === 'me') {
        ownerTime += w;
        if (l.isOwner) ownerHit += w;
      } else {
        othersTime += w;
        if (l.isOwner) othersAsOwner += w;
        if (label(l) == null) unattributed += w;
      }
    }
  // Global identity: one label per real person across every conversation (re-identification).
  const global = new Map();
  for (const l of talk) {
    const k = label(l);
    if (k) for (const [p, w] of spans(l)) add(global, k, p, w);
  }
  const gmap = bestMatch(global);
  gmap.set('owner', 'me');
  let gCorrect = 0;
  for (const l of talk) for (const [p, w] of spans(l)) if (gmap.get(label(l)) === p) gCorrect += w;
  // Per conversation (what the live transcript shows).
  let cCorrect = 0;
  let shownN = 0;
  let shownOk = 0;
  let unnamedN = 0;
  let unnamedOk = 0;
  const convs = [...new Set(talk.map((l) => l.row.conv))];
  for (const c of convs) {
    const m = new Map();
    const ls = talk.filter((l) => l.row.conv === c);
    for (const l of ls) {
      const k = label(l);
      if (k && k !== 'owner') for (const [p, w] of spans(l)) add(m, k, p, w);
    }
    const map = bestMatch(m);
    map.set('owner', 'me');
    for (const l of ls) for (const [p, w] of spans(l)) if (map.get(label(l)) === p) cCorrect += w;
    // Shown right: the voice that is mainly this person shows their name or their role.
    const tc = truth.convs.find((x) => x.id === c);
    for (const p of new Set(tc.turns.map((t) => t.pid).filter((x) => x !== 'me'))) {
      const real = truth.people[p];
      const k = [...map.entries()].find(([, v]) => v === p)?.[0];
      const now = k && k !== 'owner' ? shown[c]?.get(Number(k.slice(1))) : null;
      const roleOk = (real.role ?? '')
        .split('|')
        .filter(Boolean)
        .includes(now?.description ?? '');
      const ok = sameName(now?.name, real.name) || roleOk;
      shownN++;
      if (ok) shownOk++;
      if (!real.name) {
        unnamedN++;
        if (roleOk) unnamedOk++;
        if (opts.dump)
          console.log(`role ${c} ${p}: ${now ? (now.description ?? 'Person') : 'Someone'}`);
      }
    }
  }
  // Re-identification: in the later conversation, is a person's main voice their first one?
  const mainLabel = (pid, part) => {
    const m = new Map();
    for (const l of talk)
      if (l.row.conv.endsWith(`-${part}`) && label(l) && label(l) !== 'owner')
        for (const [p, w] of spans(l)) if (p === pid) m.set(label(l), (m.get(label(l)) ?? 0) + w);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const people = Object.keys(truth.people).filter((p) => p !== 'me');
  let reid = 0;
  let reidN = 0;
  for (const p of people) {
    const a = mainLabel(p, 'a');
    const b = mainLabel(p, 'b');
    if (!a && !b) continue;
    reidN++;
    if (a && a === b && gmap.get(a) === p) reid++;
  }
  // Merges: a voice label holding two real people (each ≥ 20% of its time); splits: labels per person.
  let merges = 0;
  let crossSceneMerges = 0;
  for (const [, m] of global) {
    const tot = [...m.values()].reduce((x, y) => x + y, 0);
    const big = [...m.entries()].filter(([, w]) => w >= 0.2 * tot).map(([p]) => p);
    if (big.length > 1) {
      merges++;
      if (new Set(big.map((p) => p.split('/')[0])).size > 1) crossSceneMerges++;
    }
  }
  const labelsPer = people.map(
    (p) =>
      [...global.values()].filter((m) => {
        const tot = [...m.values()].reduce((x, y) => x + y, 0);
        return (m.get(p) ?? 0) >= 0.2 * tot && (m.get(p) ?? 0) > 1;
      }).length,
  );
  // Names: the label that is mainly this person carries their name.
  let named = 0;
  let suggested = 0;
  let wrongNames = 0;
  const namedPeople = people.filter((p) => truth.people[p].name);
  const owner = speakers.find((s) => s.isOwner);
  for (const s of speakers) {
    if (s.isOwner || !s.name) continue;
    const p = gmap.get(`s${s.id}`);
    if (!p || !sameName(s.name, truth.people[p]?.name)) wrongNames++;
  }
  for (const p of namedPeople) {
    const k = [...gmap.entries()].find(([, v]) => v === p)?.[0];
    const s = k && k !== 'owner' ? speakers.find((x) => `s${x.id}` === k) : null;
    if (sameName(s?.name, truth.people[p].name)) named++;
    else if (sameName(s?.suggested, truth.people[p].name)) suggested++;
  }
  const impure = talk.filter((l) => l.row.purity < 0.8).reduce((x, l) => x + dur(l), 0);
  const allDur = talk.reduce((x, l) => x + dur(l), 0);
  return {
    lines: talk.length,
    perConvAcc: cCorrect / total,
    globalAcc: gCorrect / total,
    someone: unattributed / othersTime,
    ownerRecall: ownerHit / ownerTime,
    ownerFalse: othersAsOwner / othersTime,
    voices: speakers.filter((s) => !s.isOwner).length,
    people: people.length,
    merges,
    crossSceneMerges,
    splitPeople: labelsPer.filter((n) => n > 1).length,
    reid: reidN ? reid / reidN : 0,
    named: named / namedPeople.length,
    suggestedOnly: suggested / namedPeople.length,
    wrongNames,
    mixedLines: impure / allDur,
    shownRight: shownN ? shownOk / shownN : 0,
    rolesShown: unnamedN ? unnamedOk / unnamedN : 0,
    ownerKnown: !!owner,
  };
}

const out = {};
for (const c of conds) {
  // "clean" is the app's pipeline today; "clean@cut_0.3" a pipeline variant (pipeline.py).
  const [cond, variant] = c.split('@');
  const file = variant ? `segments-${variant}.json` : 'segments.json';
  const rows = JSON.parse(readFileSync(`${data}/${cond}/${file}`, 'utf8'));
  out[c] = score(rows);
}
if (asJson) console.log(JSON.stringify(out));
else {
  const pct = (x) => `${Math.round(x * 100)}%`;
  console.log(
    'cond      lines conv%  glob%  someone ownerR ownerF voices/ppl merges(x) splits reid  named sugg wrong mixed shown roles',
  );
  for (const [c, r] of Object.entries(out))
    console.log(
      [
        c.padEnd(9),
        String(r.lines).padStart(5),
        pct(r.perConvAcc).padStart(5),
        pct(r.globalAcc).padStart(6),
        pct(r.someone).padStart(7),
        pct(r.ownerRecall).padStart(6),
        pct(r.ownerFalse).padStart(6),
        `${r.voices}/${r.people}`.padStart(10),
        `${r.merges}(${r.crossSceneMerges})`.padStart(9),
        String(r.splitPeople).padStart(6),
        pct(r.reid).padStart(5),
        pct(r.named).padStart(6),
        pct(r.suggestedOnly).padStart(4),
        String(r.wrongNames).padStart(5),
        pct(r.mixedLines).padStart(5),
        pct(r.shownRight).padStart(5),
        pct(r.rolesShown).padStart(5),
      ].join(' '),
    );
}
