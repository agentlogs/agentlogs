import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

interface BucketGetResult {
  body: ReadableStream<Uint8Array>;
  size: number;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

interface BucketHeadResult {
  size: number;
}

type BucketValue = string | Blob | ArrayBuffer | Uint8Array;

function toReadableStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

async function normalizeValue(value: BucketValue): Promise<Uint8Array> {
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }

  if (value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return value;
}

class LocalBucket {
  constructor(private readonly rootDir: string) {}

  private resolvePath(key: string): string {
    return path.join(this.rootDir, key);
  }

  async put(key: string, value: BucketValue, _options?: unknown): Promise<void> {
    const filePath = this.resolvePath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    const bytes = await normalizeValue(value);
    await writeFile(filePath, bytes);
  }

  async get(key: string): Promise<BucketGetResult | null> {
    const filePath = this.resolvePath(key);

    try {
      const bytes = await readFile(filePath);
      const uint8 = new Uint8Array(bytes);
      return {
        body: toReadableStream(uint8),
        size: uint8.byteLength,
        text: async () => bytes.toString("utf-8"),
        arrayBuffer: async () => uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength),
      };
    } catch {
      return null;
    }
  }

  async head(key: string): Promise<BucketHeadResult | null> {
    const filePath = this.resolvePath(key);

    try {
      const fileStat = await stat(filePath);
      return { size: fileStat.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    await rm(filePath, { force: true });
  }
}

const webUrl = process.env.WEB_URL || "http://localhost:3000";
const storageDir = process.env.STORAGE_DIR || ".data/storage";
const storageRoot = path.resolve(process.cwd(), storageDir);

export const env = {
  DB: process.env.DB_LOCAL_PATH || ".data/db.sqlite",
  BUCKET: new LocalBucket(storageRoot),
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || "local-dev-secret",
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || "",
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || "",
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  WEB_URL: webUrl,
};
