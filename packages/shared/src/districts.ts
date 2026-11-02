// Sri Lanka's 25 districts (docs/DEVELOPMENT.md §7.11): a fixed list in the UI, stored as text.
// Spellings follow the standard English names (e.g. "Monaragala", "Nuwara Eliya"). Display labels,
// and later Sinhala and Tamil names, belong in apps/web/src/lib/strings.ts.

export const SRI_LANKA_DISTRICTS = [
  'Ampara',
  'Anuradhapura',
  'Badulla',
  'Batticaloa',
  'Colombo',
  'Galle',
  'Gampaha',
  'Hambantota',
  'Jaffna',
  'Kalutara',
  'Kandy',
  'Kegalle',
  'Kilinochchi',
  'Kurunegala',
  'Mannar',
  'Matale',
  'Matara',
  'Monaragala',
  'Mullaitivu',
  'Nuwara Eliya',
  'Polonnaruwa',
  'Puttalam',
  'Ratnapura',
  'Trincomalee',
  'Vavuniya',
] as const;

export type SriLankaDistrict = (typeof SRI_LANKA_DISTRICTS)[number];

export function isSriLankaDistrict(value: unknown): value is SriLankaDistrict {
  return typeof value === 'string' && (SRI_LANKA_DISTRICTS as readonly string[]).includes(value);
}

const BY_LOWER_CASE = new Map(
  SRI_LANKA_DISTRICTS.map((district) => [district.toLowerCase(), district]),
);

/**
 * The district with its standard spelling, ignoring case and extra spaces ("  nuwara  eliya" →
 * "Nuwara Eliya"), or null when it isn't one of the 25.
 */
export function toSriLankaDistrict(value: string): SriLankaDistrict | null {
  return BY_LOWER_CASE.get(value.trim().replace(/\s+/g, ' ').toLowerCase()) ?? null;
}
