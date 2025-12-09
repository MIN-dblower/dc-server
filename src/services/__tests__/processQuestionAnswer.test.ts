/**
 * Unit test suite for DCEngine.processQuestionAnswer function
 * 
 * First install dependencies: npm install
 * Then run with: npm run test:processQuestionAnswer
 * Or: npm test
 */

import { DCEngine } from '../dcengine';
import { IQuestion, IAnswer } from '../../interfaces/dealercenter.types';
import { IVehicle } from '../../interfaces/vehicle.types';
import { UncoveredCaseError } from '../../errors/uncoveredCaseError';

// Test data type
interface TestCase {
  name: string;
  question: IQuestion;
  vehicle: IVehicle;
  existingAnswer?: IAnswer;
  expected: {
    shouldThrow?: boolean;
    errorType?: new (...args: any[]) => Error;
    answer?: IAnswer; // Expected answer object
    transmissionSelection?: {
      vin: string;
      selectedTransmission: { id: string; name: string };
      availableOptions: Array<{ id: string; name: string }>;
      vehicleTrim?: string;
    };
    // Optional custom assertions for cases where exact match isn't possible (e.g., random selection)
    customAssertions?: (result: {
      answer: IAnswer;
      transmissionSelection?: {
        vin: string;
        selectedTransmission: { id: string; name: string };
        availableOptions: Array<{ id: string; name: string }>;
        vehicleTrim?: string;
      };
    }) => void;
  };
}

