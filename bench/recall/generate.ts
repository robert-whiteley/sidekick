/**
 * The memory recall bench: a few weeks of made-up memories (conversation notes with invented
 * people and places, photo captions, typed notes) and ~50 questions with known answers. Pure and
 * deterministic for a given `now`; loaded on the phone by the dev bench screen (src/app/bench.tsx)
 * through src/memory/bench-data.ts, which tags every row with source_key 'bench:…' so the test
 * data can be removed exactly. Filler rows pad the store to 100 / 1,000 / 5,000 items.
 *
 * Everything here is invented. Times are relative to `now` (days ago, clock time).
 */

export type BenchMemory = {
  key: string;
  kind: 'conversation_note' | 'note' | 'photo';
  at: number;
  text: string;
  /** Signal rows answer questions; filler rows only pad the store. */
  filler?: boolean;
};

export type RecallQuestion = {
  id: string;
  q: string;
  /** Regexes (case-insensitive): the answer must match one. */
  any: string[];
  /** Keys of the memories that hold the answer (for retrieval hit rates). */
  keys: string[];
};

const DAY = 86_400_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** [days] ago at hh:mm local time. */
function at(now: Date, days: number, hh: number, mm = 0): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

const weekdayAgo = (now: Date, days: number) => WEEKDAYS[new Date(at(now, days, 12)).getDay()];

type Seed = [
  key: string,
  kind: BenchMemory['kind'],
  days: number,
  hh: number,
  mm: number,
  text: string,
];

