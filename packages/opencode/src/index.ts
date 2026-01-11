/**
 * Vibe Insights OpenCode Plugin
 *
 * Automatically captures and uploads transcripts from OpenCode sessions.
 * Also enhances git commits with transcript links.
 *
 * @example
 * // opencode.json
 * {
 *   "plugin": ["@vibeinsights/opencode-plugin"]
 * }
 *
 * @example
 * // Environment variables
 * VI_AUTH_TOKEN=your_auth_token
 * VI_SERVER_URL=https://vibeinsights.dev  // optional
 */

import type { OpenCodeMessage, OpenCodeSession } from "@vibeinsights/shared";
import { appendTranscriptLinkToCommit, extractGitContext, isGitCommitCommand, type PluginContext } from "./git";
import { buildTranscriptUrl, uploadOpenCodeTranscript } from "./upload";

// ============================================================================
// Types
// ============================================================================

/**
 * OpenCode plugin interface (based on @opencode-ai/plugin)
 */
export interface Plugin {
  (ctx: OpenCodePluginContext): Promise<PluginHooks>;
}

export interface OpenCodePluginContext extends PluginContext {
  project?: {
    id: string;
    path: string;
  };
}

export interface PluginHooks {
  event?: (event: PluginEvent) => Promise<void>;
  tool?: {
    execute?: {
      before?: (args: ToolExecuteArgs) => Promise<ToolExecuteArgs>;
      after?: (args: ToolExecuteArgs, result: unknown) => Promise<unknown>;
    };
  };
}

export interface PluginEvent {
  type: string;
  session?: OpenCodeSession;
  message?: OpenCodeMessage;
  [key: string]: unknown;
}

export interface ToolExecuteArgs {
  name: string;
  input: unknown;
  [key: string]: unknown;
}

// ============================================================================
// Plugin State
// ============================================================================

interface PluginState {
  currentSessionId: string | null;
  currentSession: OpenCodeSession | null;
  messages: OpenCodeMessage[];
  pendingTranscriptId: string | null;
  isUploading: boolean;
}

// ============================================================================
// Main Plugin
// ============================================================================

/**
 * Vibe Insights plugin for OpenCode.
 *
 * Features:
 * - Automatically uploads transcripts when sessions become idle
 * - Enhances git commits with transcript links
 * - Tracks session and message state
 */
export const vibeInsightsPlugin: Plugin = async (ctx) => {
  // Initialize state
  const state: PluginState = {
    currentSessionId: null,
    currentSession: null,
    messages: [],
    pendingTranscriptId: null,
    isUploading: false,
  };

  // Log plugin initialization
  console.log("[vibeinsights] Plugin initialized");

  return {
    /**
     * Handle OpenCode events
     */
    event: async (event) => {
      try {
        switch (event.type) {
          case "session.created":
            handleSessionCreated(state, event);
            break;

          case "session.updated":
            handleSessionUpdated(state, event);
            break;

          case "message.updated":
            handleMessageUpdated(state, event);
            break;

          case "session.idle":
            await handleSessionIdle(state, ctx);
            break;

          case "session.deleted":
            handleSessionDeleted(state, event);
            break;
        }
      } catch (error) {
        console.error("[vibeinsights] Event handler error:", error);
      }
    },

    /**
     * Intercept tool execution
     */
    tool: {
      execute: {
        /**
         * Before tool execution - intercept git commits to add transcript link
         */
        before: async (args) => {
          try {
            // Check if this is a shell/bash tool with git commit
            if ((args.name === "shell" || args.name === "bash") && isGitCommitCommand(args.input)) {
              // If we have a pending transcript, add the link
              if (state.pendingTranscriptId) {
                const transcriptUrl = buildTranscriptUrl(state.pendingTranscriptId);
                const modifiedInput = appendTranscriptLinkToCommit(args.input, transcriptUrl);

                if (modifiedInput) {
                  console.log("[vibeinsights] Added transcript link to commit message");
                  return { ...args, input: modifiedInput };
                }
              } else {
                // No pending transcript - try to upload now and get ID
                const uploadResult = await uploadCurrentSession(state, ctx);
                if (uploadResult?.transcriptId) {
                  state.pendingTranscriptId = uploadResult.transcriptId;
                  const transcriptUrl = buildTranscriptUrl(uploadResult.transcriptId);
                  const modifiedInput = appendTranscriptLinkToCommit(args.input, transcriptUrl);

                  if (modifiedInput) {
                    console.log("[vibeinsights] Uploaded transcript and added link to commit");
                    return { ...args, input: modifiedInput };
                  }
                }
              }
            }
          } catch (error) {
            console.error("[vibeinsights] tool.execute.before error:", error);
          }

          return args;
        },
      },
    },
  };
};