// Test data array
const testCases: TestCase[] = [
  // Trim Selection Tests
  {
    name: 'Trim selection - new answer',
    question: {
      book: 4,
      key: 'trim',
      type: 'select',
      items: [
        { id: '201600600170027', name: '4D SEDAN 320I XDRIVE SPORT' },
        { id: '201600600175237', name: '4D SEDAN 320I XDRIVE' },
        { id: '201600600170028', name: '4D SEDAN 328I' },
      ],
    },
    vehicle: {
      vin: 'TEST123',
      make: 'BMW',
      model: '320i',
      year: 2020,
      odometer: 10000,
      trim: '320i xDrive',
      transmission: '',
    },
    expected: {
      answer: {
        book: 4,
        addDeduct: [],
        isBlank: null,
        modelId: '201600600175237', // Best match for '320i xDrive' should be '4D SEDAN 320I XDRIVE'
      },
    },
  },
  {
    name: 'Trim selection - existing answer (should update modelId)',
    question: {
      book: 4,
      key: 'trim',
      type: 'select',
      items: [
        { id: 'id1', name: '4D SEDAN 320I XDRIVE SPORT' },
        { id: 'id2', name: '4D SEDAN 320I XDRIVE' },
      ],
    },
    vehicle: {
      vin: 'TEST123',
      make: 'BMW',
      model: '320i',
      year: 2020,
      odometer: 10000,
      trim: '320i xDrive',
      transmission: '',
    },
    existingAnswer: {
      book: 4,
      addDeduct: [{ action: 1, code: 'some-code' }],
      isBlank: null,
      modelId: 'old-model-id',
    },
    expected: {
      answer: {
        book: 4,
        addDeduct: [{ action: 1, code: 'some-code' }], // Should preserve existing
        isBlank: null,
        modelId: 'id2', // Best match for '320i xDrive' should be '4D SEDAN 320I XDRIVE'
      },
    },
  },
  {
    name: 'Trim selection - empty trim string',
    question: {
      book: 4,
      key: 'trim',
      type: 'select',
      items: [{ id: '1', name: 'Base' }],
    },
    vehicle: {
      vin: 'TEST001',
      make: 'Honda',
      model: 'Civic',
      year: 2020,
      odometer: 20000,
      trim: '',
      transmission: '',
    },
    expected: {
      answer: {
        book: 4,
        addDeduct: [],
        isBlank: null,
        modelId: '1', // Only one option available
      },
    },
  },

  // Transmission Selection Tests
  {
    name: 'Transmission selection - empty transmission (new answer)',
    question: {
      book: 1,
      key: 'transmission',
      type: 'select',
      items: [
        { id: '5590239', name: 'Auto, 6-Spd DSG Tiptronic' },
        { id: '5590276', name: 'Manual, 6-Spd' },
      ],
    },
    vehicle: {
      vin: 'TEST456',
      make: 'Audi',
      model: 'A4',
      year: 2021,
      odometer: 5000,
      trim: 'Premium',
      transmission: '', // Empty - should trigger random selection
    },
    expected: {
      // Transmission selection is random, so we use customAssertions
      customAssertions: (result) => {
        expect(result.answer.book).toBe(1);
        expect(result.answer.addDeduct.length).toBe(2);
        expect(result.transmissionSelection).toBeDefined();
        expect(result.transmissionSelection?.vin).toBe('TEST456');
        expect(result.transmissionSelection?.selectedTransmission.id).toBeDefined();
        expect(result.transmissionSelection?.availableOptions.length).toBe(2);
        // Verify that selected transmission has action=0, others have action=1
        const selectedId = result.transmissionSelection?.selectedTransmission.id;
        const selectedItem = result.answer.addDeduct.find(item => item.code === selectedId);
        expect(selectedItem?.action).toBe(0);
        const otherItems = result.answer.addDeduct.filter(item => item.code !== selectedId);
        otherItems.forEach(item => expect(item.action).toBe(1));
      },
      transmissionSelection: {
        vin: 'TEST456',
        selectedTransmission: { id: expect.any(String), name: expect.any(String) },
        availableOptions: [
          { id: '5590239', name: 'Auto, 6-Spd DSG Tiptronic' },
          { id: '5590276', name: 'Manual, 6-Spd' },
        ],
        vehicleTrim: 'Premium',
      },
    },
  },
  {
    name: 'Transmission selection - whitespace-only transmission (treated as empty)',
    question: {
      book: 1,
      key: 'transmission',
      type: 'select',
      items: [
        { id: 'auto', name: 'Automatic' },
        { id: 'manual', name: 'Manual' },
      ],
    },
    vehicle: {
      vin: 'TEST003',
      make: 'Nissan',
      model: 'Altima',
      year: 2022,
      odometer: 5000,
      trim: 'SV',
      transmission: '   ', // Whitespace only
    },
    expected: {
      transmissionSelection: {
        vin: 'TEST003',
        selectedTransmission: { id: expect.any(String), name: expect.any(String) },
        availableOptions: [
          { id: 'auto', name: 'Automatic' },
          { id: 'manual', name: 'Manual' },
        ],
        vehicleTrim: 'SV',
      },
    },
  },
  {
    name: 'Transmission selection - existing answer',
    question: {
      book: 1,
      key: 'transmission',
      type: 'select',
      items: [
        { id: 'trans1', name: 'Auto' },
        { id: 'trans2', name: 'Manual' },
      ],
    },
    vehicle: {
      vin: 'TEST456',
      make: 'Audi',
      model: 'A4',
      year: 2021,
      odometer: 5000,
      trim: 'Premium',
      transmission: '',
    },
    existingAnswer: {
      book: 1,
      addDeduct: [],
      isBlank: null,
      modelId: 'some-id',
    },
    expected: {
      answer: {
        book: 1,
        addDeduct: [],
        isBlank: null,
        modelId: expect.any(String), // Randomly selected
      },
      transmissionSelection: {
        vin: 'TEST456',
        selectedTransmission: { id: expect.any(String), name: expect.any(String) },
        availableOptions: [
          { id: 'trans1', name: 'Auto' },
          { id: 'trans2', name: 'Manual' },
        ],
        vehicleTrim: 'Premium',
      },
    },
  },
  {
    name: 'Transmission selection - vehicle has transmission (should throw error)',
    question: {
      book: 1,
      key: 'transmission',
      type: 'select',
      items: [
        { id: '1', name: 'Auto' },
        { id: '2', name: 'Manual' },
      ],
    },
    vehicle: {
      vin: 'TEST999',
      make: 'Toyota',
      model: 'Camry',
      year: 2023,
      odometer: 1000,
      trim: 'LE',
      transmission: 'CVT', // Has transmission - should throw error
    },
    expected: {
      shouldThrow: true,
      errorType: UncoveredCaseError,
    },
  },

  // Checkbox Questions Tests
  {
    name: 'Checkbox - new answer (select all items)',
    question: {
      book: 2,
      key: 'equipment',
      type: 'checkbox',
      items: [
        { id: 'eq1', name: 'Navigation System' },
        { id: 'eq2', name: 'Sunroof' },
        { id: 'eq3', name: 'Leather Seats' },
      ],
    },
    vehicle: {
      vin: 'TEST789',
      make: 'Mercedes',
      model: 'C-Class',
      year: 2022,
      odometer: 3000,
      trim: 'AMG',
      transmission: 'Auto',
    },
    expected: {
      answer: {
        book: 2,
        addDeduct: [
          { action: 1, code: 'eq1' },
          { action: 1, code: 'eq2' },
          { action: 1, code: 'eq3' },
        ],
        isBlank: null,
      },
    },
  },
  {
    name: 'Checkbox - existing answer with new items (merge without duplicates)',
    question: {
      book: 2,
      key: 'equipment',
      type: 'checkbox',
      items: [
        { id: 'eq2', name: 'Sunroof' }, // Already exists
        { id: 'eq3', name: 'Leather Seats' }, // New
      ],
    },
    vehicle: {
      vin: 'TEST789',
      make: 'Mercedes',
      model: 'C-Class',
      year: 2022,
      odometer: 3000,
      trim: 'AMG',
      transmission: 'Auto',
    },
    existingAnswer: {
      book: 2,
      addDeduct: [
        { action: 1, code: 'eq1' }, // Existing
        { action: 1, code: 'eq2' }, // Duplicate in question
        { action: 1, code: 'eq4' }, // Different item
      ],
      isBlank: null,
    },
    expected: {
      answer: {
        book: 2,
        addDeduct: [
          { action: 1, code: 'eq1' },
          { action: 1, code: 'eq2' },
          { action: 1, code: 'eq3' },
          { action: 1, code: 'eq4' },
        ],
        isBlank: null,
      },
    },
  },
  {
    name: 'Checkbox - all items already exist (no duplicates)',
    question: {
      book: 2,
      key: 'equipment',
      type: 'checkbox',
      items: [
        { id: 'eq1', name: 'Nav' },
        { id: 'eq2', name: 'Sunroof' },
      ],
    },
    vehicle: {
      vin: 'TEST789',
      make: 'Mercedes',
      model: 'C-Class',
      year: 2022,
      odometer: 3000,
      trim: 'AMG',
      transmission: 'Auto',
    },
    existingAnswer: {
      book: 2,
      addDeduct: [
        { action: 1, code: 'eq1' },
        { action: 1, code: 'eq2' },
      ],
      isBlank: null,
    },
    expected: {
      answer: {
        book: 2,
        addDeduct: [
          { action: 1, code: 'eq1' },
          { action: 1, code: 'eq2' },
        ],
        isBlank: null,
      },
    },
  },

  // Uncovered Cases Tests
  {
    name: 'Uncovered case - unknown question key',
    question: {
      book: 5,
      key: 'unknown_key',
      type: 'select',
      items: [{ id: '1', name: 'Option 1' }],
    },
    vehicle: {
      vin: 'TEST999',
      make: 'Toyota',
      model: 'Camry',
      year: 2023,
      odometer: 1000,
      trim: 'LE',
      transmission: 'CVT',
    },
    expected: {
      shouldThrow: true,
      errorType: UncoveredCaseError,
    },
  },
  {
    name: 'Uncovered case - input type',
    question: {
      book: 6,
      key: 'some_input',
      type: 'input',
      items: [],
    },
    vehicle: {
      vin: 'TEST999',
      make: 'Toyota',
      model: 'Camry',
      year: 2023,
      odometer: 1000,
      trim: 'LE',
      transmission: 'CVT',
    },
    expected: {
      shouldThrow: true,
      errorType: UncoveredCaseError,
    },
  },
  {
    name: 'Uncovered case - select type with unknown key',
    question: {
      book: 7,
      key: 'unknown_select',
      type: 'select',
      items: [{ id: '1', name: 'Option 1' }],
    },
    vehicle: {
      vin: 'TEST999',
      make: 'Toyota',
      model: 'Camry',
      year: 2023,
      odometer: 1000,
      trim: 'LE',
      transmission: 'CVT',
    },
    expected: {
      shouldThrow: true,
      errorType: UncoveredCaseError,
    },
  },

  // Edge Cases
  {
    name: 'Edge case - single item in question',
    question: {
      book: 3,
      key: 'trim',
      type: 'select',
      items: [{ id: 'only-one', name: 'Only Option' }],
    },
    vehicle: {
      vin: 'TEST002',
      make: 'Ford',
      model: 'F-150',
      year: 2021,
      odometer: 15000,
      trim: 'XLT',
      transmission: 'Auto',
    },
    expected: {
      answer: {
        book: 3,
        addDeduct: [],
        isBlank: null,
        modelId: 'only-one',
      },
    },
  },
];