const SIGNAL: Seed[] = [
  [
    'priya-boiler',
    'conversation_note',
    1,
    10,
    30,
    'Conversation with Priya\nPriya said the boiler keeps losing pressure and the engineer, Callum, is coming on Monday between 8 and 10.\nTopics: boiler; heating\nAction items: Priya will text the engineer the model number',
  ],
  [
    'priya-thai',
    'conversation_note',
    9,
    19,
    0,
    'Conversation with Priya\nPriya recommended the Thai restaurant on Wren Street, called Lotus Garden.\nTopics: restaurants',
  ],
  [
    'tomasz-move',
    'conversation_note',
    3,
    13,
    0,
    'Conversation with Tomasz and Imogen at the Bluebell Café\nTomasz is moving to Rotterdam in March for a job at a shipping firm.\nTopics: new job; moving abroad',
  ],
  [
    'cafe-lunch',
    'note',
    3,
    12,
    40,
    'Met Tomasz and Imogen at the Bluebell Café for lunch. I had the leek soup.',
  ],
  [
    'kofi-kite',
    'conversation_note',
    2,
    15,
    0,
    'Conversation with Kofi at Fennick Park\nKofi and I flew his new red kite at Fennick Park; the string snapped once.\nTopics: kite flying',
  ],
  ['park-afternoon', 'note', 2, 16, 10, 'Spent the afternoon at Fennick Park with Kofi.'],
  [
    'kite-photo',
    'photo',
    2,
    15,
    20,
    'Photo: a red diamond kite with a long yellow tail above a grassy hill.',
  ],
  ['bike-shed', 'note', 5, 9, 0, 'The code for the bike shed at work is 5094.'],
  [
    'elif-swim',
    'conversation_note',
    6,
    11,
    0,
    'Conversation with Elif\nElif said her daughter Defne starts swimming lessons on Saturdays at 9 at the Kingsmead pool.\nTopics: swimming lessons',
  ],
  [
    'ladder',
    'conversation_note',
    12,
    18,
    0,
    "Conversation with Marguerite\nMarguerite lent me her ladder; I need to return it by the 30th.\nAction items: return Marguerite's ladder by the 30th",
  ],
  ['parking', 'note', 4, 20, 0, 'Parked the car on level 4 of the Westgate car park, bay 61.'],
  ['ticket-photo', 'photo', 8, 14, 0, "Photo: a parking ticket showing 'Zone C, expires 16:45'."],
  [
    'doctor',
    'conversation_note',
    7,
    10,
    0,
    'Conversation with Dr Okafor\nDr Okafor said my blood test results are normal and to come back in six months.\nTopics: blood test results',
  ],
  ['wifi', 'note', 10, 8, 0, 'The Wi-Fi password at the Hollins cottage is otter-lantern-42.'],
  [
    'ravi-photos',
    'conversation_note',
    11,
    16,
    0,
    'Conversation with Ravi\nRavi asked me to send him the photos from the wedding by Friday.\nAction items: send Ravi the wedding photos by Friday',
  ],
  [
    'book-club',
    'conversation_note',
    1,
    17,
    30,
    "Conversation with Imogen\nImogen said the book club is reading 'The Salt Path' next and meets on the 12th at her flat.\nTopics: book club",
  ],
  [
    'menu-photo',
    'photo',
    6,
    13,
    0,
    'Photo: a menu board at Corran Street market: falafel wrap 6.50, halloumi fries 4.00.',
  ],
  [
    'kofi-present',
    'note',
    13,
    12,
    0,
    'Bought a birthday present for Kofi: a jigsaw puzzle of the London Underground map.',
  ],
  [
    'hamid-gig',
    'conversation_note',
    14,
    19,
    0,
    "Conversation with Hamid\nHamid's band, The Quiet Foxes, plays at the Old Granary on the 6th of December.\nTopics: Hamid's gig",
  ],
  ['umbrella', 'note', 0, -1, 0, "Left my blue umbrella at the dentist's reception."],
  [
    'priya-cashew',
    'conversation_note',
    4,
    14,
    0,
    'Conversation with Priya\nPriya is allergic to cashew nuts, so no satay at the dinner party.\nTopics: dinner party menu',
  ],
  [
    'carpark-photo',
    'photo',
    4,
    20,
    10,
    "Photo: a car park sign reading 'Westgate Level 4' next to a lift.",
  ],
  [
    'wen-plumber',
    'conversation_note',
    15,
    10,
    0,
    'Conversation with Wen\nWen said the plumber she uses is Gareth Price, and he charges 60 pounds an hour.\nTopics: plumbers',
  ],
  [
    'passport',
    'note',
    16,
    9,
    0,
    'Passport renewal sent; the new passport should arrive within three weeks.',
  ],
  [
    'tomasz-podcast',
    'conversation_note',
    17,
    13,
    0,
    "Conversation with Tomasz\nTomasz recommended the podcast 'Deep Field' about astronomy.\nTopics: podcasts",
  ],
  [
    'sunita-run',
    'conversation_note',
    8,
    11,
    0,
    'Conversation with Sunita at the Bluebell Café\nSunita is training for the Harrogate half marathon in April.\nTopics: running',
  ],
  ['film', 'note', 18, 21, 0, "Watched 'Vertigo' with Imogen; she fell asleep halfway through."],
  [
    'callum-valve',
    'conversation_note',
    19,
    12,
    0,
    "Conversation with Callum, the heating engineer\nCallum replaced the boiler's pressure valve; the boiler is under warranty until 2029.\nTopics: boiler repair",
  ],
  [
    'whiteboard-photo',
    'photo',
    10,
    17,
    0,
    "Photo: a whiteboard at work saying 'Sprint review moved to Wednesday 3pm'.",
  ],
  [
    'dentist',
    'note',
    20,
    8,
    0,
    'Dentist appointment booked for 9 December at 11:15 with Dr Liang.',
  ],
  [
    'kofi-sister',
    'conversation_note',
    5,
    18,
    0,
    'Conversation with Kofi\nKofi said his sister Ama is visiting from Accra next week.\nTopics: family visit',
  ],
  ['bread', 'note', 6, 8, 0, 'Started the new bread recipe: 500 g flour, 350 ml water, 10 g salt.'],
  [
    'elif-vet',
    'conversation_note',
    3,
    19,
    0,
    "Conversation with Elif\nElif's cat, Pamuk, has to go to the vet on Thursday for her jabs.\nTopics: Elif's cat",
  ],
  [
    'train-photo',
    'photo',
    12,
    10,
    0,
    'Photo: a train departure board showing the 10:42 to York from platform 7.',
  ],
  ['morning-run', 'note', 1, 8, 15, 'Morning run: 5.2 km along the canal in 31 minutes.'],
  [
    'tomatoes',
    'conversation_note',
    13,
    15,
    0,
    'Conversation with Marguerite\nMarguerite grows tomatoes and offered me some seedlings in May.\nTopics: gardening',
  ],
  [
    'spare-key',
    'note',
    9,
    13,
    0,
    "The spare key for Marguerite's house is in the green watering can by her back door.",
  ],
];

