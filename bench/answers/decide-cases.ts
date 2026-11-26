/**
 * Extra routing cases for "rules vs model" (docs/BENCH.md): the same intents as cases.ts in
 * other words, other languages and unusual phrasings, plus requests that only look like
 * commands. All content is made up.
 *
 * want: the allowed decisions, "|"-separated: "answer", "lookup" (needs the internet, scored
 * with lookup on) or "do:<tool>" (a tools-logic.ts tool name).
 */
export type DecideCase = {
  id: string;
  q: string;
  want: string;
  /** What kind of wording it tests. */
  kind: 'paraphrase' | 'other_language' | 'near_miss' | 'lookup' | 'answer';
};

const c = (id: string, kind: DecideCase['kind'], q: string, want: string): DecideCase => ({
  id,
  kind,
  q,
  want,
});

export const DECIDE_CASES: DecideCase[] = [
  // --- The same tools, other words (the rules mostly miss these) ---
  c('p-timer-eggs', 'paraphrase', 'Pop a seven minute countdown on for the eggs', 'do:timer'),
  c(
    'p-timer-shout',
    'paraphrase',
    'Give me a shout in a quarter of an hour',
    'do:timer|do:reminder|do:routine',
  ),
  c('p-alarm-half-six', 'paraphrase', 'Could you get me up at half six tomorrow?', 'do:alarm'),
  c(
    'p-reminder-bins',
    'paraphrase',
    'I need a nudge about the bins on Thursday evening',
    'do:reminder',
  ),
  c(
    'p-reminder-forget',
    'paraphrase',
    "Make sure I don't forget Wren's parcel later",
    'do:reminder',
  ),
  c('p-message-ping', 'paraphrase', "Ping Marisol that I'm stuck in traffic", 'do:message'),
  c(
    'p-message-drop',
    'paraphrase',
    'Drop Teodor a line saying the keys are under the mat',
    'do:message|do:email',
  ),
  c('p-call-ring', 'paraphrase', 'Give Ottilie a ring', 'do:call'),
  c(
    'p-email-shoot',
    'paraphrase',
    'Shoot an email to Halvard saying the invoice is attached',
    'do:email',
  ),
  c('p-event-diary', 'paraphrase', 'Pencil in lunch with Bea on Friday at one', 'do:event'),
  c('p-nav-get-to', 'paraphrase', 'How do I get to Larkfield station from here?', 'do:navigate'),
  c('p-ride-cab', 'paraphrase', 'Sort me a cab to the airport', 'do:ride'),
  c('p-play-jazz', 'paraphrase', 'Stick on some jazz', 'do:play'),
  c('p-media-skip', 'paraphrase', "Skip this song, it's awful", 'do:media'),
  c('p-torch-kill', 'paraphrase', 'Kill the flashlight', 'do:phone_setting'),
  c('p-volume-down', 'paraphrase', "It's way too loud, bring it down a notch", 'do:phone_setting'),
  c('p-battery-low', 'paraphrase', 'Is my phone about to die?', 'do:phone_info'),
  c('p-weather-brolly', 'paraphrase', 'Will I need a brolly tomorrow?', 'do:weather'),
  c('p-watch-bike', 'paraphrase', 'Shout if a red bicycle turns up on camera', 'do:watch'),
  c('p-slower', 'paraphrase', "You're talking too fast for me", 'do:speech_speed'),
  c(
    'p-search-yt',
    'paraphrase',
    'Find me some origami crane videos on YouTube',
    'do:app_search|do:play',
  ),
  c('p-routine-weekday', 'paraphrase', 'On weekdays at 7 read me the headlines', 'do:routine'),
  c('p-listen-off', 'paraphrase', 'Stop eavesdropping for now', 'do:listening'),
  c('p-open-app', 'paraphrase', 'Bring up the calculator app', 'do:open_app'),
  c('p-where-am-i', 'paraphrase', "What's this town called, where am I?", 'do:location'),
  c('p-fewer-frames', 'paraphrase', 'Make the camera grab fewer pictures', 'do:camera_setting'),

  // --- Other languages (Sidekick is English-only for now, ADR 0006; robustness only) ---
  c('l-de-timer', 'other_language', 'Stell einen Timer auf zehn Minuten', 'do:timer'),
  c('l-es-alarm', 'other_language', 'Pon una alarma a las siete de la mañana', 'do:alarm'),
  c(
    'l-fr-message',
    'other_language',
    "Envoie un message à Céline : j'arrive dans dix minutes",
    'do:message',
  ),
  c('l-it-torch', 'other_language', 'Accendi la torcia', 'do:phone_setting'),
  c('l-fr-capital', 'other_language', 'Quelle est la capitale du Japon ?', 'answer'),
  c('l-de-knowledge', 'other_language', 'Warum ist der Himmel blau?', 'answer'),
  c('l-es-joke', 'other_language', 'Cuéntame un chiste', 'answer'),
  c('l-nl-weather', 'other_language', 'Gaat het morgen regenen?', 'do:weather'),

  // --- Looks like a command, is a question or a request for words ---
  c('n-timer-app', 'near_miss', "What's a good timer app for studying?", 'answer|lookup'),
  c('n-alarm-why', 'near_miss', 'Why do alarms make me feel anxious?', 'answer'),
  c(
    'n-whatsapp-how',
    'near_miss',
    'How do I message someone on WhatsApp without saving their number?',
    'answer|lookup',
  ),
  c(
    'n-write-text',
    'near_miss',
    'Write a text I could send my landlord about the broken heater',
    'answer',
  ),
  c(
    'n-sister-calls',
    'near_miss',
    'My sister keeps calling me at work. How do I ask her to stop?',
    'answer',
  ),
  c('n-lens', 'near_miss', 'Can you explain how a camera lens focuses?', 'answer'),
  c('n-knee', 'near_miss', 'I played football yesterday and now my knee hurts', 'answer'),
  c('n-story', 'near_miss', 'Tell me a story about a lighthouse keeper', 'answer'),
  c('n-playlist-names', 'near_miss', 'Give me five names for a running playlist', 'answer'),
  c('n-email-tips', 'near_miss', 'How should I start an email to a new client?', 'answer'),
  c('n-torch-history', 'near_miss', 'Who invented the flashlight?', 'answer|lookup'),
  c('n-volume-cone', 'near_miss', 'How do you work out the volume of a cone?', 'answer'),
  c('n-recipe', 'near_miss', 'Give me a quick recipe for pancakes', 'answer'),
  c('n-thanks', 'near_miss', 'Thanks, that was really helpful', 'answer'),

  // --- Online lookup or not (scored with lookup on) ---
  c('w-wimbledon', 'lookup', "Who won the most recent men's Wimbledon final?", 'lookup'),
  c('w-mars', 'lookup', "What's the latest news about the Mars sample return mission?", 'lookup'),
  c('w-price', 'lookup', "What's the current price of a Raspberry Pi 5?", 'lookup'),
  c('w-pm', 'lookup', 'Who is the prime minister of Portugal right now?', 'lookup|answer'),
  c('w-octopus', 'answer', 'How many hearts does an octopus have?', 'answer'),
  c('w-priya', 'answer', 'What did Priya say about the boiler?', 'answer'),
  c('w-haiku', 'answer', 'Write a haiku about rain', 'answer'),
  c('w-boil-egg', 'answer', 'How long should I boil an egg for?', 'answer'),
];
