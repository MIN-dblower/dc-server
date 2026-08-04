import { z } from 'zod';

// Define the types for the checkbox and select schemas

const inputSchema = z.object({
    type: z.literal('input'),
    value: z.union([z.number(), z.string()]),
    key: z.string(),
})
export type InputAnswer = z.infer<typeof inputSchema>;

const checkboxSchema = z.object({
    type: z.literal('checkbox'), // Ensures the type is 'checkbox'  
    book: z.number().min(1).max(4), // Book must be a number between 0 and 3  
    items: z.array(
        z.object({
            id: z.string(),              // id must be a string  
            isChecked: z.boolean(),       // isChecked must be a boolean  
        })
    ),
    key: z.string(),
});

const selectSchema = z.object({
    type: z.literal('select'),      // Ensures the type is 'select'  
    items: z.array(
        z.object({
            id: z.string(),              // id must be a string  
            isChecked: z.boolean(),       // isChecked must be a boolean  
        })
    ),
    book: z.number().min(1).max(4), // Book must be a number between 0 and 3  
    key: z.string(),
});

// Define a union schema for both  
export const userPromptSchema = z.array(z.union([checkboxSchema, selectSchema, inputSchema]));

// Type inference for valid inputs
export type UserAnswer = z.infer<typeof userPromptSchema>;

export const getBookRequestSchema = z.object({
  vin: z.string().min(1),
  prompts: userPromptSchema.optional(),
});
export type GetBookRequest = z.infer<typeof getBookRequestSchema>;

export const notifyRequestSchema = z.object({
  type: z.literal('appraisal_failure_callback_email'),
  vin: z.string().min(1),
  email: z.string().email(),
  errorType: z.string().min(1),
  timestamp: z.string().optional(),
});
export type NotifyRequest = z.infer<typeof notifyRequestSchema>;
