/**
 * Research (lite) bench: 10 made-up research requests (no personal data). Each has groups of
 * words a good short report would contain (any word in a group counts); the score is the share
 * of groups found. Run on the phone: sidekick://bench?run=research (src/engine/research-bench.ts).
 */
export type ResearchCase = { id: string; q: string; expect: RegExp[] };

export const RESEARCH_CASES: ResearchCase[] = [
  {
    id: 'heatpump',
    q: 'Research how heat pumps work and whether they suit older houses',
    expect: [
      /refrigerant|compressor|outside air|ground/i,
      /insulat|radiator/i,
      /efficien|coefficient|cop\b/i,
    ],
  },
  {
    id: 'bees',
    q: 'Look into the main causes of honey bee decline',
    expect: [
      /pesticide|neonicotinoid/i,
      /varroa|mite|parasite|disease|virus/i,
      /habitat|forage|flower/i,
    ],
  },
  {
    id: 'tidal-wind',
    q: 'Compare tidal power and wind power',
    expect: [/predictab|regular|reliab/i, /cost|expensive/i, /turbine/i],
  },
  {
    id: 'bicycle',
    q: 'Research the history of the bicycle',
    expect: [
      /18[1-9]\d/,
      /draisine|velocipede|penny.farthing|dandy horse|laufmaschine/i,
      /chain|safety bicycle|pneumatic|tyre|tire/i,
    ],
  },
  {
    id: 'jwst',
    q: 'Find out everything about the James Webb Space Telescope',
    expect: [/infrared/i, /2021|launch/i, /mirror|hubble/i, /nasa|esa|csa/i],
  },
  {
    id: 'four-day',
    q: 'Research the pros and cons of a four-day work week',
    expect: [
      /productiv/i,
      /trial|pilot|study|studies/i,
      /wellbeing|well-being|burnout|stress|balance/i,
    ],
  },
  {
    id: 'vaccine-trials',
    q: 'Look into how new vaccines are tested before approval',
    expect: [/phase/i, /trial/i, /safety|side effect|adverse/i, /regulat|approv|licens/i],
  },
  {
    id: 'microplastics',
    q: 'Research what microplastics do in the ocean',
    expect: [
      /5 ?mm|millimet|small/i,
      /fish|marine|animal|plankton|organism/i,
      /ingest|eat|food chain|toxic|chemical/i,
    ],
  },
  {
    id: 'ev-costs',
    q: 'Compare electric and petrol cars on running costs',
    expect: [/electric/i, /fuel|petrol|gasoline/i, /mainten|servic|charg|battery/i],
  },
  {
    id: 'fusion-news',
    q: 'Research the latest news on nuclear fusion energy',
    expect: [/fusion/i, /plasma|tokamak|reactor|iter|laser/i],
  },
];

/** Share of the expected word groups the report contains (0–1). */
export function coverage(text: string, expect: RegExp[]): number {
  return expect.length ? expect.filter((r) => r.test(text)).length / expect.length : 1;
}

/** Every [n] in the report points at a listed source, and at least one is cited. */
export function citationsOk(text: string, sources: number): boolean {
  const nums = [...text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)].flatMap((m) =>
    m[1].split(',').map((n) => Number(n.trim())),
  );
  return nums.length > 0 && nums.every((n) => n >= 1 && n <= sources);
}
