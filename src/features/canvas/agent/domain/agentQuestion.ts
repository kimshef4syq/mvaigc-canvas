import { z } from 'zod';

export const questionKindSchema = z.enum([
  'clarification',
  'business-choice',
  'execution-approval',
  'result-review',
]);

export type QuestionKind = z.infer<typeof questionKindSchema>;

export const questionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  impactSummary: z.string().optional(),
});

export type QuestionOptionV1 = z.infer<typeof questionOptionSchema>;

export const agentQuestionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  planId: z.string().optional(),
  stageId: z.string().optional(),
  kind: questionKindSchema,
  title: z.string().min(1),
  question: z.string().min(1),
  affects: z.string(),
  options: z.array(questionOptionSchema).default([]),
  allowCustomInput: z.boolean().default(true),
  isMultiSelect: z.boolean().default(false),
  selectedValues: z.array(z.string()).default([]),
  customAnswer: z.string().optional(),
  status: z.enum(['pending', 'answered', 'dismissed', 'expired']).default('pending'),
  createdAt: z.number().int().positive(),
  answeredAt: z.number().int().positive().optional(),
});

export type AgentQuestionV1 = z.infer<typeof agentQuestionSchema>;
