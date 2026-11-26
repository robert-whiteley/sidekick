/**
 * The answers + routing bench: fixed prompts with checkable expected results. All content is
 * made up. Scored by src/engine/answers-bench-logic.ts, offline by __tests__/answers-bench-test.ts
 * (rules and the router's offered tools) and on the phone by the dev bench screen (the model's
 * routing choice, answers and speed).
 *
 * route: the canonical tool the request must reach ('none' = a normal answer, no tool).
 *   Several allowed: 'weather|none'. Canonical names: the router's tool names (tools-logic.ts)
 *   plus rule-only ones: remember, translate, quick_answer, help, repeat, feedback.
 * args: canonical arguments to check (strings are case-insensitive regexes, numbers exact).
 * answer: regexes (case-insensitive) the answer text must match (all of `all`, one of `any`)
 *   and must not match (`not`). {weekday} {date} {month} {year} {tomorrowWeekday}
 *   {daysToChristmas} {christmasWeekday} are filled in from the time of the run.
 * lookup: what the online-lookup rules decide for this question with lookup on.
 */
export type BenchCase = {
  id: string;
  cat:
    | 'knowledge'
    | 'arithmetic'
    | 'dates'
    | 'units'
    | 'reasoning'
    | 'tool'
    | 'near_miss'
    | 'refusal'
    | 'multi_step';
  q: string;
  route: string;
  args?: Record<string, string | number | boolean>;
  answer?: { all?: string[]; any?: string[]; not?: string[] };
  lookup?: 'lookup' | 'none' | 'ask-model';
  /** For multi-step: the tools a full chain should use, in order. */
  chain?: string[];
};

const k = (id: string, q: string, any: string[], extra: Partial<BenchCase> = {}): BenchCase => ({
  id,
  cat: 'knowledge',
  q,
  route: 'none',
  answer: { any },
  ...extra,
});