// Jest test with data-driven approach
describe('DCEngine.processQuestionAnswer', () => {
  test.each(testCases)(
    '$name',
    ({
      question,
      vehicle,
      existingAnswer,
      expected,
    }: {
      question: IQuestion;
      vehicle: IVehicle;
      existingAnswer?: IAnswer;
      expected: TestCase['expected'];
    }) => {
      if (expected.shouldThrow) {
        expect(() => {
          DCEngine.processQuestionAnswer(question, vehicle, existingAnswer);
        }).toThrow(expected.errorType);
      } else {
        const result = DCEngine.processQuestionAnswer(question, vehicle, existingAnswer);

        // Compare expected answer if provided
        if (expected.answer) {
          expect(result.answer).toEqual(expected.answer);
        }

        // Compare transmissionSelection if provided
        if (expected.transmissionSelection) {
          expect(result.autoSelection).toBeDefined();
          expect(result.autoSelection?.vin).toBe(expected.transmissionSelection.vin);
          expect(result.autoSelection?.selectedOption).toEqual(
            expected.transmissionSelection.selectedTransmission,
          );
          expect(result.autoSelection?.availableOptions).toEqual(
            expected.transmissionSelection.availableOptions,
          );
          if (expected.transmissionSelection.vehicleTrim !== undefined) {
            expect(result.autoSelection?.vehicleTrim).toBe(
              expected.transmissionSelection.vehicleTrim,
            );
          }
        }

        // Run custom assertions if provided (for cases where exact match isn't possible)
        if (expected.customAssertions) {
          expected.customAssertions(result);
        }
      }
    },
  );
});
