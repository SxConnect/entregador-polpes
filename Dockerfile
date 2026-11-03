# =====================================================================
# Dockerfile: entregador-polpes (Backend Fastify + PWA React Integrado)
# =====================================================================

# ── Stage 1: Build PWA ────────────────────────────────────────────────
FROM node:20-alpine AS pwa-builder
WORKDIR /app/pwa

COPY pwa/package*.json ./
RUN npm ci

COPY pwa/ ./
RUN npm run build

# ── Stage 2: Build Backend ────────────────────────────────────────────
FROM node:20-alpine AS backend-builder
WORKDIR /app/backend
RUN apk add --no-cache openssl libc6-compat

COPY backend/package*.json ./
RUN npm ci

COPY backend/prisma ./prisma
RUN npx prisma generate

COPY backend/ ./
RUN npm run build

# ── Stage 3: Runner (Produção) ─────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat curl

ENV NODE_ENV=production
ENV PORT=4001
ENV HOST=0.0.0.0

# Instala apenas dependências de produção
COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/prisma ./prisma
RUN npx prisma generate

COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=pwa-builder /app/pwa/dist ./pwa-dist

# Cria diretório de uploads e copia logos padrão
RUN mkdir -p /app/uploads/logos
COPY pwa/public/logo-polpes.png /app/uploads/logos/logo-polpes.png
COPY pwa/public/logo-default.png /app/uploads/logos/logo-default.png

EXPOSE 4001

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:4001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/server.js"]
