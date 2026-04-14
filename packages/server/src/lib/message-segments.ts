import type { UnifiedTranscriptMessage } from "@agentlogs/shared/claudecode";

export type MessageReference = { message: UnifiedTranscriptMessage; index: number };

export type CollapsedMessageSegmentItem =
  | { type: "steps"; messages: MessageReference[] }
  | {
      type: "steering";
      message: UnifiedTranscriptMessage & { type: "user"; variant: "steering" };
      index: number;
    };

export type MessageSegment =
  | { type: "important"; message: UnifiedTranscriptMessage; index: number }
  | {
      type: "collapsed";
      items: CollapsedMessageSegmentItem[];
      stepCount: number;
      steeringCount: number;
    };

/**
 * Internal fallback filter for user messages that should not render at all.
 * Most of these are already stripped during ingest.
 */
export function isInternalMessage(text: string): boolean {
  const internalPatterns = [/^<local-command-caveat>.*<\/local-command-caveat>/s];
  const trimmed = text.trim();
  return internalPatterns.some((pattern) => pattern.test(trimmed));
}

export function isSteeringMessage(
  message: UnifiedTranscriptMessage,
): message is UnifiedTranscriptMessage & { type: "user"; variant: "steering" } {
  return message.type === "user" && message.variant === "steering";
}

/**
 * Important messages stay expanded.
 * User and command messages are always important.
 * Agent messages are important only when they are the last assistant response
 * before the next user/command prompt, or the final agent message in the log.
 */
export function isImportantMessage(
  message: UnifiedTranscriptMessage,
  index: number,
  messages: UnifiedTranscriptMessage[],
): boolean {
  if (message.type === "user") {
    return !isSteeringMessage(message);
  }

  if (message.type === "command") {
    return true;
  }

  if (message.type === "agent") {
    for (let i = index + 1; i < messages.length; i++) {
      const nextMsg = messages[i];
      if (nextMsg.type === "command") {
        return true;
      }

      if (isSteeringMessage(nextMsg)) {
        continue;
      }

      if (nextMsg.type === "user") {
        return true;
      }

      if (nextMsg.type === "agent") {
        return false;
      }
    }

    return true;
  }

  return false;
}

function buildCollapsedSegment(messages: MessageReference[]): MessageSegment | null {
  if (messages.length === 0) {
    return null;
  }

  const items: CollapsedMessageSegmentItem[] = [];
  let currentStepGroup: MessageReference[] = [];
  let stepCount = 0;
  let steeringCount = 0;

  for (const messageRef of messages) {
    if (isSteeringMessage(messageRef.message)) {
      if (currentStepGroup.length > 0) {
        items.push({ type: "steps", messages: currentStepGroup });
        currentStepGroup = [];
      }

      items.push({
        type: "steering",
        message: messageRef.message,
        index: messageRef.index,
      });
      steeringCount++;
      continue;
    }

    currentStepGroup.push(messageRef);
    stepCount++;
  }

  if (currentStepGroup.length > 0) {
    items.push({ type: "steps", messages: currentStepGroup });
  }

  return {
    type: "collapsed",
    items,
    stepCount,
    steeringCount,
  };
}

export function groupMessagesIntoSegments(messages: UnifiedTranscriptMessage[]): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let currentCollapsedGroup: MessageReference[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    if (message.type === "user" && isInternalMessage(message.text)) {
      continue;
    }

    if (isImportantMessage(message, i, messages)) {
      if (currentCollapsedGroup.length > 0) {
        const collapsedSegment = buildCollapsedSegment(currentCollapsedGroup);
        if (collapsedSegment) {
          segments.push(collapsedSegment);
        }
        currentCollapsedGroup = [];
      }

      segments.push({ type: "important", message, index: i });
      continue;
    }

    currentCollapsedGroup.push({ message, index: i });
  }

  if (currentCollapsedGroup.length > 0) {
    const collapsedSegment = buildCollapsedSegment(currentCollapsedGroup);
    if (collapsedSegment) {
      segments.push(collapsedSegment);
    }
  }

  return segments;
}
