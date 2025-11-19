/**
 * Comparison test between our custom implementation and string-similarity-js
 * 
 * Run with: npx ts-node src/utils/__tests__/stringSimilarityComparison.test.ts
 */

import { stringSimilarity } from 'string-similarity-js';
import {
  calculateSimilarityScore,
  findBestMatch,
  MatchableItem,
} from '../stringSimilarity';

interface TestCase {
  target: string;
  candidate: string;
  description: string;
}

interface ComparisonResult {
  custom: number;
  library: number;
  difference: number;
  winner: 'custom' | 'library' | 'tie';
}

// Test cases based on real-world trim matching scenarios
const testCases: TestCase[] = [
  {
    target: '320i xDrive',
    candidate: '4D SEDAN 320I XDRIVE',
    description: 'Trim match: target is substring of candidate',
  },
  {
    target: '320i xDrive',
    candidate: '4D SEDAN 320I XDRIVE SPORT',
    description: 'Trim match: target is substring with extra words',
  },
  {
    target: '320i xDrive',
    candidate: '320i xDrive',
    description: 'Exact match (case-insensitive)',
  },
  {
    target: '320i xDrive',
    candidate: 'BMW 328I',
    description: 'No match - different model',
  },
  {
    target: 'xDrive',
    candidate: '4D SEDAN 320I XDRIVE',
    description: 'Single word in longer string',
  },
  {
    target: '4D SEDAN 320I XDRIVE',
    candidate: 'xDrive',
    description: 'Longer string contains single word',
  },
  {
    target: '320i',
    candidate: '320I XDRIVE',
    description: 'Partial word match',
  },
  {
    target: 'SPORT',
    candidate: '4D SEDAN 320I XDRIVE SPORT',
    description: 'Word at end of string',
  },
];

function compareResults(testCase: TestCase): ComparisonResult {
  const customScore = calculateSimilarityScore(testCase.target, testCase.candidate);
  const libraryScore = stringSimilarity(testCase.target, testCase.candidate);

  const difference = Math.abs(customScore - libraryScore);
  let winner: 'custom' | 'library' | 'tie';
  if (difference < 0.01) {
    winner = 'tie';
  } else if (customScore > libraryScore) {
    winner = 'custom';
  } else {
    winner = 'library';
  }

  return {
    custom: customScore,
    library: libraryScore,
    difference,
    winner,
  };
}

