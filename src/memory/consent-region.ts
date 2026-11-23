/**
 * Whether consent mode must be on where the phone is, by recording law for in-person
 * conversations. Not legal advice: where the law is mixed or unclear we require consent, and the
 * user can always override it in Settings.
 */

/** Countries where recording a private conversation needs everyone's agreement (or is unclear). */
const ALL_PARTY_COUNTRIES = new Set([
  // EU / EEA (GDPR, and national criminal law such as Germany §201 StGB)
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'IS',
  'LI',
  'NO',
  'CH', // Art. 179bis StGB
  'AU', // state laws differ (e.g. NSW requires all parties)
]);

/** US states requiring all parties (or where courts disagree), as GeoNames admin1 codes. */
const ALL_PARTY_US_STATES = new Set([
  'CA',
  'CT',
  'DE',
  'FL',
  'IL',
  'MD',
  'MA',
  'MI',
  'MT',
  'NH',
  'OR',
  'PA',
  'WA',
]);

export type Region = { country: string | null; admin1: string | null };

export function lawRequiresConsent({ country, admin1 }: Region): boolean {
  if (!country) return true; // unknown place: be safe
  const c = country.toUpperCase();
  if (c === 'US') return !admin1 || ALL_PARTY_US_STATES.has(admin1.toUpperCase());
  return ALL_PARTY_COUNTRIES.has(c);
}

export type ConsentChoice = 'auto' | 'on' | 'off';

export function consentNeeded(choice: ConsentChoice, region: Region): boolean {
  if (choice === 'on') return true;
  if (choice === 'off') return false;
  return lawRequiresConsent(region);
}
