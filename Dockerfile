FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `env.ts` validates the whole environment at import, and `next build` imports
# the route modules while collecting page data — so the build fails without
# syntactically valid values even though it never contacts a provider. These
# placeholders exist only in this stage. Real credentials arrive at runtime,
# and the app still fails fast at container start when any are missing.
ENV DATABASE_URL=postgresql://placeholder:5432/placeholder \
    SESSION_PASSWORD=build-time-placeholder-at-least-32-characters \
    APP_URL=http://localhost:3000 \
    GITHUB_CLIENT_ID=placeholder \
    GITHUB_CLIENT_SECRET=placeholder \
    DISCORD_CLIENT_ID=placeholder \
    DISCORD_CLIENT_SECRET=placeholder \
    TELEGRAM_CLIENT_ID=placeholder \
    TELEGRAM_CLIENT_SECRET=placeholder \
    CONTRIBUTORS_EXPORT_SECRET=placeholder \
    CONTRIBUTORS_SYNC_SECRET=placeholder \
    TRACKS_SYNC_SECRET=placeholder \
    ARTIFACT_LINKS_SYNC_SECRET=placeholder \
    TRACK_PAGE_TEMPLATE_SYNC_SECRET=placeholder \
    CONFIG_SYNC_SECRET=placeholder \
    TRACK_MEMBERS_EXPORT_SECRET=placeholder
RUN pnpm build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json pnpm-workspace.yaml next.config.ts ./
COPY migrations ./migrations
EXPOSE 3000
CMD ["sh", "-c", "node migrations/run.ts && pnpm start"]
