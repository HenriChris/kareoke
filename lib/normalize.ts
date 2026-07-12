/**
 * Normalizes a string for search indexing/matching:
 * - lowercases
 * - strips accents/diacritics (é -> e)
 * - removes punctuation (keeps alphanumerics and spaces)
 * - collapses whitespace
 */

export const MIN_PREFIX_LEN = 3;

export function normalizeString(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // punctuation -> space
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits a string into normalized word tokens. */
export function tokenize(input: string): string[] {
  const normalized = normalizeString(input);
  return normalized.length === 0 ? [] : normalized.split(" ");
}