// Shared reference data for enhancement corrections. Fixed and small enough
// that it does not need its own CRUD table (PRD marks it "seeded reference,
// no CRUD") — this constant IS the seed. Mirrored in
// frontend/src/lib/correctionOptions.ts; keep the two in sync.

export const STRENGTH_VALUES = ['light', 'medium', 'strong'] as const;
export type Strength = (typeof STRENGTH_VALUES)[number];

export interface CorrectionOptionDef {
  key: string;
  label: string;
  helperText: string;
  hasStrength: boolean;
}

export const CORRECTION_OPTIONS: CorrectionOptionDef[] = [
  {
    key: 'darkSpotRemoval',
    label: 'Dark spot removal',
    helperText: 'Fades sun spots and age spots for more even-looking skin.',
    hasStrength: false,
  },
  {
    key: 'blemishRemoval',
    label: 'Blemish removal',
    helperText: 'Clears temporary blemishes and small marks.',
    hasStrength: false,
  },
  {
    key: 'darkCircleReduction',
    label: 'Dark circle reduction',
    helperText: 'Softens shadows under the eyes for a more rested look.',
    hasStrength: false,
  },
  {
    key: 'skinSmoothing',
    label: 'Skin smoothing',
    helperText: 'Evens out texture while keeping natural detail.',
    hasStrength: true,
  },
  {
    key: 'toneEvening',
    label: 'Skin tone evening',
    helperText: 'Balances patchy or uneven skin tone across the face.',
    hasStrength: true,
  },
  {
    key: 'brightness',
    label: 'Brightness adjustment',
    helperText: 'Lifts overall brightness for a fresher, well-lit look.',
    hasStrength: true,
  },
];

export const CORRECTION_OPTION_KEYS = CORRECTION_OPTIONS.map((o) => o.key);
export const STRENGTH_OPTION_KEYS = CORRECTION_OPTIONS.filter((o) => o.hasStrength).map((o) => o.key);

export function isValidOptionKey(key: string): boolean {
  return CORRECTION_OPTION_KEYS.includes(key);
}
