/**
 * Background-task bench for thinking mode (docs/BENCH.md, "Rules vs model, thinking"): the app's
 * own prompts for conversation notes, fact suggestions, who-is-who, recaps and photo reading, on
 * made-up material. Each reply is scored by regexes (case-insensitive): every `all` pattern must
 * match (what should be kept) and no `not` pattern (what was never said). Photos are made-up
 * pictures pushed to the phone by bench/answers/run-decide.sh (bench/answers/photos.py).
 */
export type BgTask = 'notes' | 'facts' | 'names' | 'recap' | 'photo';
export type BgCase = {
  id: string;
  task: BgTask;
  /** Heard lines as "Who: text" (notes, facts, names, recap), or the photo's file name. */
  input: string[];
  all: string[];
  not?: string[];
};

export const BG_CASES: BgCase[] = [
  // --- Conversation notes (notePrompt) ---
  {
    id: 'n-dentist',
    task: 'notes',
    input: [
      'Me: Hi, I have a check-up booked with Dr Okafor.',
      'Person 1: Yes, Tuesday the 9th at 3 pm. Can you come ten minutes early?',
      'Me: Sure. Do I need to bring anything?',
      'Person 1: Your new insurance card, please. And it is 45 pounds if the card is not ready.',
      'Me: Fine, I will bring it.',
    ],
    all: ['tuesday|9th', '3 ?pm|15', 'insurance card', '45'],
    not: ['wednesday', '50 pounds'],
  },
  {
    id: 'n-project',
    task: 'notes',
    input: [
      'Lena: So we agreed to move the launch to the 14th of March.',
      'Me: Yes. I will write the release notes by Thursday.',
      'Lena: And Tom sends the new logo to the printer tomorrow.',
      'Me: Already done, he sent it this morning.',
      'Lena: Great. Budget stays at 12,000.',
    ],
    all: ['14(th)? (of )?march|march 14', 'release notes', 'thursday', 'logo', '12,?000'],
    not: ['april', '15,?000'],
  },
  {
    id: 'n-plumber',
    task: 'notes',
    input: [
      'Person 1: The leak is from the valve under the sink, not the pipe.',
      'Me: How much to replace it?',
      'Person 1: 80 for the part and an hour of work, so about 140 in total.',
      'Me: OK, can you do Friday morning?',
      'Person 1: Friday at 8, yes.',
    ],
    all: ['valve', '140', 'friday', '\\b8\\b|8 ?am|08'],
    not: ['saturday', '\\b200\\b'],
  },
  // --- Fact suggestions (factPrompt) ---
  {
    id: 'f-gate',
    task: 'facts',
    input: [
      'Me: The gate code for the new flat is 4 8 1 9.',
      'Me: Ugh, the bus was late again.',
      "Me: Mia's birthday is on the 3rd of June.",
      'Me: I think it might rain later.',
    ],
    all: ['4 ?8 ?1 ?9', 'mia', 'june'],
    not: ['rain', 'bus'],
  },
  {
    id: 'f-allergy',
    task: 'facts',
    input: [
      'Me: Remember, Jonas is allergic to peanuts.',
      'Me: Pass me the salt.',
      'Me: My locker number at the gym is 212.',
    ],
    all: ['jonas.*peanut|peanut.*jonas', '212'],
    not: ['salt'],
  },
  {
    id: 'f-none',
    task: 'facts',
    input: [
      'Me: What a long day.',
      'Me: Can you turn the music down a bit?',
      'Me: Nice weather today.',
    ],
    all: ['^\\s*none\\s*\\.?\\s*$'],
  },
  // --- Who is who (namePrompt) ---
  {
    id: 'w-cafe',
    task: 'names',
    input: [
      'Person 1: Hi, are you ready to order?',
      'Me: Yes, a flat white please. Person 2, what do you want?',
      'Person 2: A tea for me, thanks. Thanks Ravi, you always remember my order.',
      'Person 1: No problem, coming right up.',
    ],
    all: ['person 1.*(waiter|barista|server)', 'person 1.*ravi'],
  },
  {
    id: 'w-intro',
    task: 'names',
    input: [
      'Person 1: This is my sister, Ayla. She just moved here.',
      'Person 2: Hi! Nice to meet you.',
      'Me: Welcome, Ayla. Where did you move from?',
      'Person 2: From Leeds.',
    ],
    all: ['person 2.*ayla'],
    not: ['person 1[^\\n]*ayla'],
  },
  // --- Recaps (recapPrompt) ---
  {
    id: 'r-day',
    task: 'recap',
    input: [
      'Me: Can you pick up the kids at 4 today?',
      'Person 1: Yes, and I will get milk on the way.',
      'Me: The car needs its MOT before the 20th.',
      'Person 1: I will book it for Monday.',
      'Me: Thanks. Dinner with the Patels is on Saturday at 7.',
    ],
    all: ['kids|children', '\\b4\\b', 'milk', 'mot', 'monday', 'patel', 'saturday'],
    not: ['sunday'],
  },
  {
    id: 'r-work',
    task: 'recap',
    input: [
      'Lena: The client wants the report a week earlier, on the 2nd.',
      'Me: Then I need the figures from Tom by Wednesday.',
      'Lena: I will ask him today. We also lost the venue for the workshop.',
      'Me: Let us try the library room instead.',
    ],
    all: ['report', '2nd|second', 'tom', 'wednesday', 'venue|workshop', 'library'],
    not: ['cancel(l)?ed the report'],
  },
  // --- Photo reading (DESCRIBE_PROMPT), pictures made by photos.py ---
  {
    id: 'p-sign',
    task: 'photo',
    input: ['sign.png'],
    all: ['platform\\s*4', 'brackley'],
  },
  {
    id: 'p-receipt',
    task: 'photo',
    input: ['receipt.png'],
    all: ['17\\.85', 'oat milk'],
  },
  {
    id: 'p-label',
    task: 'photo',
    input: ['label.png'],
    all: ['2 tablets', 'every 6 hours|6 hours'],
  },
  {
    id: 'p-note',
    task: 'photo',
    input: ['note.png'],
    all: ['wifi|wi-fi', 'tulip-garden-58'],
  },
];
