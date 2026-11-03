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
RUN apk add --no-cache openssl libc6-compat

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

CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/server.js"]
