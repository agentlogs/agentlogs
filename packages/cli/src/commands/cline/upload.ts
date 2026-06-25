/**
 * Cline Upload Command
 *
 * Manually upload a Cline task transcript to AgentLogs.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { convertClineTranscript, type ClineMessage, type ClineTaskMetadata, type UploadBlob } from "@agentlogs/shared";
import { LiteLLMPricingFetcher } from "@agentlogs/shared/pricing";
import { resolveGitContext } from "@agentlogs/shared/claudecode";
import { skipMessageLines, uploadUnifiedToAllEnvs } from "../../lib/perform-upload";

const CLINE_TASKS_DIR = join(homedir(), ".cline", "data", "tasks");

/**
 * Read a Cline task from api_conversation_history.json.
 */
function readTaskFile(filePath: string): { messages: ClineMessage[]; metadata?: ClineTaskMetadata } | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const messages = JSON.parse(content) as ClineMessage[];

    // Try to load metadata from sibling file
    let metadata: ClineTaskMetadata | undefined;
    const metadataPath = join(filePath, "..", "task_metadata.json");
    if (existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(readFileSync(metadataPath, "utf-8")) as ClineTaskMetadata;
      } catch {
        // Skip invalid metadata
      }
    }

    return { messages, metadata };
  } catch {
    return null;
  }
}

/**
 * Find a task by ID.
 */
function findTaskById(taskId: string): string | null {
  const taskDir = join(CLINE_TASKS_DIR, taskId);
  const conversationPath = join(taskDir, "api_conversation_history.json");

  if (existsSync(conversationPath)) {
    return conversationPath;
  }

  // Search through all task directories for partial match
  if (!existsSync(CLINE_TASKS_DIR)) {
    return null;
  }

  for (const dir of readdirSync(CLINE_TASKS_DIR)) {
    if (dir.includes(taskId)) {
      const path = join(CLINE_TASKS_DIR, dir, "api_conversation_history.json");
      if (existsSync(path)) {
        return path;
      }
    }
  }

  return null;
}

/**
 * List recent Cline tasks.
 */
function listRecentTasks(limit: number = 10): Array<{ path: string; id: string; mtime: Date; preview: string }> {
  const tasks: Array<{ path: string; id: string; mtime: Date; preview: string }> = [];

  if (!existsSync(CLINE_TASKS_DIR)) {
    return tasks;
  }

  for (const taskDir of readdirSync(CLINE_TASKS_DIR)) {
    const conversationPath = join(CLINE_TASKS_DIR, taskDir, "api_conversation_history.json");
    if (!existsSync(conversationPath)) continue;

    try {
      const stat = statSync(conversationPath);
      // Try to extract preview from first user message
      let preview = "";
      const content = readFileSync(conversationPath, "utf-8");
      const taskMatch = content.match(/<task>\n?([\s\S]*?)\n?<\/task>/);
      if (taskMatch && taskMatch[1]) {
        preview = taskMatch[1].trim().slice(0, 60);
      }

      tasks.push({
        path: conversationPath,
        id: taskDir,
        mtime: stat.mtime,
        preview,
      });
    } catch {
      // Skip files we can't parse
    }
  }

  // Sort by mtime descending
  tasks.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return tasks.slice(0, limit);
}

