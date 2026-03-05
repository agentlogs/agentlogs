# syntax=docker/dockerfile:1.7

# Builder stage compiles the app for the target container architecture.
FROM --platform=$BUILDPLATFORM oven/bun:1.3.10 AS build
ARG TARGETARCH
WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages

# Only install what web build needs in this monorepo, skip lifecycle scripts.
RUN bun install --frozen-lockfile --ignore-scripts --filter ./packages/shared --filter ./packages/web

# Force Linux target binary, with architecture from Docker build target.
ENV BUN_BINARY_TARGET=linux
ENV BUN_BINARY_ARCH=${TARGETARCH}
RUN bun run --filter ./packages/web build

# Runtime stage only contains compiled output.
FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN useradd --create-home --uid 10001 app

COPY --from=build /app/packages/web/dist/agentlogs-web /app/agentlogs-web
COPY --from=build /app/packages/web/migrations /app/migrations

RUN mkdir -p /app/.data/storage \
  && chown -R app:app /app \
  && chmod +x /app/agentlogs-web

USER app
EXPOSE 3000

CMD ["/app/agentlogs-web"]
