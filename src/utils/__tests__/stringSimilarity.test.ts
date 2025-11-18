/**
 * Test suite for stringSimilarity utility functions
 * 
 * Run with: npx ts-node src/utils/__tests__/stringSimilarity.test.ts
 */

import {
  calculateSimilarityScore,
  findBestMatch,
  MatchableItem,
} from '../stringSimilarity';

// Test helper to format results
function formatTestResult(testName: string, passed: boolean, details?: string): void {
  const status = passed ? '✅' : '❌';
  console.log(`${status} ${testName}`);
  if (details) {
    console.log(`   ${details}`);
  }
}

// Test calculateSimilarityScore
function testCalculateSimilarityScore(): void {
  console.log('\n📊 Testing calculateSimilarityScore()\n');

  const tests = [
    {
      target: '320i xDrive',
      candidate: '4D SEDAN 320I XDRIVE',
      expectedRange: { min: 0.5, max: 1.0 },
      description: 'Partial match (should find "320i xdrive" in candidate)',
    },
    {
      target: '320i xDrive',
      candidate: '4D SEDAN 320I XDRIVE SPORT',
      expectedRange: { min: 0.4, max: 0.9 },
      description: 'Partial match with extra words',
    },
    {
      target: '320i xDrive',
      candidate: '320i xDrive',
      expectedRange: { min: 1.0, max: 1.0 },
      description: 'Exact match (case-insensitive)',
    },
    {
      target: '320i xDrive',
      candidate: 'BMW 328I',
      expectedRange: { min: 0.0, max: 0.3 },
      description: 'No match',
    },
    {
      target: 'xDrive',
      candidate: '4D SEDAN 320I XDRIVE',
      expectedRange: { min: 0.5, max: 1.0 },
      description: 'Substring match (target in candidate)',
    },
    {
      target: '4D SEDAN 320I XDRIVE',
      candidate: 'xDrive',
      expectedRange: { min: 0.5, max: 1.0 },
      description: 'Substring match (candidate in target)',
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const score = calculateSimilarityScore(test.target, test.candidate);
    const testPassed =
      score >= test.expectedRange.min && score <= test.expectedRange.max;
    formatTestResult(
      `calculateSimilarityScore("${test.target}", "${test.candidate}")`,
      testPassed,
      testPassed
        ? `Score: ${score.toFixed(3)} (expected: ${test.expectedRange.min}-${test.expectedRange.max})`
        : `Score: ${score.toFixed(3)}, Expected: ${test.expectedRange.min}-${test.expectedRange.max}`,
    );
    if (!testPassed) {
      console.log(`   Description: ${test.description}`);
    }
    if (testPassed) passed++;
    else failed++;
  }

  console.log(`\n   Results: ${passed} passed, ${failed} failed\n`);
}

// Test findBestMatch with real-world trim scenario
function testFindBestMatch(): void {
  console.log('\n🎯 Testing findBestMatch() - Real-world trim scenario\n');

  const vehicleTrim = '320i xDrive';
  const items: MatchableItem[] = [
    { id: '201600600170027', name: '4D SEDAN 320I XDRIVE SPORT' },
    { id: '201600600175237', name: '4D SEDAN 320I XDRIVE' },
    { id: '201600600170028', name: '4D SEDAN 328I' },
    { id: '201600600170029', name: '2D COUPE 320I XDRIVE' },
  ];

  const bestMatch = findBestMatch(vehicleTrim, items);
  const expectedMatch = items[1]; // '4D SEDAN 320I XDRIVE' should be the best match

  const testPassed = bestMatch.id === expectedMatch.id;
  formatTestResult(
    `findBestMatch("${vehicleTrim}", [${items.length} items])`,
    testPassed,
    testPassed
      ? `Selected: "${bestMatch.name}" (ID: ${bestMatch.id})`
      : `Expected: "${expectedMatch.name}" (ID: ${expectedMatch.id}), Got: "${bestMatch.name}" (ID: ${bestMatch.id})`,
  );

  // Show all scores for debugging
  console.log('\n   All item scores:');
  for (const item of items) {
    const score = calculateSimilarityScore(vehicleTrim, item.name);
    console.log(
      `   - "${item.name}": ${score.toFixed(3)} ${item.id === bestMatch.id ? '← SELECTED' : ''}`,
    );
  }

  console.log(`\n   Result: ${testPassed ? '✅ PASSED' : '❌ FAILED'}\n`);
}

// Test edge cases
function testEdgeCases(): void {
  console.log('\n⚠️  Testing Edge Cases\n');

  let passed = 0;
  let failed = 0;

  // Empty target
  const items1: MatchableItem[] = [
    { id: '1', name: 'Item 1' },
    { id: '2', name: 'Item 2' },
  ];
  const result1 = findBestMatch('', items1);
  const test1Passed = result1.id === items1[0].id; // Should return first item
  formatTestResult('findBestMatch with empty target', test1Passed);
  if (test1Passed) passed++;
  else failed++;

  // Single item
  const items2: MatchableItem[] = [{ id: '1', name: 'Only Item' }];
  const result2 = findBestMatch('test', items2);
  const test2Passed = result2.id === items2[0].id;
  formatTestResult('findBestMatch with single item', test2Passed);
  if (test2Passed) passed++;
  else failed++;

  // Very different strings
  const score1 = calculateSimilarityScore('BMW', 'Toyota');
  const test3Passed = score1 < 0.2; // Should be very low
  formatTestResult(
    'calculateSimilarityScore with very different strings',
    test3Passed,
    `Score: ${score1.toFixed(3)}`,
  );
  if (test3Passed) passed++;
  else failed++;

  // Special characters (test similarity with special chars)
  const score2 = calculateSimilarityScore('Test-String_123', 'test-string_123');
  const test4Passed = score2 >= 0.8; // Should be high similarity (case-insensitive)
  formatTestResult(
    'calculateSimilarityScore with special characters',
    test4Passed,
    `Score: ${score2.toFixed(3)}`,
  );
  if (test4Passed) passed++;
  else failed++;

  console.log(`\n   Results: ${passed} passed, ${failed} failed\n`);
}

// Test the specific use case from the comment
function testSpecificUseCase(): void {
  console.log('\n🔍 Testing Specific Use Case from Code Comment\n');

  const vehicleTrim = '320i xDrive';
  const items: MatchableItem[] = [
    { id: '201600600170027', name: '4D SEDAN 320I XDRIVE SPORT' },
    { id: '201600600175237', name: '4D SEDAN 320I XDRIVE' },
  ];

  console.log(`   Vehicle Trim: "${vehicleTrim}"`);
  console.log('   Available Options:');
  items.forEach(item => {
    const score = calculateSimilarityScore(vehicleTrim, item.name);
    console.log(`     - "${item.name}" (ID: ${item.id}) - Score: ${score.toFixed(3)}`);
  });

  const bestMatch = findBestMatch(vehicleTrim, items);
  console.log(`\n   ✅ Best Match: "${bestMatch.name}" (ID: ${bestMatch.id})`);

  // The expected best match should be '4D SEDAN 320I XDRIVE' (without SPORT)
  // because it's a closer match to '320i xDrive'
  const expectedId = '201600600175237';
  const testPassed = bestMatch.id === expectedId;

  formatTestResult(
    'Specific use case: 320i xDrive matching',
    testPassed,
    testPassed
      ? `Correctly selected "${bestMatch.name}"`
      : `Expected ID: ${expectedId}, Got: ${bestMatch.id}`,
  );

  console.log('');
}

// Main test runner
function runAllTests(): void {
  console.log('🧪 String Similarity Utility Test Suite');
  console.log('='.repeat(50));

  testCalculateSimilarityScore();
  testFindBestMatch();
  testEdgeCases();
  testSpecificUseCase();

  console.log('='.repeat(50));
  console.log('✨ All tests completed!\n');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}

export { runAllTests };

