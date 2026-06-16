const MODEL_FILES = [
  'balinese_tiltbrush_mask.glb',
  'batman_mask.glb',
  'captain_america_mask.glb',
  'cult_mask.glb',
  'hulk_mask_marvel.glb',
  'mask.glb',
  'plague_mask.glb',
  'spiderman_paperbag_mask.glb',
  'vendetta_mask.glb',
  'venice_mask.glb',
].sort();

const AR_MASK_PREFERRED_KEYWORDS = [
  'vendetta',
  'venice',
  'plague',
  'cult',
  'balinese',
  'mask',
];

const AR_MASK_EXCLUDED_KEYWORDS = [
  'batman',
  'captain',
  'hulk',
  'spiderman',
  'paperbag',
  'helmet',
  'head',
  'fullbody',
  'full_body',
  'avatar',
];

const AR_SAFE_MODEL_FILES = MODEL_FILES.filter((name) => {
  const lower = name.toLowerCase();
  const isExcluded = AR_MASK_EXCLUDED_KEYWORDS.some((keyword) => lower.includes(keyword));
  if (isExcluded) return false;
  return AR_MASK_PREFERRED_KEYWORDS.some((keyword) => lower.includes(keyword));
});

function pickRandom(items: string[]): string | null {
  if (items.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * items.length);
  return items[randomIndex];
}

export function getRandomMaskModelFile(): string | null {
  return pickRandom(MODEL_FILES);
}

export function getMaskModelFiles(): string[] {
  return [...MODEL_FILES];
}

export function getArSafeMaskModelFiles(): string[] {
  return [...AR_SAFE_MODEL_FILES];
}
