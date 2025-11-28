# Question-Answer Test Suite Documentation

## Overview

The question-answer test suite provides comprehensive unit testing for the `DCEngine.processQuestionAnswer` function. This function is responsible for processing questions from the DealerCenter API and generating appropriate answers based on vehicle data.

The test suite uses a **data-driven approach** with Jest, making it easy to add new test cases and maintain existing ones.

## Test File Location

```
src/services/__tests__/processQuestionAnswer.test.ts
```

## Running the Tests

### Run All Tests
```bash
npm test
```

### Run Only Question-Answer Tests
```bash
npm run test:processQuestionAnswer
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

### Run Tests with Coverage
```bash
npm test -- --coverage
```

## Test Structure

### Test Case Interface

Each test case follows this structure:

```typescript
interface TestCase {
  name: string;                    // Descriptive test name
  question: IQuestion;              // The question from DC API
  vehicle: IVehicle;                // Vehicle information
  existingAnswer?: IAnswer;         // Optional existing answer
  expected: {
    shouldThrow?: boolean;          // Whether the function should throw
    errorType?: Error;              // Expected error type
    answer?: IAnswer;                // Expected answer object
    transmissionSelection?: {       // Expected transmission metadata
      vin: string;
      selectedTransmission: { id: string; name: string };
      availableOptions: Array<{ id: string; name: string }>;
      vehicleTrim?: string;
    };
    customAssertions?: (result) => void; // Custom validation logic
  };
}
```

### Question Interface

```typescript
interface IQuestion {
  book: number;                     // Question book number (1-4)
  key: string;                       // Question key (e.g., 'trim', 'transmission')
  type: 'select' | 'checkbox';      // Question type
  items: Array<{                     // Available options
    id: string;
    name: string;
  }>;
}
```

### Vehicle Interface

```typescript
interface IVehicle {
  vin: string;
  make: string;
  model: string;
  year: number;
  odometer: number;
  trim: string;
  transmission: string;              // Empty string = random selection needed
}
```

### Answer Interface

```typescript
interface IAnswer {
  book: number;
  addDeduct: Array<{                 // Sorted by code
    action: 0 | 1;                   // 0 = selected, 1 = not selected
    code: string;
  }>;
  modelId?: string;                  // For select questions
  isBlank: null;
}
```

## Test Coverage

The test suite covers the following scenarios:

### 1. Trim Selection Tests
- **New answer**: Selecting best matching trim from available options
- **Existing answer**: Updating modelId while preserving existing data
- **Empty trim**: Handling empty trim strings

### 2. Transmission Selection Tests
- **Empty transmission**: Random selection when vehicle has no transmission info
- **Whitespace-only transmission**: Treated as empty
- **Existing answer**: Updating transmission in existing answer
- **Vehicle has transmission**: Should throw error (uncovered case)

### 3. Checkbox Questions Tests
- **New answer**: Selecting all checkbox items
- **Existing answer with new items**: Merging without duplicates
- **All items already exist**: No duplicates added

### 4. Uncovered Case Tests
- **Unknown question key**: Throws `UncoveredCaseError`
- **Input type questions**: Throws `UncoveredCaseError`
- **Select type with unknown key**: Throws `UncoveredCaseError`

### 5. Edge Cases
- **Single item in question**: Handles questions with only one option

## Adding New Test Cases

### Step 1: Add Test Case to Array

Add a new object to the `testCases` array in the test file:

```typescript
{
  name: 'Your test case name',
  question: {
    book: 1,
    key: 'your-key',
    type: 'select', // or 'checkbox'
    items: [
      { id: 'id1', name: 'Option 1' },
      { id: 'id2', name: 'Option 2' },
    ],
  },
  vehicle: {
    vin: 'TEST123',
    make: 'Make',
    model: 'Model',
    year: 2020,
    odometer: 10000,
    trim: 'Trim',
    transmission: '',
  },
  expected: {
    answer: {
      book: 1,
      addDeduct: [],
      isBlank: null,
      modelId: 'id1',
    },
  },
},
```

### Step 2: Define Expected Results

For each test case, specify what you expect:

- **Answer object**: The exact answer structure expected
- **Transmission selection**: If transmission was randomly selected
- **Error**: If the function should throw an error

### Step 3: Use Custom Assertions (Optional)

For cases where exact matching isn't possible (e.g., random selection), use custom assertions:

```typescript
expected: {
  customAssertions: (result) => {
    expect(result.answer.addDeduct.length).toBe(2);
    const selectedItem = result.answer.addDeduct.find(
      item => item.action === 0
    );
    expect(selectedItem).toBeDefined();
  },
}
```

## Understanding Test Results

### Successful Test Output

```
PASS src/services/__tests__/processQuestionAnswer.test.ts
  DCEngine.processQuestionAnswer
    ✓ Trim selection - new answer (54 ms)
    ✓ Transmission selection - empty transmission (10 ms)
    ✓ Checkbox - new answer (select all items) (1 ms)
    ...

Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total
```

### Failed Test Output

```
FAIL src/services/__tests__/processQuestionAnswer.test.ts
  DCEngine.processQuestionAnswer
    ✕ Trim selection - new answer (54 ms)

    Expected: "201600600175237"
    Received: "201600600170027"