export const CASES: BenchCase[] = [
  // --- General knowledge ---
  k('k-capital-france', 'What is the capital of France?', ['\\bparis\\b']),
  k('k-largest-planet', 'Which is the largest planet in our solar system?', ['jupiter']),
  k('k-romeo', 'Who wrote Romeo and Juliet?', ['shakespeare']),
  k('k-boil', 'At what temperature does water boil in Celsius?', ['\\b100\\b', 'one hundred']),
  k('k-gold', 'What is the chemical symbol for gold?', ['\\bau\\b']),
  k('k-continents', 'How many continents are there?', ['\\b7\\b', '\\bseven\\b']),
  k('k-everest', 'What is the tallest mountain in the world?', ['everest']),
  k('k-1984', 'Who wrote the novel 1984?', ['orwell']),
  k('k-photosynthesis', 'What is photosynthesis?', ['light', 'sun']),
  k('k-mona-lisa', 'Who painted the Mona Lisa?', ['leonardo', 'da vinci']),
  k('k-spider', 'How many legs does a spider have?', ['\\b8\\b', '\\beight\\b']),
  k('k-ocean', 'What is the largest ocean on Earth?', ['pacific']),
  k('k-brazil', 'What language do people speak in Brazil?', ['portuguese']),
  k('k-freeze-f', 'What is the freezing point of water in Fahrenheit?', ['\\b32\\b']),
  k('k-sky', 'Why is the sky blue?', ['scatter', 'wavelength', 'blue light']),

  // --- Arithmetic (exact; most go to the sums rule, the word problems to the model) ---
  {
    id: 'a-times',
    cat: 'arithmetic',
    q: "What's 17 times 23?",
    route: 'quick_answer',
    answer: { any: ['\\b391\\b'] },
  },
  {
    id: 'a-percent',
    cat: 'arithmetic',
    q: 'What is 15% of 240?',
    route: 'quick_answer',
    answer: { any: ['\\b36\\b'] },
  },
  {
    id: 'a-sqrt',
    cat: 'arithmetic',
    q: 'Square root of 144',
    route: 'quick_answer',
    answer: { any: ['\\b12\\b'] },
  },
  {
    id: 'a-divide',
    cat: 'arithmetic',
    q: '1000 divided by 8',
    route: 'quick_answer',
    answer: { any: ['\\b125\\b'] },
  },
  {
    id: 'a-power',
    cat: 'arithmetic',
    q: 'What is 2 to the power of 12?',
    route: 'quick_answer',
    answer: { any: ['4,?096'] },
  },
  {
    id: 'a-order',
    cat: 'arithmetic',
    q: 'What is 7 plus 8 times 2?',
    route: 'quick_answer',
    answer: { any: ['\\b23\\b'] },
  },
  {
    id: 'a-squared',
    cat: 'arithmetic',
    q: 'What is 12 squared?',
    route: 'quick_answer|none',
    answer: { any: ['\\b144\\b'] },
  },
  {
    id: 'a-half',
    cat: 'arithmetic',
    q: "What's half of 87?",
    route: 'quick_answer|none',
    answer: { any: ['43\\.5', '43 and a half'] },
  },
  {
    id: 'a-apples',
    cat: 'arithmetic',
    q: 'If I have 3 apples and buy 5 more, how many apples do I have?',
    route: 'none|quick_answer',
    answer: { any: ['\\b8\\b', '\\beight\\b'] },
  },
  {
    id: 'a-bill',
    cat: 'arithmetic',
    q: 'Split an 84 pound bill between 4 people. How much each?',
    route: 'none|quick_answer',
    answer: { any: ['\\b21\\b', 'twenty-one'] },
  },
  {
    id: 'a-minutes',
    cat: 'arithmetic',
    q: 'How many minutes are there in 3 hours?',
    route: 'none|quick_answer',
    answer: { any: ['\\b180\\b'] },
  },
  {
    id: 'a-9pct',
    cat: 'arithmetic',
    q: "What's 9 percent of 50?",
    route: 'quick_answer',
    answer: { any: ['4\\.5'] },
  },

  // --- Dates and calendar facts ---
  {
    id: 'd-leap-days',
    cat: 'dates',
    q: 'How many days are in a leap year?',
    route: 'none|quick_answer',
    answer: { any: ['\\b366\\b', 'three hundred (and )?sixty-?six'], not: ['thirty-six days'] },
  },
  {
    id: 'd-leap-2028',
    cat: 'dates',
    q: 'Is 2028 a leap year?',
    route: 'none|quick_answer',
    answer: { any: ['\\byes\\b', '\\bis a leap year'], not: ['not a leap', "isn't a leap"] },
  },
  {
    id: 'd-leap-2026',
    cat: 'dates',
    q: 'Is 2026 a leap year?',
    route: 'none|quick_answer',
    answer: { any: ['\\bno\\b', 'not a leap', "isn't a leap"] },
  },
  {
    id: 'd-feb-2028',
    cat: 'dates',
    q: 'How many days does February 2028 have?',
    route: 'none|quick_answer',
    answer: { any: ['\\b29\\b', 'twenty-nine'] },
  },
  {
    id: 'd-today-weekday',
    cat: 'dates',
    q: 'What day is it today?',
    route: 'none|quick_answer',
    answer: { any: ['{weekday}'] },
  },
  {
    id: 'd-today-date',
    cat: 'dates',
    q: "What's the date today?",
    route: 'none|quick_answer',
    answer: { all: ['{month}', '\\b{date}(st|nd|rd|th)?\\b'] },
  },
  {
    id: 'd-year',
    cat: 'dates',
    q: 'What year is it?',
    route: 'none|quick_answer',
    answer: { any: ['{year}'] },
  },
  {
    id: 'd-tomorrow',
    cat: 'dates',
    q: 'What day of the week is it tomorrow?',
    route: 'none|quick_answer',
    answer: { any: ['{tomorrowWeekday}'] },
  },
  {
    id: 'd-christmas-days',
    cat: 'dates',
    q: 'How many days until Christmas?',
    route: 'none|quick_answer',
    answer: { any: ['\\b{daysToChristmas}\\b'] },
  },
  {
    id: 'd-christmas-weekday',
    cat: 'dates',
    q: 'What day of the week is Christmas Day this year?',
    route: 'none|quick_answer',
    answer: { any: ['{christmasWeekday}'] },
  },
  {
    id: 'd-y2k',
    cat: 'dates',
    q: 'What day of the week was 1 January 2000?',
    route: 'none|quick_answer',
    answer: { any: ['saturday'] },
  },
  {
    id: 'd-april',
    cat: 'dates',
    q: 'How many days are in April?',
    route: 'none|quick_answer',
    answer: { any: ['\\b30\\b', '\\bthirty\\b'] },
  },
  {
    id: 'd-weeks',
    cat: 'dates',
    q: 'How many weeks are in a year?',
    route: 'none|quick_answer',
    answer: { any: ['\\b52\\b', 'fifty-two'] },
  },
  {
    id: 'd-after-sep',
    cat: 'dates',
    q: 'Which month comes after September?',
    route: 'none|quick_answer',
    answer: { any: ['october'] },
  },

  // --- Units ---
  {
    id: 'u-miles',
    cat: 'units',
    q: 'Convert 5 miles to km',
    route: 'quick_answer',
    answer: { any: ['8\\.0[45]'] },
  },
  {
    id: 'u-fahrenheit',
    cat: 'units',
    q: 'What is 100 Fahrenheit in Celsius?',
    route: 'quick_answer',
    answer: { any: ['37\\.[78]'] },
  },
  {
    id: 'u-kg',
    cat: 'units',
    q: 'How many pounds is 2 kg?',
    route: 'quick_answer|none',
    answer: { any: ['4\\.4'] },
  },
  {
    id: 'u-cm',
    cat: 'units',
    q: '30 cm in inches',
    route: 'quick_answer',
    answer: { any: ['11\\.8'] },
  },
  {
    id: 'u-km',
    cat: 'units',
    q: 'Convert 10 kilometres to miles',
    route: 'quick_answer',
    answer: { any: ['6\\.2'] },
  },
  {
    id: 'u-kph',
    cat: 'units',
    q: '72 km/h in mph',
    route: 'quick_answer|none',
    answer: { any: ['44\\.7', '\\b45\\b'] },
  },
  {
    id: 'u-litres',
    cat: 'units',
    q: 'How many millilitres are in 2.5 litres?',
    route: 'quick_answer|none',
    answer: { any: ['2,?500'] },
  },
  {
    id: 'u-stone',
    cat: 'units',
    q: 'What is 70 kg in stone?',
    route: 'quick_answer|none',
    answer: { any: ['11\\.0', '\\b11 stone', '11\\.02'] },
  },

  // --- Short reasoning ---
  {
    id: 'r-shortest',
    cat: 'reasoning',
    q: 'Tom is taller than Sam, and Sam is taller than Ali. Who is the shortest?',
    route: 'none',
    answer: { any: ['\\bali\\b'], not: ['\\btom is the shortest', '\\bsam is the shortest'] },
  },
  {
    id: 'r-feathers',
    cat: 'reasoning',
    q: 'Which is heavier, a kilo of feathers or a kilo of bricks?',
    route: 'none',
    answer: { any: ['same', 'neither', 'equal', 'both weigh'] },
  },
  {
    id: 'r-meeting-end',
    cat: 'reasoning',
    q: 'My meeting starts at 2pm and lasts 90 minutes. When does it end?',
    route: 'none',
    answer: { any: ['3:30', '3\\.30', 'half past three', '15:30'] },
  },
  {
    id: 'r-sequence',
    cat: 'reasoning',
    q: "What's the next number: 2, 4, 8, 16?",
    route: 'none|quick_answer',
    answer: { any: ['\\b32\\b'] },
  },
  {
    id: 'r-days-ahead',
    cat: 'reasoning',
    q: 'If today is Thursday, what day will it be in 3 days?',
    route: 'none',
    answer: { any: ['sunday'] },
  },
  {
    id: 'r-train',
    cat: 'reasoning',
    q: 'A train leaves at 9:40 and the trip takes 2 hours 35 minutes. When does it arrive?',
    route: 'none',
    answer: { any: ['12:15', '12\\.15', 'quarter past twelve'] },
  },
  {
    id: 'r-overnight',
    cat: 'reasoning',
    q: 'How many hours are there from 10pm to 6am?',
    route: 'none|quick_answer',
    answer: { any: ['\\b8\\b', '\\beight\\b'] },
  },
  {
    id: 'r-bat-ball',
    cat: 'reasoning',
    q: 'A bat and a ball cost 1.10 in total. The bat costs 1.00 more than the ball. How much is the ball?',
    route: 'none',
    answer: { any: ['0\\.05', '5 ?p', 'five pence', '5 cents', 'five cents'] },
  },

  // --- Tools and commands ---
  // Timers and alarms
  {
    id: 't-timer-10',
    cat: 'tool',
    q: 'Set a timer for 10 minutes',
    route: 'timer',
    args: { seconds: 600 },
  },
  {
    id: 't-timer-pasta',
    cat: 'tool',
    q: 'Timer 5 mins for the pasta',
    route: 'timer',
    args: { seconds: 300 },
  },
  {
    id: 't-timer-90s',
    cat: 'tool',
    q: 'Start a countdown of 90 seconds',
    route: 'timer',
    args: { seconds: 90 },
  },
  {
    id: 't-timer-polite',
    cat: 'tool',
    q: 'Can you start a 25 minute timer?',
    route: 'timer',
    args: { seconds: 1500 },
  },
  {
    id: 't-timer-half-hour',
    cat: 'tool',
    q: 'Put a timer on for half an hour',
    route: 'timer',
    args: { seconds: 1800 },
  },
  {
    id: 't-alarm-7',
    cat: 'tool',
    q: 'Wake me up at 7am',
    route: 'alarm',
    args: { hour: 7, minute: 0 },
  },
  {
    id: 't-alarm-630',
    cat: 'tool',
    q: 'Set an alarm for 6:30',
    route: 'alarm',
    args: { hour: 6, minute: 30 },
  },
  // Reminders and to-dos
  {
    id: 't-remind-dentist',
    cat: 'tool',
    q: 'Remind me to call the dentist tomorrow at 9',
    route: 'reminder',
    args: { what: 'dentist', timed: true },
  },
  {
    id: 't-remind-oven',
    cat: 'tool',
    q: 'Remind me in 20 minutes to check the oven',
    route: 'reminder',
    args: { what: 'oven', timed: true },
  },
  {
    id: 't-forget-milk',
    cat: 'tool',
    q: "Don't let me forget to buy milk",
    route: 'reminder',
    args: { what: 'milk' },
  },
  {
    id: 't-todo-bread',
    cat: 'tool',
    q: 'Add bread to my to-do list',
    route: 'reminder',
    args: { what: 'bread' },
  },
  // Routines, including one-offs
  {
    id: 't-routine-recap',
    cat: 'tool',
    q: 'Every day at 6pm give me a recap of my day',
    route: 'routine',
    args: { repeat: true },
  },
  {
    id: 't-routine-sam',
    cat: 'tool',
    q: 'Whenever Sam messages me, read it out',
    route: 'routine',
    args: { repeat: true },
  },
  {
    id: 't-routine-once-fact',
    cat: 'tool',
    q: 'In one minute, tell me a fun fact',
    route: 'routine',
    args: { repeat: false },
  },
  {
    id: 't-routine-once-stretch',
    cat: 'tool',
    q: 'In 10 minutes tell me to stretch',
    route: 'routine|reminder',
  },
  {
    id: 't-routine-monday',
    cat: 'tool',
    q: 'Every Monday at 8 tell me the weather',
    route: 'routine',
    args: { repeat: true },
  },
  {
    id: 't-routine-once-5pm',
    cat: 'tool',
    q: 'At 5pm today give me a summary of my afternoon',
    route: 'routine',
    args: { repeat: false },
  },
  // Camera settings by asking
  {
    id: 't-cam-fewer',
    cat: 'tool',
    q: 'Lower the frame rate',
    route: 'camera_setting',
    args: { frames: 'fewer' },
  },
  {
    id: 't-cam-front',
    cat: 'tool',
    q: 'Switch to the front camera',
    route: 'camera_setting',
    args: { lens: 'front' },
  },
  {
    id: 't-cam-detail',
    cat: 'tool',
    q: 'Use a higher resolution for the camera',
    route: 'camera_setting',
    args: { detail: 'high' },
  },
  {
    id: 't-cam-more',
    cat: 'tool',
    q: 'Take more frames per second',
    route: 'camera_setting',
    args: { frames: 'more' },
  },
  {
    id: 't-cam-flip',
    cat: 'tool',
    q: 'Flip the camera',
    route: 'camera_setting',
    args: { lens: 'flip' },
  },
  // Settings changes
  { id: 't-speak-slower', cat: 'tool', q: 'Speak slower', route: 'speech_speed' },
  { id: 't-talk-faster', cat: 'tool', q: 'Talk a bit faster please', route: 'speech_speed' },
  {
    id: 't-speed-120',
    cat: 'tool',
    q: 'Set speech speed to 120%',
    route: 'speech_speed',
    args: { rate: 1.2 },
  },
  {
    id: 't-torch',
    cat: 'tool',
    q: 'Turn on the torch',
    route: 'phone_setting',
    args: { setting: 'torch' },
  },
  {
    id: 't-volume',
    cat: 'tool',
    q: 'Turn the volume up',
    route: 'phone_setting',
    args: { setting: 'volume' },
  },
  {
    id: 't-stop-listening',
    cat: 'tool',
    q: 'Stop listening',
    route: 'listening',
    args: { on: false },
  },
  {
    id: 't-camera-off',
    cat: 'tool',
    q: 'Turn off the camera',
    route: 'camera',
    args: { on: false },
  },
  // Navigation
  {
    id: 't-nav-station',
    cat: 'tool',
    q: 'Navigate to the train station',
    route: 'navigate',
    args: { destination: 'train station' },
  },
  {
    id: 't-nav-take-me',
    cat: 'tool',
    q: 'Take me to Fernhill Garden Centre',
    route: 'navigate',
    args: { destination: 'fernhill' },
  },
  {
    id: 't-nav-bus',
    cat: 'tool',
    q: 'How do I get to the airport by bus?',
    route: 'navigate',
    args: { destination: 'airport', mode: 'transit' },
  },
  // Memory search, notes, recap
  {
    id: 't-mem-boiler',
    cat: 'tool',
    q: 'What did Priya say about the boiler?',
    route: 'memory_search|none',
  },
  { id: 't-mem-tom', cat: 'tool', q: 'When did I last see Tom?', route: 'memory_search|none' },
  {
    id: 't-mem-locker',
    cat: 'tool',
    q: "What's my locker code?",
    route: 'memory_search|none',
  },
  {
    id: 't-note-locker',
    cat: 'tool',
    q: 'Remember that my locker code is 4417',
    route: 'remember',
  },
  {
    id: 't-note-bike',
    cat: 'tool',
    q: 'Remember my bike lock combination is 2580',
    route: 'remember',
  },
  { id: 't-recap-day', cat: 'tool', q: 'Recap my day', route: 'recap' },
  {
    id: 't-recap-yesterday',
    cat: 'tool',
    q: 'What did we talk about yesterday?',
    route: 'recap|memory_search',
  },
  { id: 't-recap-2h', cat: 'tool', q: 'Summarise the last two hours', route: 'recap' },
  // Steps, battery, storage
  {
    id: 't-steps',
    cat: 'tool',
    q: 'How many steps have I done today?',
    route: 'phone_info',
    args: { what: 'steps' },
  },
  {
    id: 't-battery',
    cat: 'tool',
    q: "What's my battery at?",
    route: 'phone_info',
    args: { what: 'battery' },
  },
  {
    id: 't-storage',
    cat: 'tool',
    q: 'How much storage is left on my phone?',
    route: 'phone_info',
    args: { what: 'storage' },
  },
  // Weather and online lookup
  { id: 't-rain', cat: 'tool', q: 'Will it rain tomorrow?', route: 'weather' },
  {
    id: 't-weather-town',
    cat: 'tool',
    q: "What's the weather like in Bristol this weekend?",
    route: 'weather',
  },
  {
    id: 't-lookup-news',
    cat: 'tool',
    q: "What's the latest news about electric cars?",
    route: 'none',
    lookup: 'lookup',
  },
  {
    id: 't-lookup-who',
    cat: 'tool',
    q: 'Who won the 2022 football World Cup?',
    route: 'none',
    lookup: 'lookup',
    answer: { any: ['argentina'] },
  },
  {
    id: 't-lookup-explicit',
    cat: 'tool',
    q: 'Look up the opening hours of the British Museum',
    route: 'none',
    lookup: 'lookup',
  },
  {
    id: 't-lookup-personal',
    cat: 'tool',
    q: 'What did I have for lunch yesterday?',
    route: 'memory_search|none|recap',
    lookup: 'none',
  },
  // Messages, calls, email (drafts only; never sent)
  {
    id: 't-text-sam',
    cat: 'tool',
    q: "Text Sam I'm running late",
    route: 'message',
    args: { to: 'sam', text: 'late' },
  },
  { id: 't-call-mum', cat: 'tool', q: 'Call Mum', route: 'call', args: { to: 'mum' } },
  {
    id: 't-email-jo',
    cat: 'tool',
    q: 'Email Jo that the meeting moved to Friday',
    route: 'email',
    args: { to: 'jo' },
  },
  {
    id: 't-event',
    cat: 'tool',
    q: 'Add lunch with Dana on Friday at 1pm to my calendar',
    route: 'event',
    args: { title: 'lunch' },
  },
  // Location, watches, help
  { id: 't-where-now', cat: 'tool', q: 'Where am I?', route: 'location' },
  { id: 't-parked', cat: 'tool', q: 'Where did I park?', route: 'location' },
  {
    id: 't-watch-bus',
    cat: 'tool',
    q: 'Tell me when you see a bus',
    route: 'watch',
    args: { what: 'bus' },
  },
  { id: 't-help', cat: 'tool', q: 'What can you do?', route: 'help' },
  { id: 't-repeat', cat: 'tool', q: 'Say that again', route: 'repeat' },
  {
    id: 't-play',
    cat: 'tool',
    q: 'Play some jazz on Spotify',
    route: 'play|app_search',
  },
  // Rephrased requests the rules don't know (the model router's job)
  {
    id: 't-phr-timer',
    cat: 'tool',
    q: "Give me a shout in a quarter of an hour, the tea's brewing",
    route: 'timer|reminder|routine',
  },
  {
    id: 't-phr-cam',
    cat: 'tool',
    q: 'The camera is eating my battery, make it grab fewer pictures',
    route: 'camera_setting',
    args: { frames: 'fewer' },
  },
  {
    id: 't-phr-selfie',
    cat: 'tool',
    q: 'Use the selfie camera',
    route: 'camera_setting',
    args: { lens: 'front' },
  },
  {
    id: 't-phr-quiet',
    cat: 'tool',
    q: "It's too loud, bring the volume down",
    route: 'phone_setting',
    args: { setting: 'volume' },
  },

  // --- Near misses: must NOT trigger a tool ---
  { id: 'n-timers', cat: 'near_miss', q: 'Tell me about timers', route: 'none' },
  { id: 'n-alarm-clock', cat: 'near_miss', q: 'What is an alarm clock?', route: 'none' },
  { id: 'n-sleep-tips', cat: 'near_miss', q: 'Give me three tips for better sleep', route: 'none' },
  { id: 'n-poem', cat: 'near_miss', q: 'Write a short poem about autumn', route: 'none' },
  { id: 'n-joke', cat: 'near_miss', q: 'Tell me a joke', route: 'none' },
  { id: 'n-recipe', cat: 'near_miss', q: "What's a good recipe for pasta?", route: 'none' },
  {
    id: 'n-alarm-statement',
    cat: 'near_miss',
    q: 'The alarm went off too early this morning',
    route: 'none|memory_search',
  },
  {
    id: 'n-camera-love',
    cat: 'near_miss',
    q: 'I love the camera on this phone',
    route: 'none',
  },
  {
    id: 'n-routine-word',
    cat: 'near_miss',
    q: 'What does the word routine mean?',
    route: 'none',
  },
  {
    id: 'n-gps',
    cat: 'near_miss',
    q: 'Explain how GPS navigation works',
    route: 'none',
  },
  {
    id: 'n-reminder-history',
    cat: 'near_miss',
    q: 'Why do people forget things as they get older?',
    route: 'none',
  },
  {
    id: 'n-music-history',
    cat: 'near_miss',
    q: 'Who invented the electric guitar?',
    route: 'none',
  },
  {
    id: 'n-weather-mars',
    cat: 'near_miss',
    q: "What's the weather like on Mars?",
    route: 'none',
  },
  {
    id: 'n-battery-how',
    cat: 'near_miss',
    q: 'How do lithium batteries work?',
    route: 'none',
  },

  // --- Refusals and mix-ups: never a message to the user themselves ---
  {
    id: 'x-text-me',
    cat: 'refusal',
    q: 'Text me a fun fact',
    route: 'none',
    answer: { not: ['message to me', 'text to me'] },
  },
  {
    id: 'x-message-me',
    cat: 'refusal',
    q: 'Send me a message with a joke',
    route: 'none',
    answer: { not: ['message to me'] },
  },
  {
    id: 'x-call-me',
    cat: 'refusal',
    q: 'Call me',
    route: 'none',
  },
  {
    id: 'x-email-myself',
    cat: 'refusal',
    q: 'Email myself a note to buy stamps',
    route: 'reminder|none|email',
    args: {},
  },
  {
    id: 'x-tell-me-later',
    cat: 'refusal',
    q: 'Tell me a fun fact about otters',
    route: 'none',
  },

  // --- Multi-step ---
  {
    id: 'm-text-dentist',
    cat: 'multi_step',
    q: 'Text Sam when my dentist appointment is',
    route: 'memory_search|message',
    chain: ['memory_search', 'message'],
  },
  {
    id: 'm-weather-remind',
    cat: 'multi_step',
    q: "Check tomorrow's weather and remind me to take an umbrella if it rains",
    route: 'weather|reminder',
    chain: ['weather', 'reminder'],
  },
  {
    id: 'm-battery-torch',
    cat: 'multi_step',
    q: 'Check my battery and then turn on the torch',
    route: 'phone_info|phone_setting',
    chain: ['phone_info', 'phone_setting'],
  },
  {
    id: 'm-timer-then',
    cat: 'multi_step',
    q: 'Set a 5 minute timer and then tell me a joke',
    route: 'timer',
    args: { seconds: 300 },
  },
];
