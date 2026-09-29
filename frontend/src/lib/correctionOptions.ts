// Mirrors backend/src/lib/correctionOptions.ts — fixed reference data for the
// six enhancement corrections. Keep the two in sync.

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

export function optionLabel(key: string): string {
  return CORRECTION_OPTIONS.find((o) => o.key === key)?.label ?? key;
}
