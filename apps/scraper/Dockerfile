# ---- Builder ----
FROM node:20-alpine AS builder
WORKDIR /app

# Copy root + every workspace manifest so npm can resolve the workspace graph
COPY package.json package-lock.json ./
COPY libs/shared/package.json libs/shared/
COPY apps/api/package.json apps/api/
COPY apps/job-manager/package.json apps/job-manager/
COPY apps/scraper/package.json apps/scraper/
RUN npm ci

# Build the shared lib + this app only
COPY tsconfig.base.json ./
COPY libs/shared libs/shared
COPY apps/scraper apps/scraper
RUN npm run build:shared && npm run build -w @netnut/scraper

# Drop dev dependencies for the runtime image
RUN npm prune --omit=dev

# ---- Runtime ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs/shared/dist ./libs/shared/dist
COPY --from=builder /app/libs/shared/package.json ./libs/shared/package.json
COPY --from=builder /app/apps/scraper/dist ./apps/scraper/dist
COPY --from=builder /app/apps/scraper/package.json ./apps/scraper/package.json
WORKDIR /app/apps/scraper
CMD ["node", "dist/main"]
