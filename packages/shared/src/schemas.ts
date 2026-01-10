import { z } from "zod";

// Unified Transcript Schemas

const userMessageSchema = z.object({
  type: z.literal("user"),
  text: z.string(),
  id: z.string().optional(),
  timestamp: z.string().optional(),
});

const compactionSummaryMessageSchema = z.object({
  type: z.literal("compaction-summary"),
  text: z.string(),
  id: z.string().optional(),
  timestamp: z.string().optional(),
});

const agentMessageSchema = z.object({
  type: z.literal("agent"),
  text: z.string(),
  id: z.string().optional(),
  timestamp: z.string().optional(),
  model: z.string().optional(),
});

const thinkingMessageSchema = z.object({
  type: z.literal("thinking"),
  text: z.string(),
  id: z.string().optional(),
  timestamp: z.string().optional(),
  model: z.string().optional(),
});

const toolCallMessageSchema = z.object({
  type: z.literal("tool-call"),
  toolName: z.string().nullable(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  isError: z.union([z.boolean(), z.string()]).optional(),
  id: z.string().optional(),
  timestamp: z.string().optional(),
  model: z.string().optional(),
});

export const unifiedTranscriptMessageSchema = z.discriminatedUnion("type", [
  userMessageSchema,
  compactionSummaryMessageSchema,
  agentMessageSchema,
  thinkingMessageSchema,
  toolCallMessageSchema,
]);

export const unifiedTokenUsageSchema = z.object({
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
  reasoningOutputTokens: z.number(),
  totalTokens: z.number(),
});

const baseToolCallShapeSchema = toolCallMessageSchema;

const writeToolCallSchema = baseToolCallShapeSchema.extend({
  toolName: z.literal("Write"),
  input: z
    .object({
      file_path: z.string(),
      content: z.string().optional(),
    })
    .passthrough()
    .optional(),
  output: z
    .object({
      type: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

const readToolCallSchema = baseToolCallShapeSchema.extend({
  toolName: z.literal("Read"),
  input: z
    .object({
      file_path: z.string(),
    })
    .passthrough()
    .optional(),
  output: z
    .union([
      z.string(),
      z
        .object({
          type: z.string().optional(),
          file: z
            .object({
              content: z.string().optional(),
              numLines: z.number().optional(),
              startLine: z.number().optional(),
              totalLines: z.number().optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    ])
    .optional(),
});

const editToolCallSchema = baseToolCallShapeSchema.extend({
  toolName: z.literal("Edit"),
  input: z
    .object({
      file_path: z.string(),
      diff: z.string().optional(),
    })
    .passthrough()
    .optional(),
  output: z
    .union([
      z.string(),
      z
        .object({
          userModified: z.boolean().optional(),
        })
        .passthrough(),
    ])
    .optional(),
});

const filenamesOutputSchema = z
  .object({
    filenames: z.array(z.string()),
    durationMs: z.number().optional(),
    truncated: z.boolean().optional(),
  })
  .passthrough();

const globToolCallSchema = baseToolCallShapeSchema.extend({
  toolName: z.literal("Glob"),
  input: z
    .object({
      pattern: z.string().optional(),
    })
    .passthrough()
    .optional(),
  output: filenamesOutputSchema.optional(),
});

const grepToolCallSchema = baseToolCallShapeSchema.extend({
  toolName: z.literal("Grep"),
  input: z.unknown().optional(),
  output: filenamesOutputSchema
    .extend({
      mode: z.string().optional(),
      numMatches: z.number().optional(),
    })
    .passthrough()
    .optional(),
});

const bashToolCallSchema = baseToolCallShapeSchema.extend({
  toolName: z.literal("Bash"),
  input: z.unknown().optional(),
  output: z
    .union([
      z.string(),
      z
        .object({
          stdout: z.string().optional(),
          stderr: z.string().optional(),
          interrupted: z.boolean().optional(),
          isImage: z.boolean().optional(),
        })
        .passthrough(),
    ])
    .optional(),
});

const bashOutputToolCallSchema = baseToolCallShapeSchema.extend({
  toolName: z.literal("BashOutput"),
  input: z
    .object({
      bash_id: z.string().optional(),
    })
    .passthrough()
    .optional(),
  output: z
    .object({
      command: z.string().optional(),
      exitCode: z.number().optional(),
      shellId: z.string().optional(),
      status: z.string().optional(),
      stderr: z.string().optional(),
      stdout: z.string().optional(),
      timestamp: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

const taskToolCallSchema = baseToolCallShapeSchema.extend({
  toolName: z.literal("Task"),
  input: z.unknown().optional(),
  output: z
    .object({
      status: z.string().optional(),
      totalDurationMs: z.number().optional(),
      totalToolUseCount: z.number().optional(),
      content: z
        .array(
          z
            .object({
              type: z.string().optional(),
              text: z.string().optional(),
            })
            .passthrough(),
        )
        .optional(),
      usage: unifiedTokenUsageSchema.optional(),
    })
    .passthrough()
    .optional(),
});

const todoItemSchema = z
  .object({
    content: z.string(),
    status: z.string().optional(),
  })
  .passthrough();

const todoWriteToolCallSchema = baseToolCallShapeSchema.extend({
  toolName: z.literal("TodoWrite"),
  input: z
    .object({
      todos: z.array(todoItemSchema).optional(),
    })
    .passthrough()
    .optional(),
  output: z
    .object({
      oldTodos: z.array(todoItemSchema).optional(),
      newTodos: z.array(todoItemSchema).optional(),
    })
    .passthrough()
    .optional(),
});

const knownToolSchemas = [
  writeToolCallSchema,
  readToolCallSchema,
  editToolCallSchema,
  globToolCallSchema,
  grepToolCallSchema,
  bashToolCallSchema,
  bashOutputToolCallSchema,
  taskToolCallSchema,
  todoWriteToolCallSchema,
] as const;

const fallbackToolCallSchema = baseToolCallShapeSchema;

export const toolCallMessageWithShapesSchema = z.union([...knownToolSchemas, fallbackToolCallSchema]);
export type ToolCallMessageWithShape = z.infer<typeof toolCallMessageWithShapesSchema>;

export const unifiedModelUsageSchema = z.object({
  model: z.string(),
  usage: unifiedTokenUsageSchema,
});

export const unifiedGitContextSchema = z
  .object({
    relativeCwd: z.string().nullable(),
    branch: z.string().nullable(),
    repo: z.string().nullable(),
  })
  .strict()
  .nullable();

export const unifiedTranscriptSchema = z.object({
  v: z.literal(1),
  id: z.string(),
  source: z.enum(["claude-code", "codex", "opencode", "unknown"]),
  timestamp: z.coerce.date(), // Accept both Date and string (for JSON serialization)
  preview: z.string().nullable(),
  model: z.string().nullable(),
  blendedTokens: z.number(),
  costUsd: z.number(),
  messageCount: z.number(),
  tokenUsage: unifiedTokenUsageSchema,
  modelUsage: z.array(unifiedModelUsageSchema),
  git: unifiedGitContextSchema,
  cwd: z.string().nullable(),
  messages: z.array(unifiedTranscriptMessageSchema),
});