// ============================================================================
// Event Handlers
// ============================================================================

function handleSessionCreated(state: PluginState, event: PluginEvent): void {
  if (event.session) {
    state.currentSessionId = event.session.id;
    state.currentSession = event.session;
    state.messages = [];
    state.pendingTranscriptId = null;
    console.log(`[vibeinsights] Session created: ${event.session.id}`);
  }
}

function handleSessionUpdated(state: PluginState, event: PluginEvent): void {
  if (event.session && event.session.id === state.currentSessionId) {
    state.currentSession = event.session;
  }
}

function handleMessageUpdated(state: PluginState, event: PluginEvent): void {
  if (event.message && event.message.sessionId === state.currentSessionId) {
    // Update or add message
    const existingIndex = state.messages.findIndex((m) => m.id === event.message!.id);
    if (existingIndex >= 0) {
      state.messages[existingIndex] = event.message;
    } else {
      state.messages.push(event.message);
    }
  }
}

async function handleSessionIdle(state: PluginState, ctx: OpenCodePluginContext): Promise<void> {
  if (!state.currentSession || state.messages.length === 0) {
    return;
  }

  // Don't upload if already uploading
  if (state.isUploading) {
    return;
  }

  console.log(`[vibeinsights] Session idle, uploading transcript...`);
  await uploadCurrentSession(state, ctx);
}

function handleSessionDeleted(state: PluginState, event: PluginEvent): void {
  if (event.session?.id === state.currentSessionId) {
    state.currentSessionId = null;
    state.currentSession = null;
    state.messages = [];
    state.pendingTranscriptId = null;
  }
}

// ============================================================================
// Upload Logic
// ============================================================================

async function uploadCurrentSession(
  state: PluginState,
  ctx: OpenCodePluginContext,
): Promise<{ transcriptId: string } | null> {
  if (!state.currentSession || state.messages.length === 0) {
    return null;
  }

  if (state.isUploading) {
    return state.pendingTranscriptId ? { transcriptId: state.pendingTranscriptId } : null;
  }

  state.isUploading = true;

  try {
    // Extract git context
    const gitContext = await extractGitContext(ctx);

    // Upload transcript
    const result = await uploadOpenCodeTranscript({
      session: state.currentSession,
      messages: state.messages,
      gitContext,
      cwd: ctx.directory,
    });

    if (result.success && result.transcriptId) {
      state.pendingTranscriptId = result.transcriptId;
      console.log(`[vibeinsights] Transcript uploaded: ${result.transcriptUrl}`);
      return { transcriptId: result.transcriptId };
    }

    if (result.error) {
      console.error(`[vibeinsights] Upload failed: ${result.error}`);
    }

    return null;
  } catch (error) {
    console.error("[vibeinsights] Upload error:", error);
    return null;
  } finally {
    state.isUploading = false;
  }
}

// ============================================================================
// Exports
// ============================================================================

export default vibeInsightsPlugin;
export { extractGitContext, isGitCommitCommand } from "./git";
export { uploadOpenCodeTranscript, buildTranscriptUrl } from "./upload";