/** The ~50 questions; {wd2} / {wd3} are the weekday names of 2 and 3 days ago. */
const QUESTIONS: [id: string, q: string, any: string[], keys: string[]][] = [
  [
    'boiler-priya',
    'What did Priya say about the boiler?',
    ['pressure', 'engineer', 'callum'],
    ['priya-boiler'],
  ],
  [
    'boiler-when',
    'When is the engineer coming to look at the boiler?',
    ['monday', '30 november', 'november 30', 'between 8', 'between eight'],
    ['priya-boiler'],
  ],
  [
    'thai-name',
    "What's the name of the Thai restaurant Priya recommended?",
    ['lotus garden'],
    ['priya-thai'],
  ],
  [
    'cafe-who',
    'Who did I meet at the café on {wd3}?',
    ['tomasz', 'imogen'],
    ['tomasz-move', 'cafe-lunch'],
  ],
  ['tomasz-where', 'Where is Tomasz moving to?', ['rotterdam'], ['tomasz-move']],
  [
    'where-afternoon',
    'Where was I on {wd2} afternoon?',
    ['fennick'],
    ['kofi-kite', 'park-afternoon'],
  ],
  ['kite-colour', "What colour was Kofi's kite?", ['\\bred\\b'], ['kofi-kite', 'kite-photo']],
  ['bike-code', "What's the code for the bike shed at work?", ['5094'], ['bike-shed']],
  ['swim-when', "When are Defne's swimming lessons?", ['saturday'], ['elif-swim']],
  ['ladder-whose', 'Whose ladder do I have?', ['marguerite'], ['ladder']],
  [
    'ladder-when',
    'When do I need to give the ladder back?',
    ['30th', '\\b30\\b', 'thirtieth'],
    ['ladder'],
  ],
  [
    'park-where',
    'Where did I park in the Westgate car park?',
    ['level 4', 'level four', 'bay 61'],
    ['parking', 'carpark-photo'],
  ],
  ['blood-test', 'What did the doctor say about my blood test?', ['normal'], ['doctor']],
  [
    'wifi',
    "What's the Wi-Fi password at the cottage?",
    ['otter-lantern-42', 'otter lantern 42'],
    ['wifi'],
  ],
  ['ravi-ask', 'What did Ravi ask me to do?', ['photo'], ['ravi-photos']],
  ['book-next', 'What is the book club reading next?', ['salt path'], ['book-club']],
  [
    'falafel',
    'How much was the falafel wrap at the market?',
    ['6\\.50', '6\\.5\\b', 'six fifty'],
    ['menu-photo'],
  ],
  ['kofi-present', 'What did I buy Kofi for his birthday?', ['puzzle', 'jigsaw'], ['kofi-present']],
  [
    'hamid-when',
    "When is Hamid's band playing?",
    ['6th', '\\b6 december', 'december 6', 'sixth'],
    ['hamid-gig'],
  ],
  ['umbrella', 'Where did I leave my umbrella?', ['dentist'], ['umbrella']],
  ['priya-allergy', 'What is Priya allergic to?', ['cashew'], ['priya-cashew']],
  ['plumber-who', 'Who is the plumber Wen recommended?', ['gareth'], ['wen-plumber']],
  ['plumber-cost', "How much does Wen's plumber charge?", ['\\b60\\b', 'sixty'], ['wen-plumber']],
  ['podcast', 'What podcast did Tomasz recommend?', ['deep field'], ['tomasz-podcast']],
  [
    'sunita-training',
    'What is Sunita training for?',
    ['half marathon', 'half-marathon'],
    ['sunita-run'],
  ],
  ['film', 'What film did I watch with Imogen?', ['vertigo'], ['film']],
  ['warranty', 'Until when is the boiler under warranty?', ['2029'], ['callum-valve']],
  ['sprint', 'When was the sprint review moved to?', ['wednesday'], ['whiteboard-photo']],
  [
    'dentist-when',
    'When is my dentist appointment?',
    ['9 december', 'december 9', '9th', '11:15', 'ninth'],
    ['dentist'],
  ],
  ['kofi-visitor', 'Who is coming to visit Kofi?', ['\\bama\\b', 'sister'], ['kofi-sister']],
  ['bread-flour', 'How much flour goes in the new bread recipe?', ['500'], ['bread']],
  ['vet-when', 'When does Pamuk go to the vet?', ['thursday'], ['elif-vet']],
  ['york-platform', 'What platform was the train to York?', ['\\b7\\b', 'seven'], ['train-photo']],
  [
    'run-distance',
    'How far did I run yesterday morning?',
    ['5\\.2', 'five point two'],
    ['morning-run'],
  ],
  ['marguerite-offer', 'What did Marguerite offer me?', ['seedling', 'tomato'], ['tomatoes']],
  ['spare-key', "Where is the spare key for Marguerite's house?", ['watering can'], ['spare-key']],
  ['kite-who', 'Who did I fly a kite with?', ['kofi'], ['kofi-kite']],
  ['sunita-cafe', 'Which café did I meet Sunita at?', ['bluebell'], ['sunita-run']],
  ['elif-daughter', 'What did Elif say about her daughter?', ['swim'], ['elif-swim']],
  [
    'hamid-talk',
    'What did I talk about with Hamid?',
    ['band', 'quiet foxes', 'gig', 'granary'],
    ['hamid-gig'],
  ],
  ['lotus-who', 'Who told me about Lotus Garden?', ['priya'], ['priya-thai']],
  [
    'ticket-expiry',
    'What time did the parking ticket expire?',
    ['16:45', '4:45', 'quarter to five', 'forty-five', 'forty five'],
    ['ticket-photo'],
  ],
  [
    'cafe-lunch',
    'What did I have for lunch at the Bluebell Café?',
    ['leek soup', 'soup'],
    ['cafe-lunch'],
  ],
  ['kite-tail', "What colour was the kite's tail?", ['yellow'], ['kite-photo']],
  [
    'marathon-where',
    'Where is the half marathon Sunita is running?',
    ['harrogate'],
    ['sunita-run'],
  ],
  ['valve-who', "Who replaced the boiler's pressure valve?", ['callum'], ['callum-valve']],
  ['okafor', 'What did Dr Okafor tell me?', ['normal', 'six months', '6 months'], ['doctor']],
  ['book-meet', 'When does the book club meet?', ['12th', '\\b12\\b', 'twelfth'], ['book-club']],
  ['rotterdam-who', 'Who is moving to Rotterdam?', ['tomasz'], ['tomasz-move']],
  [
    'yesterday-morning',
    'What did I do yesterday morning?',
    ['\\brun\\b', 'ran', 'canal', 'jog'],
    ['morning-run'],
  ],
];

