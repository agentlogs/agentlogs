import { useSyncExternalStore } from "react";

const DEBUG_MODE_KEY = "debug";

function getSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEBUG_MODE_KEY) === "1";
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(callback: () => void): () => void {
  const handleStorage = (e: StorageEvent) => {
    if (e.key === DEBUG_MODE_KEY) {
      callback();
    }
  };

  // Listen for storage events from other tabs
  window.addEventListener("storage", handleStorage);

  // Also listen for our custom event for same-tab updates
  window.addEventListener("debug-mode-change", callback);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener("debug-mode-change", callback);
  };
}

export function useDebugMode(): [boolean, (enabled: boolean) => void] {
  const debugMode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setDebugMode = (enabled: boolean) => {
    if (enabled) {
      localStorage.setItem(DEBUG_MODE_KEY, "1");
    } else {
      localStorage.removeItem(DEBUG_MODE_KEY);
    }
    // Dispatch custom event for same-tab listeners
    window.dispatchEvent(new CustomEvent("debug-mode-change"));
  };

  return [debugMode, setDebugMode];
}
