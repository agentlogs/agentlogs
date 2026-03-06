export const NO_MIGRATIONS_FLAG = "--no-migrations";
export const ONLY_MIGRATIONS_FLAG = "--only-migrations";
const SUPPORTED_FLAGS = new Set([NO_MIGRATIONS_FLAG, ONLY_MIGRATIONS_FLAG]);

export type StandaloneRuntimeFlags = {
  onlyMigrations: boolean;
  runMigrations: boolean;
};

export function getStandaloneRuntimeFlags(argv: string[] = process.argv.slice(2)): StandaloneRuntimeFlags {
  for (const arg of argv) {
    if (!SUPPORTED_FLAGS.has(arg)) {
      throw new Error(`Unknown standalone runtime flag: ${arg}.`);
    }
  }

  const args = new Set(argv);
  const onlyMigrations = args.has(ONLY_MIGRATIONS_FLAG);
  const noMigrations = args.has(NO_MIGRATIONS_FLAG);

  if (onlyMigrations && noMigrations) {
    throw new Error(`Cannot combine ${ONLY_MIGRATIONS_FLAG} with ${NO_MIGRATIONS_FLAG}.`);
  }

  return {
    onlyMigrations,
    runMigrations: onlyMigrations || !noMigrations,
  };
}
