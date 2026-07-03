# ---- build stage: compile TS + native better-sqlite3 ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY index.ts ./
COPY utils ./utils
RUN npm run build
# Drop dev dependencies but keep the compiled better-sqlite3 binary
RUN npm prune --omit=dev

# ---- runtime stage: slim, non-root, HTTP transport ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN useradd --create-home --uid 10001 appuser
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /data /exports && chown -R appuser:appuser /app /data /exports
USER appuser
ENV MCP_TRANSPORT=http \
    MCP_HTTP_PORT=9807 \
    GRAVITY_FORMS_CACHE_DB_PATH=/data/forms-cache.db \
    GRAVITY_FORMS_EXPORT_DIR=/exports
EXPOSE 9807
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_HTTP_PORT||9807)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
