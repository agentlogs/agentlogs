import { describe, expect, test } from "bun:test";

import { getStandaloneRuntimeFlags } from "./standalone-flags";

describe("getStandaloneRuntimeFlags", () => {
  test("runs migrations before starting the server by default", () => {
    expect(getStandaloneRuntimeFlags([])).toEqual({
      onlyMigrations: false,
      runMigrations: true,
    });
  });

  test("skips migrations when explicitly requested", () => {
    expect(getStandaloneRuntimeFlags(["--no-migrations"])).toEqual({
      onlyMigrations: false,
      runMigrations: false,
    });
  });

  test("runs only migrations when requested", () => {
    expect(getStandaloneRuntimeFlags(["--only-migrations"])).toEqual({
      onlyMigrations: true,
      runMigrations: true,
    });
  });

  test("rejects unknown flags", () => {
    expect(() => getStandaloneRuntimeFlags(["--migrations"])).toThrow("Unknown standalone runtime flag: --migrations.");
  });

  test("rejects conflicting migration flags", () => {
    expect(() => getStandaloneRuntimeFlags(["--no-migrations", "--only-migrations"])).toThrow(
      "Cannot combine --only-migrations with --no-migrations.",
    );
  });
});
