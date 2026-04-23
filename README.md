# InfoCliente

Sistema web (HTML + JavaScript) para **gestão e monitorização de Clientes e Gestão de Obras**, com **API Node/Express** e **Postgres (Prisma)**.

## Visão geral
- **Frontend**: páginas HTML (Tailwind via CDN) com JS modular (`type="module"`), consumindo a API via `fetch`.
- **Backend**: Express + Prisma + JWT (roles: `admin`, `operador`, `leitura`).
- **Banco**: Postgres.

## Estrutura do repositório
- `frontend/`: servidor estático + código das páginas
  - `frontend/server.js`: servidor do frontend (Express)
  - `frontend/src/pages/`: páginas HTML
  - `frontend/src/services/`: API/auth helpers
  - `frontend/src/shared/`: UI helpers e formatação
- `backend/`: API + Prisma
  - `backend/src/server.js`: servidor da API
  - `backend/src/routes/`: rotas (`auth`, `dashboard`, `clients`, `projects`)
  - `backend/prisma/schema.prisma`: modelos/tabelas
  - `backend/prisma/seed.js`: seed (usuários + dados demo)

## Requisitos
- Node.js (recomendado **18+**)
- Postgres (local ou container)

## Setup rápido (dev)

### 1) Banco de dados (Postgres)
Você precisa ter um Postgres acessível e uma `DATABASE_URL` válida.

Exemplo (local):
- `postgresql://postgres:SENHA@localhost:5432/InfoCliente?schema=public`

> Se você receber `P1000 Authentication failed`, a senha/usuário na `DATABASE_URL` está incorreta.

### 2) Backend (API)
1. Abra `backend/.env.example` e copie para `backend/.env`
2. Ajuste `DATABASE_URL` e `JWT_SECRET`
3. Instale e prepare:

```powershell
cd C:\Users\Evilonga\InfoCliente\backend
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run seed
```

4. Rode a API:

```powershell
npm run dev
```

- API: `http://localhost:4000`
- Healthcheck: `GET /health`

### 3) Frontend (servidor estático)
O frontend precisa rodar via servidor (não abrir o HTML direto) para suportar imports ES Modules.

```powershell
cd C:\Users\Evilonga\InfoCliente\frontend
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Página inicial: `/` → redireciona para `/Auth/login.html`

## Login (usuários seed)
Após `npm run seed` no backend, você pode usar:
- **admin**: `admin@InfoCliente.local` / `admin123`
- **operador**: `operador@InfoCliente.local` / `admin123`
- **leitura**: `leitura@InfoCliente.local` / `admin123`

## Permissões (roles)
- **leitura**: apenas `GET`.
- **operador**: `GET` + `POST/PATCH` em clientes/Gestão de Obras/transações/interações.
- **admin**: tudo.

## Páginas implementadas
As páginas abaixo já consomem a API:
- **Login**: `frontend/src/pages/Auth/login.html`
- **Dashboard**: `frontend/src/pages/Dashboard/index.html`
- **Clientes (lista)**: `frontend/src/pages/Clientes/clienteLista.html`
- **Cliente detalhe ()**: `frontend/src/pages/ClienteDetalhe/client.html?id=<clientId>`
- **Gestão de Obras (lista)**: `frontend/src/pages/Projectos/ProjectGeral.html`
- **Projeto detalhe**: `frontend/src/pages/Projectos/projectView.html?id=<projectId>`

## Endpoints principais (API)

### Auth
- `POST /auth/login`
- `GET /auth/me`

### Dashboard
- `GET /dashboard/metrics`
- `GET /dashboard/clients?search=&page=&pageSize=`
- `GET /dashboard/alerts`

### Clientes
- `GET /clients?search=&status=&industry=&sort=&page=&pageSize=`
- `POST /clients` (admin/operador)
- `GET /clients/:id`
- `PATCH /clients/:id` (admin/operador)
- `GET /clients/:id/interactions`
- `POST /clients/:id/interactions` (admin/operador)

### Gestão de Obras
- `GET /projects?search=&status=&region=&dateFrom=&dateTo=&sort=&page=&pageSize=`
- `POST /projects` (admin/operador)
- `GET /projects/:id`
- `PATCH /projects/:id` (admin/operador)
- `GET /projects/:id/transactions?search=&status=&category=&page=&pageSize=`
- `POST /projects/:id/transactions` (admin/operador)

## Variáveis de ambiente

### Backend (`backend/.env`)
- `DATABASE_URL`: conexão Postgres
- `JWT_SECRET`: segredo do JWT
- `PORT`: porta da API (default 4000)
- `FRONTEND_ORIGIN`: origem permitida no CORS (default `http://localhost:5173`)

### Frontend (`frontend/`)
- `PORT`: porta do servidor estático (default 5173)

## Troubleshooting

### Erro Prisma P1000 (Authentication failed)
- Verifique se o Postgres está rodando.
- Confirme usuário/senha na `DATABASE_URL`.
- Teste login no Postgres (psql/pgAdmin) com as mesmas credenciais.

### Navegador redireciona para login (401)
- Token inválido/expirado ou API desligada.
- Faça login novamente em `/Auth/login.html`.

### CORS / bloqueio no fetch
- Confirme `FRONTEND_ORIGIN` no `backend/.env` (por padrão `http://localhost:5173`).

## Scripts

### Backend
- `npm run dev`: API com nodemon
- `npm run start`: API (node)
- `npm run prisma:migrate`: migrations (via `prisma migrate dev`)
- `npm run seed`: popular dados

### Frontend
- `npm run dev`: servidor estático do frontend
- `npm run start`: servidor estático do frontend