function testIndividualComparisons(): void {
  console.log('\n📊 Comparing Individual String Similarity Scores\n');
  console.log('='.repeat(80));

  let customWins = 0;
  let libraryWins = 0;
  let ties = 0;

  for (const testCase of testCases) {
    const result = compareResults(testCase);

    console.log(`\nTest: ${testCase.description}`);
    console.log(`  Target:    "${testCase.target}"`);
    console.log(`  Candidate: "${testCase.candidate}"`);
    console.log(`  Custom:    ${result.custom.toFixed(3)}`);
    console.log(`  Library:   ${result.library.toFixed(3)}`);
    console.log(`  Difference: ${result.difference.toFixed(3)}`);
    console.log(`  Winner:    ${result.winner === 'tie' ? '🤝 TIE' : result.winner === 'custom' ? '🏆 CUSTOM' : '📦 LIBRARY'}`);

    if (result.winner === 'custom') customWins++;
    else if (result.winner === 'library') libraryWins++;
    else ties++;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\nSummary: Custom: ${customWins}, Library: ${libraryWins}, Ties: ${ties}\n`);
}

function testFindBestMatchScenario(): void {
  console.log('\n🎯 Testing findBestMatch with Real-World Scenario\n');
  console.log('='.repeat(80));

  const vehicleTrim = '320i xDrive';
  const items: MatchableItem[] = [
    { id: '201600600170027', name: '4D SEDAN 320I XDRIVE SPORT' },
    { id: '201600600175237', name: '4D SEDAN 320I XDRIVE' },
    { id: '201600600170028', name: '4D SEDAN 328I' },
    { id: '201600600170029', name: '2D COUPE 320I XDRIVE' },
  ];

  console.log(`Vehicle Trim: "${vehicleTrim}"\n`);
  console.log('Available Options:');

  // Calculate scores with both methods
  const scores: Array<{
    item: MatchableItem;
    customScore: number;
    libraryScore: number;
  }> = [];

  for (const item of items) {
    const customScore = calculateSimilarityScore(vehicleTrim, item.name);
    const libraryScore = stringSimilarity(vehicleTrim, item.name);
    scores.push({ item, customScore, libraryScore });

    console.log(`  - "${item.name}"`);
    console.log(`    Custom: ${customScore.toFixed(3)}, Library: ${libraryScore.toFixed(3)}`);
  }

  // Find best match with custom implementation
  const customBestMatch = findBestMatch(vehicleTrim, items);

  // Find best match with library
  let libraryBestMatch = items[0];
  let libraryBestScore = 0;
  for (const score of scores) {
    if (score.libraryScore > libraryBestScore) {
      libraryBestScore = score.libraryScore;
      libraryBestMatch = score.item;
    }
  }

  console.log(`\nCustom Best Match:  "${customBestMatch.name}" (ID: ${customBestMatch.id})`);
  console.log(`Library Best Match: "${libraryBestMatch.name}" (ID: ${libraryBestMatch.id})`);

  const match = customBestMatch.id === libraryBestMatch.id;
  console.log(`\n${match ? '✅' : '❌'} Results ${match ? 'MATCH' : 'DIFFER'}`);

  // Show which one is better
  const customBestScore = scores.find(s => s.item.id === customBestMatch.id)!.customScore;
  const libraryBestScoreForCustom = scores.find(s => s.item.id === customBestMatch.id)!.libraryScore;
  const customScoreForLibrary = scores.find(s => s.item.id === libraryBestMatch.id)!.customScore;

  console.log(`\nCustom method selected item with custom score: ${customBestScore.toFixed(3)}`);
  console.log(`Custom method selected item with library score: ${libraryBestScoreForCustom.toFixed(3)}`);
  console.log(`Library method selected item with custom score: ${customScoreForLibrary.toFixed(3)}`);
  console.log(`Library method selected item with library score: ${libraryBestScore.toFixed(3)}`);

  console.log('');
}

function testPerformance(): void {
  console.log('\n⚡ Performance Comparison\n');
  console.log('='.repeat(80));

  const iterations = 10000;
  const testCase = testCases[0]; // Use first test case

  // Test custom implementation
  const customStart = Date.now();
  for (let i = 0; i < iterations; i++) {
    calculateSimilarityScore(testCase.target, testCase.candidate);
  }
  const customTime = Date.now() - customStart;

  // Test library
  const libraryStart = Date.now();
  for (let i = 0; i < iterations; i++) {
    stringSimilarity(testCase.target, testCase.candidate);
  }
  const libraryTime = Date.now() - libraryStart;

  console.log(`Running ${iterations} iterations of similarity calculation:`);
  console.log(`  Custom:  ${customTime}ms (${(customTime / iterations).toFixed(4)}ms per call)`);
  console.log(`  Library: ${libraryTime}ms (${(libraryTime / iterations).toFixed(4)}ms per call)`);

  const faster = customTime < libraryTime ? 'Custom' : 'Library';
  const speedup = ((Math.max(customTime, libraryTime) / Math.min(customTime, libraryTime) - 1) * 100).toFixed(1);
  console.log(`\n  ${faster} is faster by ${speedup}%`);

  console.log('');
}

function testEdgeCasesComparison(): void {
  console.log('\n⚠️  Edge Cases Comparison\n');
  console.log('='.repeat(80));

  const edgeCases: TestCase[] = [
    { target: '', candidate: 'test', description: 'Empty target' },
    { target: 'test', candidate: '', description: 'Empty candidate' },
    { target: 'a', candidate: 'b', description: 'Single character strings' },
    { target: 'abc', candidate: 'abc', description: 'Very short exact match' },
    { target: 'The quick brown fox', candidate: 'The quick brown fox jumps over the lazy dog', description: 'One is substring of other' },
  ];

  for (const testCase of edgeCases) {
    const result = compareResults(testCase);
    console.log(`\n${testCase.description}:`);
    console.log(`  Custom: ${result.custom.toFixed(3)}, Library: ${result.library.toFixed(3)}`);
    console.log(`  ${result.winner === 'tie' ? '🤝 TIE' : result.winner === 'custom' ? '🏆 CUSTOM' : '📦 LIBRARY'}`);
  }

  console.log('');
}

// Main test runner
function runComparisonTests(): void {
  console.log('🔬 String Similarity Comparison Test Suite');
  console.log('Comparing custom implementation vs string-similarity-js');
  console.log('='.repeat(80));

  testIndividualComparisons();
  testFindBestMatchScenario();
  testPerformance();
  testEdgeCasesComparison();

  console.log('='.repeat(80));
  console.log('✨ Comparison tests completed!\n');
  console.log('💡 Recommendation:');
  console.log('   - If library performs better, consider using string-similarity-js');
  console.log('   - If custom performs better or ties, keep custom implementation');
  console.log('   - Library uses proven Sørensen–Dice coefficient algorithm');
  console.log('   - Custom implementation is tailored for trim matching use case\n');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runComparisonTests();
}

export { runComparisonTests };