export async function clineUploadCommand(taskIdOrPath?: string): Promise<void> {
  // If no argument, list recent tasks
  if (!taskIdOrPath) {
    console.log("Recent Cline tasks:");
    console.log("");

    const tasks = listRecentTasks(10);
    if (tasks.length === 0) {
      console.log("No tasks found in", CLINE_TASKS_DIR);
      process.exit(1);
    }

    for (const task of tasks) {
      const dateStr = task.mtime.toLocaleString();
      console.log(`  ${task.id.substring(0, 13)}...  ${dateStr}`);
      if (task.preview) {
        console.log(`    ${task.preview}`);
      }
      console.log("");
    }

    console.log("Usage: agentlogs cline upload <task-id-or-path>");
    process.exit(0);
  }

  // Determine if argument is a path or task ID
  let taskFile: string;
  const expandedPath = taskIdOrPath.startsWith("~") ? taskIdOrPath.replace(/^~/, homedir()) : taskIdOrPath;

  if (existsSync(expandedPath)) {
    // If it's a directory, look for api_conversation_history.json inside
    const stat = statSync(expandedPath);
    if (stat.isDirectory()) {
      const conversationPath = join(expandedPath, "api_conversation_history.json");
      if (existsSync(conversationPath)) {
        taskFile = conversationPath;
      } else {
        console.error(`Error: No api_conversation_history.json found in: ${expandedPath}`);
        process.exit(1);
      }
    } else {
      taskFile = expandedPath;
    }
  } else {
    const found = findTaskById(taskIdOrPath);
    if (!found) {
      console.error(`Error: Task not found: ${taskIdOrPath}`);
      console.error(`Searched in: ${CLINE_TASKS_DIR}`);
      process.exit(1);
    }
    taskFile = found;
  }

  // Derive task ID from directory name
  const taskId = basename(join(taskFile, ".."));
  console.log(`Uploading Cline task: ${taskId}`);

  // Read task
  const taskData = readTaskFile(taskFile);
  if (!taskData) {
    console.error(`Error: Failed to read task file: ${taskFile}`);
    process.exit(1);
  }

  const messageCount = taskData.messages.length;
  console.log(`Task: ${taskId} (${messageCount} messages)`);

  // Fetch pricing data
  const pricingFetcher = new LiteLLMPricingFetcher();
  const pricingData = await pricingFetcher.fetchModelPricing();
  const pricing = Object.fromEntries(pricingData);

  // Resolve git context from cwd
  const cwd = process.cwd();
  const gitContext = await resolveGitContext(cwd, undefined);

  if (gitContext?.repo) {
    console.log(`Repository: ${gitContext.repo}`);
  }

  // Extract client version from metadata
  const clientVersion = taskData.metadata?.environment_history?.[0]?.cline_version;

  // Convert to unified format
  console.log("Converting transcript...");
  const result = convertClineTranscript(taskData.messages, {
    pricing,
    gitContext,
    cwd,
    taskId,
    metadata: taskData.metadata,
    clientVersion,
  });

  if (!result) {
    console.error("Error: Failed to convert transcript");
    process.exit(1);
  }

  // Convert blobs Map to UploadBlob array
  const uploadBlobs: UploadBlob[] = [];
  for (const [sha256, blob] of result.blobs) {
    uploadBlobs.push({
      sha256,
      data: new Uint8Array(blob.data),
      mediaType: blob.mediaType,
    });
  }

  // Upload
  console.log("Uploading...");
  const uploadResult = await uploadUnifiedToAllEnvs({
    unifiedTranscript: result.transcript,
    sessionId: taskId,
    cwd,
    blobs: uploadBlobs.length > 0 ? uploadBlobs : undefined,
  });

  // Handle results
  if (uploadResult.skipped) {
    for (const line of skipMessageLines(uploadResult.candidatesSeen)) {
      console.log(line);
    }
    process.exit(0);
  }

  if (uploadResult.anySuccess && uploadResult.id) {
    console.log("");
    console.log("Upload successful!");
    console.log(`Transcript ID: ${uploadResult.id}`);

    for (const envResult of uploadResult.results) {
      if (envResult.success) {
        const url = `${envResult.baseURL}/s/${uploadResult.id}`;
        console.log(`View: ${url}`);
      }
    }
  } else {
    console.error("");
    console.error("Upload failed:");
    for (const envResult of uploadResult.results) {
      if (!envResult.success && envResult.error) {
        console.error(`  ${envResult.envName}: ${envResult.error}`);
      }
    }
    process.exit(1);
  }
}