```

## Key Behaviors Tested

### 1. Trim Selection
- Uses string similarity matching to find the best trim option
- Preserves existing `addDeduct` when updating `modelId`
- Handles empty trim strings gracefully

### 2. Transmission Selection
- Randomly selects transmission when vehicle has no transmission info
- Returns metadata about the selection for notifications
- Includes all available options in metadata

### 3. Checkbox Questions
- Selects all items by default (action: 0)
- Merges with existing answers without duplicates
- Sorts `addDeduct` arrays by `code` alphabetically

### 4. Error Handling
- Throws `UncoveredCaseError` for unsupported question types
- Includes VIN and question details in error
- Logs error details before throwing

## Important Notes

### Sorting Behavior
All `addDeduct` arrays are **automatically sorted by `code`** in alphabetical order. This ensures consistent output regardless of input order.

### Transmission Selection
When a vehicle has an empty `transmission` field:
1. A random option is selected from available options
2. Metadata is returned for notification purposes
3. The selection is logged with a warning

### Answer Merging
When an existing answer is provided:
- The existing answer is updated in place
- New items are merged without creating duplicates
- The final array is sorted by `code`

## Debugging Failed Tests

### 1. Check the Test Name
The test name should clearly indicate what scenario is being tested.

### 2. Verify Expected Values
Compare the expected answer structure with the actual result:
```typescript
console.log('Expected:', expected.answer);
console.log('Actual:', result.answer);
```

### 3. Check Custom Assertions
If using custom assertions, add logging:
```typescript
customAssertions: (result) => {
  console.log('Result:', JSON.stringify(result, null, 2));
  expect(result.answer.addDeduct.length).toBe(2);
}
```

### 4. Run Single Test
Use Jest's test name pattern to run a specific test:
```bash
npm test -- -t "Trim selection"
```

## Integration with CI/CD

The test suite is designed to run in CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Run tests
  run: npm test
```

All tests should pass before merging code changes.

## Related Documentation

- [API Documentation](./API.md) - DealerCenter API integration
- [Architecture](./ARCHITECTURE.md) - System architecture overview
- [Setup Guide](./SETUP.md) - Environment setup instructions

## Troubleshooting

### Tests Fail After Code Changes
1. Verify the function signature hasn't changed
2. Check if new question types need to be handled
3. Update expected values if behavior changed intentionally

### Random Selection Tests Fail
- Random selection tests use `customAssertions` to validate behavior
- The exact selected item may vary, but the structure should be consistent

### Type Errors
- Ensure all interfaces match the actual implementation
- Check that `IQuestion`, `IVehicle`, and `IAnswer` are up to date

## Contributing

When adding new test cases:
1. Follow the existing test case structure
2. Use descriptive test names
3. Include both positive and negative test cases
4. Document any special behaviors in test comments
5. Ensure all tests pass before submitting

