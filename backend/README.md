# InfoCliente Backend

## Requisitos
- Node.js (recomendado >= 18)
- Postgres

## Configuração
1. Copie `./.env.example` para `./.env` e ajuste `DATABASE_URL` e `JWT_SECRET`.
2. Instale dependências:
   - `npm install`
3. Gere e migre:
   - `npm run prisma:migrate`
4. Popular dados:
   - `npm run seed`
5. Rodar API:
   - `npm run dev`

## Endpoints principais
- `GET /health`
- `POST /auth/login`
- `GET /auth/me`
- `GET /dashboard/metrics`
- `GET /dashboard/clients`
- `GET /dashboard/alerts`
- `GET /clients` / `POST /clients` / `GET /clients/:id` / `PATCH /clients/:id`
- `GET /clients/:id/interactions` / `POST /clients/:id/interactions`
- `GET /projects` / `POST /projects` / `GET /projects/:id` / `PATCH /projects/:id`
- `GET /projects/:id/transactions` / `POST /projects/:id/transactions`

