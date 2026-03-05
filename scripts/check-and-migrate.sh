#!/usr/bin/env bash

# Auto-migration script for local D1 database
# This ensures migrations are always up to date before starting dev server

set -e

cd "$(dirname "$0")/../packages/server" || exit 1

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 Checking for pending database migrations...${NC}"

# Find the local D1 database file
DB_FILE=$(find .wrangler/state/v3/d1/miniflare-D1DatabaseObject -type f -name '*.sqlite' -print -quit 2>/dev/null || echo "")

# If no database exists, initialize it
if [ -z "$DB_FILE" ] || [ ! -f "$DB_FILE" ]; then
  echo -e "${YELLOW}⚠️  No local database found. Initializing...${NC}"
  bun run db:migrate
  echo -e "${GREEN}✅ Database initialized successfully${NC}"
  exit 0
fi

# Get list of applied migrations from the database
APPLIED_MIGRATIONS=$(sqlite3 "$DB_FILE" "SELECT name FROM d1_migrations ORDER BY id;" 2>/dev/null || echo "")

# Get list of migration files
MIGRATION_FILES=$(ls migrations/*.sql 2>/dev/null | xargs -n 1 basename | sort)

# Count migrations
APPLIED_COUNT=$(echo "$APPLIED_MIGRATIONS" | grep -c "\.sql" || echo "0")
TOTAL_COUNT=$(echo "$MIGRATION_FILES" | grep -c "\.sql" || echo "0")

# Check if there are pending migrations
PENDING_COUNT=$((TOTAL_COUNT - APPLIED_COUNT))

if [ "$PENDING_COUNT" -eq 0 ]; then
  echo -e "${GREEN}✅ Database is up to date ($APPLIED_COUNT migrations applied)${NC}"
  exit 0
fi

# Display pending migrations
echo -e "${YELLOW}📋 Found $PENDING_COUNT pending migration(s):${NC}"
echo "$MIGRATION_FILES" | while read -r migration; do
  if ! echo "$APPLIED_MIGRATIONS" | grep -q "$migration"; then
    echo "  - $migration"
  fi
done

# Apply pending migrations
echo -e "${BLUE}🔄 Applying pending migrations...${NC}"
bun run db:migrate

echo -e "${GREEN}✅ Successfully applied $PENDING_COUNT migration(s)${NC}"
