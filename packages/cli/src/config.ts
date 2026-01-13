import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Entry } from "@napi-rs/keyring";
import { NODE_ENV } from "./env-config";

const CONFIG_DIR = join(homedir(), ".config", "agentlogs");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const KEYRING_SERVICE = "agentlogs-cli";

/**
 * Get the environment-specific account name for keyring storage
 * Development and production accounts are stored separately
 */
function getKeychainAccount(email: string): string {
  return NODE_ENV === "production" ? `prod:${email}` : `dev:${email}`;
}

interface Config {
  baseURL?: string;
  user?: {
    id: string;
    email: string;
    name: string;
  };
  lastLoginTime?: string;
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Read the config file
 */
export function readConfig(): Config {
  ensureConfigDir();

  if (!existsSync(CONFIG_FILE)) {
    return {};
  }

  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error("Failed to read config file:", error);
    return {};
  }
}

/**
 * Write to the config file
 */
export function writeConfig(config: Config): void {
  ensureConfigDir();

  try {
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to write config file:", error);
    throw error;
  }
}

/**
 * Get the access token from the OS keychain
 * Uses environment-specific account names
 */
export function getToken(): string | null {
  const envToken = process.env.AGENTLOGS_AUTH_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  try {
    const config = readConfig();
    if (!config.user?.email) {
      return null;
    }

    const account = getKeychainAccount(config.user.email);
    const entry = new Entry(KEYRING_SERVICE, account);
    const token = entry.getPassword();
    return token;
  } catch {
    // Token doesn't exist or couldn't be retrieved
    return null;
  }
}

/**
 * Set the access token in the OS keychain
 * Uses environment-specific account names
 */
export function setToken(email: string, token: string): void {
  try {
    const account = getKeychainAccount(email);
    const entry = new Entry(KEYRING_SERVICE, account);
    entry.setPassword(token);
  } catch (error) {
    console.error("Failed to store token in keychain:", error);
    throw error;
  }
}

/**
 * Delete the access token from the OS keychain
 * Uses environment-specific account names
 */
export function deleteToken(): void {
  try {
    const config = readConfig();
    if (!config.user?.email) {
      return;
    }

    const account = getKeychainAccount(config.user.email);
    const entry = new Entry(KEYRING_SERVICE, account);
    entry.deletePassword();
  } catch {
    // Token doesn't exist or couldn't be deleted - that's okay
  }
}
