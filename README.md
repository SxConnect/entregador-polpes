# entregador-polpes

Módulo independente de entregas próprias e rastreamento em tempo real para a plataforma Polpes e lojas parceiras.

## 📌 Visão Geral
- **Backend**: Node.js + TypeScript + Fastify + Prisma ORM + PostgreSQL
- **PWA Entregador**: Mobile-first PWA instalável (React + Vite + TypeScript + Tailwind CSS)
- **Rastreio Público**: Tela `/t/:token` para o cliente final acompanhar o entregador no mapa
- **Multi-Tenant**: Total isolamento por loja (`store_id`), autenticação por API key hash e webhooks assinados com HMAC-SHA256

## 🚀 Arquitetura
```
entregador-polpes/
├── backend/          # API Fastify + Prisma ORM + Webhooks HMAC
├── pwa/              # PWA "Entregador" (React + Vite + Service Worker)
├── docker-compose.yml# Banco de dados PostgreSQL 16
├── .env.example      # Variáveis de ambiente
└── docs/             # Contratos de integração e documentação legal (LGPD)
```

## 🛠️ Como Executar Localmente

### 1. Iniciar Banco PostgreSQL
```bash
docker compose up -d db
```

### 2. Configurar Variáveis de Ambiente
```bash
cp .env.example backend/.env
```

### 3. Instalar Dependências e Migrar Banco
```bash
cd backend
npm install
npx prisma db push
```

### 4. Executar em Desenvolvimento
```bash
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: PWA
cd pwa && npm run dev
```
