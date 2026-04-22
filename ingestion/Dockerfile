FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD node -e "const fs=require('node:fs'); const path=process.env.INGEST_HEALTH_FILE_PATH||'/tmp/ingestion-health.json'; const staleMs=(Number.parseInt(process.env.INGEST_HEALTH_MAX_STALE_SECONDS||'420',10)||420)*1000; const raw=fs.readFileSync(path,'utf-8'); const data=JSON.parse(raw); const last=Date.parse(data.last_cycle_finished_at||''); if(!Number.isFinite(last)){process.exit(1)} if(Date.now()-last>staleMs){process.exit(1)}"
CMD ["node", "dist/index.js"]
