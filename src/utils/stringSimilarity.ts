/**
 * String similarity utilities for matching vehicle trims and other text
 * 
 * Uses string-similarity-js library (Sørensen–Dice coefficient) for proven algorithm
 */

import { stringSimilarity } from 'string-similarity-js';

export interface MatchableItem {
  id: string;
  name: string;
}

/**
 * Calculates similarity score between two strings using string-similarity-js library
 * Returns a score between 0 and 1, where 1 is a perfect match
 * 
 * Uses Sørensen–Dice coefficient algorithm (bigrams) which is effective for:
 * - Rearranged words
 * - Misspellings
 * - Substring matching
 * 
 * @param target - The target string to match against
 * @param candidate - The candidate string to compare
 * @returns Similarity score between 0 and 1
 */
export function calculateSimilarityScore(
  target: string,
  candidate: string,
): number {
  // For very short strings (like "320i"), use substring length of 1 for better accuracy
  // For longer strings, use substring length of 2 (bigrams)
  const substringLength = target.length <= 3 || candidate.length <= 3 ? 1 : 2;
  
  // Case-insensitive comparison (false = case-insensitive)
  return stringSimilarity(target, candidate, substringLength, false);
}

/**
 * Finds the best matching item from a list based on similarity to a target string
 * 
 * Uses string-similarity-js library for similarity calculation
 * 
 * @param target - The target string to match against (e.g., vehicle trim)
 * @param items - Array of items to search through
 * @returns The best matching item, or the first item if no good match is found
 */
export function findBestMatch(
  target: string,
  items: MatchableItem[],
): MatchableItem {
  if (!target || items.length === 0) {
    return items[0];
  }

  let bestMatch = items[0];
  let bestScore = 0;

  for (const item of items) {
    const score = calculateSimilarityScore(target, item.name);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  return bestMatch;
}