export function signalMemories(now: Date): BenchMemory[] {
  return SIGNAL.map(([key, kind, days, hh, mm, text]) => ({
    key,
    kind,
    // hh < 0: that many hours before now (today).
    at: hh < 0 ? now.getTime() + hh * 3_600_000 : at(now, days, hh, mm),
    text,
  }));
}

export function recallQuestions(now: Date): RecallQuestion[] {
  const fill = (q: string) =>
    q.replace('{wd2}', weekdayAgo(now, 2)).replace('{wd3}', weekdayAgo(now, 3));
  return QUESTIONS.map(([id, q, any, keys]) => ({ id, q: fill(q), any, keys }));
}

// --- Filler: ordinary-looking days that hold none of the answers ---

const F_PEOPLE = [
  'Aldous',
  'Bea',
  'Corin',
  'Delphine',
  'Ezra',
  'Fenna',
  'Gideon',
  'Hester',
  'Ivo',
  'Juno',
  'Lark',
  'Mabel',
  'Nico',
  'Odile',
  'Piers',
  'Rosalind',
  'Silas',
  'Thea',
  'Ulric',
  'Vesna',
];
const F_PLACES = [
  'the Ashgrove office',
  'the Larch Road shop',
  'Marlow station',
  'the Pennine gym',
  'the town library',
  'the farm shop',
  'the corner pub',
  'the bus stop',
];
const F_TOPICS = [
  'the weather turning colder',
  'the delays on the 8:05 train',
  'a new crime series on TV',
  "last night's football score",
  'repainting the hallway',
  'the quarterly budget spreadsheet',
  'a recipe for lentil curry',
  'pruning the apple tree',
  'holiday plans for the summer',
  'the price of petrol',
  'a broken washing machine',
  'the school fete',
  'learning Spanish on an app',
  'a board game called Carcassonne',
  'the noisy neighbours upstairs',
  'a long queue at the post office',
];
const F_NOTES = [
  'Need to buy batteries and light bulbs.',
  'Paid the council tax for this month.',
  'The recycling goes out every other week.',
  'Watered the house plants.',
  'Ordered a new phone case.',
  'Booked a haircut for next month.',
  'Cleaned out the fridge.',
  'Sorted the post: two bills and a catalogue.',
];
const F_PHOTOS = [
  'Photo: a row of terraced houses on a grey day.',
  'Photo: a supermarket shelf of breakfast cereals.',
  'Photo: a desk with a laptop and a mug of tea.',
  'Photo: a muddy footpath through a field.',
  'Photo: a bus timetable at a stop.',
  'Photo: a plate of pasta with tomato sauce.',
];

