import { z } from 'zod';

// Define the types for the checkbox and select schemas  
const checkboxSchema = z.object({
    type: z.literal('checkbox'), // Ensures the type is 'checkbox'  
    book: z.number().min(0).max(3), // Book must be a number between 0 and 3  
    items: z.array(
        z.object({
            id: z.string(),              // id must be a string  
            isChecked: z.boolean(),       // isChecked must be a boolean  
        })
    )
});

const selectSchema = z.object({
    type: z.literal('select'),      // Ensures the type is 'select'  
    id: z.string(),// id must be a string  
    book: z.number().min(0).max(3), // Book must be a number between 0 and 3  
});

// Define a union schema for both  
export const userPromptSchema = z.array(z.union([checkboxSchema, selectSchema]));

// Type inference for valid inputs  
export type UserAnswer = z.infer<typeof userPromptSchema>;  
