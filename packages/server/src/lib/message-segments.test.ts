import type { UnifiedTranscriptMessage } from "@agentlogs/shared/claudecode";
import { describe, expect, test } from "bun:test";
import { groupMessagesIntoSegments, isImportantMessage, isSteeringMessage } from "./message-segments";

describe("isImportantMessage", () => {
  test("keeps only the last assistant message before the next user prompt expanded", () => {
    const messages = [
      { type: "agent", text: "First update" },
      { type: "agent", text: "Last update" },
      { type: "user", text: "Next prompt" },
    ] satisfies UnifiedTranscriptMessage[];

    expect(isImportantMessage(messages[0], 0, messages)).toBe(false);

    expect(isImportantMessage(messages[1], 1, messages)).toBe(true);
  });

  test("collapses operational steps", () => {
    const messages = [
      { type: "tool-call", toolName: "Bash" },
      { type: "thinking", text: "Inspecting logs" },
    ] satisfies UnifiedTranscriptMessage[];

    expect(isImportantMessage(messages[0], 0, messages)).toBe(false);

    expect(isImportantMessage(messages[1], 1, messages)).toBe(false);
  });

  test("treats steering prompts as hidden within collapsed sections", () => {
    const messages = [
      { type: "user", text: "normal prompt" },
      { type: "user", text: "use bin/serve locally", variant: "steering" },
    ] satisfies UnifiedTranscriptMessage[];

    expect(isSteeringMessage(messages[1])).toBe(true);
    expect(isImportantMessage(messages[1], 1, messages)).toBe(false);
  });
});

describe("groupMessagesIntoSegments", () => {
  test("collapses intermediate assistant updates until the last one before the next user prompt", () => {
    const messages = [
      { type: "user", text: "Build the app" },
      { type: "thinking", text: "Planning" },
      { type: "agent", text: "Let me start by planning this out and then building it." },
      { type: "tool-call", toolName: "Bash" },
      { type: "agent", text: "Good, now let me build the app structure." },
      { type: "tool-call", toolName: "Write" },
      { type: "agent", text: "Now the deployment files." },
      { type: "user", text: "Check with the web browser skill" },
    ] satisfies UnifiedTranscriptMessage[];

    expect(groupMessagesIntoSegments(messages)).toEqual([
      { type: "important", message: messages[0], index: 0 },
      {
        type: "collapsed",
        stepCount: 5,
        steeringCount: 0,
        items: [
          {
            type: "steps",
            messages: [
              { message: messages[1], index: 1 },
              { message: messages[2], index: 2 },
              { message: messages[3], index: 3 },
              { message: messages[4], index: 4 },
              { message: messages[5], index: 5 },
            ],
          },
        ],
      },
      { type: "important", message: messages[6], index: 6 },
      { type: "important", message: messages[7], index: 7 },
    ]);
  });

  test("creates two-level collapsed groups around steering messages", () => {
    const messages = [
      { type: "user", text: "Build the app" },
      { type: "thinking", text: "Planning" },
      { type: "agent", text: "Working through local setup." },
      { type: "tool-call", toolName: "Bash" },
      { type: "user", text: "use bin/serve locally", variant: "steering" },
      { type: "thinking", text: "Checking wrapper" },
      { type: "tool-call", toolName: "Write" },
      { type: "agent", text: "Done, inspect it now." },
      { type: "user", text: "What changed?" },
    ] satisfies UnifiedTranscriptMessage[];
    const steeringMessage = messages[4] as UnifiedTranscriptMessage & { type: "user"; variant: "steering" };

    expect(groupMessagesIntoSegments(messages)).toEqual([
      { type: "important", message: messages[0], index: 0 },
      {
        type: "collapsed",
        stepCount: 5,
        steeringCount: 1,
        items: [
          {
            type: "steps",
            messages: [
              { message: messages[1], index: 1 },
              { message: messages[2], index: 2 },
              { message: messages[3], index: 3 },
            ],
          },
          {
            type: "steering",
            message: steeringMessage,
            index: 4,
          },
          {
            type: "steps",
            messages: [
              { message: messages[5], index: 5 },
              { message: messages[6], index: 6 },
            ],
          },
        ],
      },
      { type: "important", message: messages[7], index: 7 },
      { type: "important", message: messages[8], index: 8 },
    ]);
  });
});