/** A small deterministic random number generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * [n] filler memories spread over the last [days] days, kept 3 hours away from every signal
 * memory so time questions keep one right answer.
 */
export function fillerMemories(now: Date, n: number, days = 90, seed = 7): BenchMemory[] {
  const r = rng(seed);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const signal = signalMemories(now).map((m) => m.at);
  const out: BenchMemory[] = [];
  let tries = 0;
  while (out.length < n && tries++ < n * 20) {
    const t = now.getTime() - Math.floor(r() * days * DAY);
    const hour = new Date(t).getHours();
    if (hour < 7 || hour > 22) continue;
    if (signal.some((s) => Math.abs(s - t) < 3 * 3_600_000)) continue;
    const kind = r();
    const i = out.length;
    let m: BenchMemory;
    if (kind < 0.45) {
      const a = pick(F_PEOPLE);
      let b = pick(F_PEOPLE);
      if (b === a) b = F_PEOPLE[(F_PEOPLE.indexOf(a) + 1) % F_PEOPLE.length];
      m = {
        key: `filler-${i}`,
        kind: 'conversation_note',
        at: t,
        text: `Conversation with ${a} and ${b} at ${pick(F_PLACES)}\n${a} talked about ${pick(F_TOPICS)}, and ${b} about ${pick(F_TOPICS)}.\nTopics: ${pick(F_TOPICS)}`,
        filler: true,
      };
    } else if (kind < 0.8) {
      m = {
        key: `filler-${i}`,
        kind: 'note',
        at: t,
        text: `${pick(F_NOTES)} (${pick(F_PLACES)})`,
        filler: true,
      };
    } else {
      m = { key: `filler-${i}`, kind: 'photo', at: t, text: pick(F_PHOTOS), filler: true };
    }
    out.push(m);
  }
  return out;
}

/** The signal memories plus filler up to [total] rows. */
export function benchMemories(now: Date, total: number): BenchMemory[] {
  const signal = signalMemories(now);
  return [...signal, ...fillerMemories(now, Math.max(0, total - signal.length))];
}
