/**
 * Thinking mode bench (docs/BENCH.md, "Rules vs model, thinking"): hard questions where
 * step-by-step reasoning may help, and everyday ones where it should not be needed. Each answer
 * is checked by regexes (case-insensitive; any one must match, none of `not`). Made-up content.
 */
export type ThinkCase = {
  id: string;
  hard: boolean;
  q: string;
  any: string[];
  not?: string[];
};

const h = (id: string, q: string, any: string[], not?: string[]): ThinkCase => ({
  id,
  hard: true,
  q,
  any,
  not,
});
const e = (id: string, q: string, any: string[], not?: string[]): ThinkCase => ({
  id,
  hard: false,
  q,
  any,
  not,
});

export const THINK_CASES: ThinkCase[] = [
  // --- Multi-step maths word problems ---
  h(
    'm-apples',
    'Ines has 3 bags with 12 apples each. She gives away 7 apples and eats 2. How many apples are left?',
    ['\\b27\\b', 'twenty-seven'],
  ),
  h(
    'm-shirts',
    'A shirt costs 24 pounds. It is 25% off, and then I use a 3 pound voucher. What do I pay?',
    ['\\b15\\b', 'fifteen'],
  ),
  h(
    'm-train',
    'A train travels 180 km in 2 hours and then 120 km in 1.5 hours. What is its average speed for the whole trip?',
    ['\\b85\\.7', '\\b85\\.71', '\\b86\\b', '600/7'],
  ),
  h(
    'm-paint',
    'A wall is 4 m by 2.5 m. One tin of paint covers 6 square metres. I need two coats. How many tins must I buy?',
    ['\\b4 tins', '\\bfour tins', '\\b4\\b', '\\bfour\\b'],
  ),
  h(
    'm-ages',
    'Kofi is twice as old as Lena. In 5 years their ages will add up to 40. How old is Lena now?',
    ['\\b10\\b', '\\bten\\b'],
  ),
  h(
    'm-workers',
    'If 3 people paint 3 fences in 3 hours, how many hours do 6 people need to paint 6 fences?',
    ['\\b3\\b', '\\bthree\\b'],
    ['\\b6 hours', '\\bsix hours'],
  ),
  h(
    'm-change',
    'I buy 3 coffees at 2.40 each and a muffin at 1.85, and pay with a 20 pound note. How much change do I get?',
    ['\\b10\\.95\\b'],
  ),
  h(
    'm-recipe',
    'A recipe for 4 people needs 300 g of flour. How much flour do I need for 10 people?',
    ['\\b750\\b'],
  ),
  // --- Logic puzzles ---
  h(
    'l-race',
    'In a race, Mia finished before Jon, Jon finished before Ava, and Ava finished before Leo. Who came third?',
    ['\\bava\\b'],
    ['\\bjon came third', '\\bleo came third'],
  ),
  h(
    'l-socks',
    'A drawer has 10 black socks and 10 white socks. In the dark, how many socks must I take to be sure of a matching pair?',
    ['\\b3\\b', '\\bthree\\b'],
  ),
  h(
    'l-liars',
    'Anna says: "Ben is lying." Ben says: "Cara is lying." Cara says: "Anna and Ben are both lying." Exactly who is telling the truth?',
    [
      'only ben',
      'ben is telling the truth',
      'ben tells the truth',
      'ben is (the only one|truthful)',
    ],
    ['only anna', 'only cara'],
  ),
  h(
    'l-sheep',
    'A farmer has 17 sheep. All but 9 run away. How many sheep are left?',
    ['\\b9\\b', '\\bnine\\b'],
    ['\\b8\\b'],
  ),
  h('l-month', 'Some months have 31 days and some have 30. How many months have 28 days?', [
    '\\b12\\b',
    'twelve',
    'all',
  ]),
  h('l-sister', 'Tom has 3 sisters. Each sister has 1 brother. How many brothers does Tom have?', [
    '\\b0\\b',
    '\\bnone\\b',
    '\\bno brothers',
    'zero',
  ]),
  // --- Planning ---
  h(
    'p-meeting',
    'Ravi is free 9 to 11 and 2 to 4. Sol is free 10 to 12 and 3 to 5. Una is free 10:30 to 3:30. When can all three meet for half an hour?',
    ['10:30', '\\b3(:00)? ?(pm)? to 3:30', '\\b3 and 3:30', '3:00', '\\b3 ?pm'],
  ),
  h(
    'p-trip',
    'I must be at the airport by 6:15 pm. The drive takes 50 minutes and I want 20 minutes spare for parking. What is the latest I can leave?',
    ['\\b5:05\\b', '\\b17:05\\b'],
  ),
  // --- Everyday (thinking should not be needed) ---
  e('e-capital', 'What is the capital of Canada?', ['ottawa']),
  e('e-boil', 'At what temperature does water boil in Fahrenheit?', ['\\b212\\b']),
  e('e-tip', 'Give me one tip for sleeping better.', [
    'sleep',
    'bed',
    'screen',
    'caffeine',
    'routine',
  ]),
  e('e-planet', 'Which planet is known as the red planet?', ['mars']),
  e('e-synonym', 'What is another word for happy?', [
    'joyful',
    'glad',
    'cheerful',
    'content',
    'delighted',
    'pleased',
  ]),
  e('e-rome', 'In which country is Rome?', ['italy']),
  e('e-spider', 'How many legs does an insect have?', ['\\b6\\b', '\\bsix\\b']),
  e('e-joke', 'Tell me a short joke.', ['.']),
];
