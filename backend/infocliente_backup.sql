--
-- PostgreSQL database dump
--

\restrict AoOkhpsNeacKrTodOPhszMYfhqh0CnJv5n2iHGxQvvlgQ2zKM8fZcJ999XOoYEx

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: AlertSeverity; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."AlertSeverity" AS ENUM (
    'HIGH',
    'MEDIUM',
    'LOW'
);


ALTER TYPE public."AlertSeverity" OWNER TO postgres;

--
-- Name: AlertStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."AlertStatus" AS ENUM (
    'OPEN',
    'ACK'
);


ALTER TYPE public."AlertStatus" OWNER TO postgres;

--
-- Name: AuditStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."AuditStatus" AS ENUM (
    'PENDENTE',
    'VALIDACAO',
    'APROVADO',
    'REJEITADO'
);


ALTER TYPE public."AuditStatus" OWNER TO postgres;

--
-- Name: ClientStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ClientStatus" AS ENUM (
    'ACTIVE',
    'AT_RISK',
    'INACTIVE'
);


ALTER TYPE public."ClientStatus" OWNER TO postgres;

--
-- Name: MaterialCategory; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."MaterialCategory" AS ENUM (
    'MT',
    'BT',
    'IP',
    'OUTROS'
);


ALTER TYPE public."MaterialCategory" OWNER TO postgres;

--
-- Name: MaterialCondition; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."MaterialCondition" AS ENUM (
    'BOA',
    'DANIFICADA'
);


ALTER TYPE public."MaterialCondition" OWNER TO postgres;

--
-- Name: MovementStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."MovementStatus" AS ENUM (
    'EM_TRANSITO',
    'RECEBIDO',
    'APLICADO'
);


ALTER TYPE public."MovementStatus" OWNER TO postgres;

--
-- Name: MovementType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."MovementType" AS ENUM (
    'ENTRADA',
    'SAIDA',
    'TRANSFERENCIA',
    'AJUSTE'
);


ALTER TYPE public."MovementType" OWNER TO postgres;

--
-- Name: PaymentStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."PaymentStatus" AS ENUM (
    'CONFIRMADO',
    'PENDENTE'
);


ALTER TYPE public."PaymentStatus" OWNER TO postgres;

--
-- Name: ProjectStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ProjectStatus" AS ENUM (
    'ACTIVE',
    'ON_HOLD',
    'COMPLETED'
);


ALTER TYPE public."ProjectStatus" OWNER TO postgres;

--
-- Name: Role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."Role" AS ENUM (
    'admin',
    'operador',
    'leitura',
    'cliente'
);


ALTER TYPE public."Role" OWNER TO postgres;

--
-- Name: TransactionCategory; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."TransactionCategory" AS ENUM (
    'MATERIALS',
    'EQUIPMENT',
    'LABOR',
    'OTHER',
    'MATERIAIS_INSUMOS',
    'SERVICOS_MAO_DE_OBRA',
    'GASTOS_PESSOAL',
    'DESPESAS_OPERACIONAIS',
    'INVESTIMENTOS',
    'DEPRECIACAO',
    'OUTRAS_DESPESAS',
    'DEDUCOES',
    'IMPOSTOS'
);


ALTER TYPE public."TransactionCategory" OWNER TO postgres;

--
-- Name: TransactionStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."TransactionStatus" AS ENUM (
    'PAID',
    'PENDING',
    'LATE'
);


ALTER TYPE public."TransactionStatus" OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Alert; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Alert" (
    id text NOT NULL,
    severity public."AlertSeverity" DEFAULT 'MEDIUM'::public."AlertSeverity" NOT NULL,
    status public."AlertStatus" DEFAULT 'OPEN'::public."AlertStatus" NOT NULL,
    title text NOT NULL,
    body text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "clientId" text,
    "projectId" text
);


ALTER TABLE public."Alert" OWNER TO postgres;

--
-- Name: Client; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Client" (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    industry text,
    region text,
    tier text,
    status public."ClientStatus" DEFAULT 'ACTIVE'::public."ClientStatus" NOT NULL,
    "healthScore" integer DEFAULT 50 NOT NULL,
    "ltvTotal" numeric(14,2) NOT NULL,
    "churnRisk" numeric(5,2) NOT NULL,
    "ltvPotential" numeric(14,2) NOT NULL,
    "profilePic" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Client" OWNER TO postgres;

--
-- Name: ClientTag; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ClientTag" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    tag text NOT NULL
);


ALTER TABLE public."ClientTag" OWNER TO postgres;

--
-- Name: InteractionEvent; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."InteractionEvent" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    description text,
    "occurredAt" timestamp(3) without time zone NOT NULL,
    "leadName" text
);


ALTER TABLE public."InteractionEvent" OWNER TO postgres;

--
-- Name: Material; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Material" (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    category public."MaterialCategory" DEFAULT 'OUTROS'::public."MaterialCategory" NOT NULL,
    unit text DEFAULT 'un'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Material" OWNER TO postgres;

--
-- Name: Project; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Project" (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    location text,
    region text,
    status public."ProjectStatus" DEFAULT 'ACTIVE'::public."ProjectStatus" NOT NULL,
    "startDate" timestamp(3) without time zone,
    "dueDate" timestamp(3) without time zone,
    "budgetTotal" numeric(16,2) NOT NULL,
    "budgetAllocated" numeric(16,2) NOT NULL,
    "budgetConsumed" numeric(16,2) NOT NULL,
    "budgetCommitted" numeric(16,2) NOT NULL,
    "budgetAvailable" numeric(16,2) NOT NULL,
    "physicalProgressPct" double precision DEFAULT 0 NOT NULL,
    currency text DEFAULT 'AOA'::text,
    "phaseLabel" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "clientId" text,
    contact text,
    "projectType" text,
    empreiteiro text,
    subempreiteiro text,
    "directorObra" text,
    "directorPhoto" text,
    "directorPhone" text,
    "directorEmail" text,
    technicians jsonb DEFAULT '[]'::jsonb,
    referencia text,
    "lastAccidentDate" timestamp(3) without time zone,
    "activeStaffCount" integer DEFAULT 0,
    "safetyHistory" jsonb,
    "maoDeObraIndireta" jsonb,
    "maoDeObraDireta" jsonb,
    equipamentos jsonb
);


ALTER TABLE public."Project" OWNER TO postgres;

--
-- Name: ProjectBudgetLine; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ProjectBudgetLine" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "rowNumber" integer,
    "sourceFile" text,
    category text,
    description text NOT NULL,
    unit text,
    quantity numeric(16,4),
    "unitPrice" numeric(16,4),
    total numeric(16,2) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ProjectBudgetLine" OWNER TO postgres;

--
-- Name: ProjectFile; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ProjectFile" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "originalName" text NOT NULL,
    "mimeType" text NOT NULL,
    size integer NOT NULL,
    path text NOT NULL,
    category text DEFAULT 'OUTROS'::text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "folderId" text
);


ALTER TABLE public."ProjectFile" OWNER TO postgres;

--
-- Name: ProjectFolder; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ProjectFolder" (
    id text NOT NULL,
    name text NOT NULL,
    "projectId" text NOT NULL,
    "parentId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ProjectFolder" OWNER TO postgres;

--
-- Name: ProjectPayment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ProjectPayment" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    valor numeric(16,2) NOT NULL,
    "dataPagamento" timestamp(3) without time zone NOT NULL,
    metodo text,
    referencia text,
    "comprovativoPath" text,
    "criadoPor" text,
    status public."PaymentStatus" DEFAULT 'PENDENTE'::public."PaymentStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ProjectPayment" OWNER TO postgres;

--
-- Name: ProjectPhoto; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ProjectPhoto" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "movementId" text,
    "materialId" text,
    path text NOT NULL,
    lat numeric(10,8),
    lng numeric(11,8),
    "takenAt" timestamp(3) without time zone,
    description text,
    condition public."MaterialCondition",
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ProjectPhoto" OWNER TO postgres;

--
-- Name: ProjectProgressHistory; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ProjectProgressHistory" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "taskId" text NOT NULL,
    date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "executedQty" numeric(18,10) NOT NULL,
    "accumulatedQty" numeric(18,10) NOT NULL,
    "technicianName" text,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ProjectProgressHistory" OWNER TO postgres;

--
-- Name: ProjectProgressTask; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ProjectProgressTask" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "itemGroup" text,
    "parentId" text,
    "order" integer DEFAULT 0 NOT NULL,
    description text NOT NULL,
    "expectedQty" numeric(18,10) NOT NULL,
    "executedQty" numeric(18,10) DEFAULT 0 NOT NULL,
    unit text NOT NULL,
    "unitValue" numeric(18,8),
    "unitValueMaterial" numeric(18,8),
    "unitValueService" numeric(18,8),
    "totalValue" numeric(18,8),
    currency text DEFAULT 'AOA'::text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ProjectProgressTask" OWNER TO postgres;

--
-- Name: ProjectStock; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ProjectStock" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "materialId" text NOT NULL,
    "quantityPlanned" numeric(16,4) DEFAULT 0 NOT NULL,
    "quantityGood" numeric(16,4) DEFAULT 0 NOT NULL,
    "quantityDamaged" numeric(16,4) DEFAULT 0 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."ProjectStock" OWNER TO postgres;

--
-- Name: ProjectTransaction; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ProjectTransaction" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    date timestamp(3) without time zone NOT NULL,
    description text NOT NULL,
    category public."TransactionCategory" DEFAULT 'OTHER'::public."TransactionCategory" NOT NULL,
    "ownerName" text,
    status public."TransactionStatus" DEFAULT 'PENDING'::public."TransactionStatus" NOT NULL,
    amount numeric(16,2) NOT NULL,
    "realizedAmount" numeric(16,2),
    "budgetLineId" text
);


ALTER TABLE public."ProjectTransaction" OWNER TO postgres;

--
-- Name: StockAuditLog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."StockAuditLog" (
    id text NOT NULL,
    "movementId" text NOT NULL,
    "fromStatus" public."AuditStatus" NOT NULL,
    "toStatus" public."AuditStatus" NOT NULL,
    "changedBy" text NOT NULL,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."StockAuditLog" OWNER TO postgres;

--
-- Name: StockMovement; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."StockMovement" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "materialId" text NOT NULL,
    type public."MovementType" DEFAULT 'ENTRADA'::public."MovementType" NOT NULL,
    quantity numeric(16,4) NOT NULL,
    "quantityGood" numeric(16,4) DEFAULT 0 NOT NULL,
    "quantityDamaged" numeric(16,4) DEFAULT 0 NOT NULL,
    condition public."MaterialCondition" DEFAULT 'BOA'::public."MaterialCondition" NOT NULL,
    "entryType" text,
    "driverName" text,
    "vehiclePlate" text,
    "vehicleBrand" text,
    "dateEntry" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "movementStatus" public."MovementStatus" DEFAULT 'RECEBIDO'::public."MovementStatus" NOT NULL,
    "auditStatus" public."AuditStatus" DEFAULT 'PENDENTE'::public."AuditStatus" NOT NULL,
    "technicianName" text,
    batch text,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "vehicleImageUrl" text
);


ALTER TABLE public."StockMovement" OWNER TO postgres;

--
-- Name: User; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    name text,
    "passwordHash" text NOT NULL,
    role public."Role" DEFAULT 'leitura'::public."Role" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "clientId" text,
    "profilePic" text
);


ALTER TABLE public."User" OWNER TO postgres;

--
-- Name: UserClient; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."UserClient" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "clientId" text NOT NULL,
    role public."Role" DEFAULT 'leitura'::public."Role" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."UserClient" OWNER TO postgres;

--
-- Name: _AssignedUsers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."_AssignedUsers" (
    "A" text NOT NULL,
    "B" text NOT NULL
);


ALTER TABLE public."_AssignedUsers" OWNER TO postgres;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO postgres;

--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.role_permissions (
    id text NOT NULL,
    role text NOT NULL,
    module text NOT NULL,
    action text NOT NULL,
    allowed text NOT NULL
);


ALTER TABLE public.role_permissions OWNER TO postgres;

--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_permissions (
    id text NOT NULL,
    "userId" text NOT NULL,
    module text NOT NULL,
    action text NOT NULL,
    allowed text NOT NULL
);


ALTER TABLE public.user_permissions OWNER TO postgres;

--
-- Data for Name: Alert; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Alert" (id, severity, status, title, body, "createdAt", "clientId", "projectId") FROM stdin;
\.


--
-- Data for Name: Client; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Client" (id, code, name, industry, region, tier, status, "healthScore", "ltvTotal", "churnRisk", "ltvPotential", "profilePic", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: ClientTag; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ClientTag" (id, "clientId", tag) FROM stdin;
\.


--
-- Data for Name: InteractionEvent; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."InteractionEvent" (id, "clientId", type, title, description, "occurredAt", "leadName") FROM stdin;
\.


--
-- Data for Name: Material; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Material" (id, code, name, category, unit, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Project; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Project" (id, code, name, location, region, status, "startDate", "dueDate", "budgetTotal", "budgetAllocated", "budgetConsumed", "budgetCommitted", "budgetAvailable", "physicalProgressPct", currency, "phaseLabel", "createdAt", "updatedAt", "clientId", contact, "projectType", empreiteiro, subempreiteiro, "directorObra", "directorPhoto", "directorPhone", "directorEmail", technicians, referencia, "lastAccidentDate", "activeStaffCount", "safetyHistory", "maoDeObraIndireta", "maoDeObraDireta", equipamentos) FROM stdin;
\.


--
-- Data for Name: ProjectBudgetLine; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ProjectBudgetLine" (id, "projectId", "rowNumber", "sourceFile", category, description, unit, quantity, "unitPrice", total, "createdAt") FROM stdin;
\.


--
-- Data for Name: ProjectFile; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ProjectFile" (id, "projectId", "originalName", "mimeType", size, path, category, "createdAt", "folderId") FROM stdin;
\.


--
-- Data for Name: ProjectFolder; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ProjectFolder" (id, name, "projectId", "parentId", "createdAt") FROM stdin;
\.


--
-- Data for Name: ProjectPayment; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ProjectPayment" (id, "projectId", valor, "dataPagamento", metodo, referencia, "comprovativoPath", "criadoPor", status, "createdAt") FROM stdin;
\.


--
-- Data for Name: ProjectPhoto; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ProjectPhoto" (id, "projectId", "movementId", "materialId", path, lat, lng, "takenAt", description, condition, "createdAt") FROM stdin;
\.


--
-- Data for Name: ProjectProgressHistory; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ProjectProgressHistory" (id, "projectId", "taskId", date, "executedQty", "accumulatedQty", "technicianName", notes, "createdAt") FROM stdin;
\.


--
-- Data for Name: ProjectProgressTask; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ProjectProgressTask" (id, "projectId", "itemGroup", "parentId", "order", description, "expectedQty", "executedQty", unit, "unitValue", "unitValueMaterial", "unitValueService", "totalValue", currency, "createdAt") FROM stdin;
\.


--
-- Data for Name: ProjectStock; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ProjectStock" (id, "projectId", "materialId", "quantityPlanned", "quantityGood", "quantityDamaged", "updatedAt") FROM stdin;
\.


--
-- Data for Name: ProjectTransaction; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ProjectTransaction" (id, "projectId", date, description, category, "ownerName", status, amount, "realizedAmount", "budgetLineId") FROM stdin;
\.


--
-- Data for Name: StockAuditLog; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."StockAuditLog" (id, "movementId", "fromStatus", "toStatus", "changedBy", notes, "createdAt") FROM stdin;
\.


--
-- Data for Name: StockMovement; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."StockMovement" (id, "projectId", "materialId", type, quantity, "quantityGood", "quantityDamaged", condition, "entryType", "driverName", "vehiclePlate", "vehicleBrand", "dateEntry", "movementStatus", "auditStatus", "technicianName", batch, notes, "createdAt", "updatedAt", "vehicleImageUrl") FROM stdin;
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."User" (id, email, name, "passwordHash", role, "createdAt", "clientId", "profilePic") FROM stdin;
\.


--
-- Data for Name: UserClient; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."UserClient" (id, "userId", "clientId", role, "createdAt") FROM stdin;
\.


--
-- Data for Name: _AssignedUsers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."_AssignedUsers" ("A", "B") FROM stdin;
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
d760865e-5528-4ea5-8e7c-9c788d693b07	1a690a84141e9aa4a53a8820080ac9f7ff2613b722a8a2dd003db8dd12c0760c	2026-10-05 10:26:47.346848+01	20260427133620_init	\N	\N	2026-10-05 10:26:47.233327+01	1
d5595d77-64f7-41e9-b660-77aaf2e4b48c	0454f1a3a013592e59d774e05a094eac07f7717b89e0a83810ce644a28b4ff5e	2026-10-05 10:26:47.349079+01	20260428090802_add_user_profile_pic	\N	\N	2026-10-05 10:26:47.347435+01	1
82ce2bb7-96cb-4dcc-b4d3-6a33750480ae	2ea8d3a84a5e45480b37c74ca5dc074adedba016c5940d178325c7b1bfbecba3	2026-10-05 10:26:47.355978+01	20260512154238_add_role_permissions	\N	\N	2026-10-05 10:26:47.349465+01	1
5bac3933-2956-444a-84cf-c3d21960766f	3516d8ce9a470ad094c74fa6bcf1cb1e325368c66a36d6962951d75e9f0c9199	2026-10-05 10:26:47.366957+01	20260512185423_add_project_assignments	\N	\N	2026-10-05 10:26:47.356599+01	1
fe13501c-c2ea-4763-b98e-cae95be35809	b4df347421ad35a2903783e408d92fb6cb0c130e04dd32bded3a8dab7a95af5d	2026-10-05 10:26:47.375515+01	20260522120000_add_user_permissions	\N	\N	2026-10-05 10:26:47.367438+01	1
5bd84de1-286a-4c62-a370-e2dfc78e94b1	044b35c1b83e1b8ac89855b5bb6b7d8920c06250fd7bbd25ba3d98239f7558aa	2026-10-05 10:26:47.377967+01	20260522120000_add_vehicle_image_url	\N	\N	2026-10-05 10:26:47.375983+01	1
9a5e4de8-5685-499d-99ba-5aba341ca296	2c95aec6369b611732dbd2f5557e35815a1de817600c0634ba601061f59e0fa9	\N	20260527120000_multi_warehouse_per_project	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20260527120000_multi_warehouse_per_project\n\nDatabase error code: 42P01\n\nDatabase error:\nERROR: relation "Warehouse" does not exist\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42P01), message: "relation \\"Warehouse\\" does not exist", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("namespace.c"), line: Some(639), routine: Some("RangeVarGetRelidExtended") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20260527120000_multi_warehouse_per_project"\n             at schema-engine\\connectors\\sql-schema-connector\\src\\apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20260527120000_multi_warehouse_per_project"\n             at schema-engine\\commands\\src\\commands\\apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine\\core\\src\\state.rs:260	\N	2026-10-05 10:26:47.378579+01	0
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.role_permissions (id, role, module, action, allowed) FROM stdin;
\.


--
-- Data for Name: user_permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_permissions (id, "userId", module, action, allowed) FROM stdin;
\.


--
-- Name: Alert Alert_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Alert"
    ADD CONSTRAINT "Alert_pkey" PRIMARY KEY (id);


--
-- Name: ClientTag ClientTag_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ClientTag"
    ADD CONSTRAINT "ClientTag_pkey" PRIMARY KEY (id);


--
-- Name: Client Client_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Client"
    ADD CONSTRAINT "Client_pkey" PRIMARY KEY (id);


--
-- Name: InteractionEvent InteractionEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InteractionEvent"
    ADD CONSTRAINT "InteractionEvent_pkey" PRIMARY KEY (id);


--
-- Name: Material Material_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Material"
    ADD CONSTRAINT "Material_pkey" PRIMARY KEY (id);


--
-- Name: ProjectBudgetLine ProjectBudgetLine_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectBudgetLine"
    ADD CONSTRAINT "ProjectBudgetLine_pkey" PRIMARY KEY (id);


--
-- Name: ProjectFile ProjectFile_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectFile"
    ADD CONSTRAINT "ProjectFile_pkey" PRIMARY KEY (id);


--
-- Name: ProjectFolder ProjectFolder_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectFolder"
    ADD CONSTRAINT "ProjectFolder_pkey" PRIMARY KEY (id);


--
-- Name: ProjectPayment ProjectPayment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectPayment"
    ADD CONSTRAINT "ProjectPayment_pkey" PRIMARY KEY (id);


--
-- Name: ProjectPhoto ProjectPhoto_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectPhoto"
    ADD CONSTRAINT "ProjectPhoto_pkey" PRIMARY KEY (id);


--
-- Name: ProjectProgressHistory ProjectProgressHistory_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectProgressHistory"
    ADD CONSTRAINT "ProjectProgressHistory_pkey" PRIMARY KEY (id);


--
-- Name: ProjectProgressTask ProjectProgressTask_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectProgressTask"
    ADD CONSTRAINT "ProjectProgressTask_pkey" PRIMARY KEY (id);


--
-- Name: ProjectStock ProjectStock_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectStock"
    ADD CONSTRAINT "ProjectStock_pkey" PRIMARY KEY (id);


--
-- Name: ProjectTransaction ProjectTransaction_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectTransaction"
    ADD CONSTRAINT "ProjectTransaction_pkey" PRIMARY KEY (id);


--
-- Name: Project Project_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Project"
    ADD CONSTRAINT "Project_pkey" PRIMARY KEY (id);


--
-- Name: StockAuditLog StockAuditLog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."StockAuditLog"
    ADD CONSTRAINT "StockAuditLog_pkey" PRIMARY KEY (id);


--
-- Name: StockMovement StockMovement_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."StockMovement"
    ADD CONSTRAINT "StockMovement_pkey" PRIMARY KEY (id);


--
-- Name: UserClient UserClient_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."UserClient"
    ADD CONSTRAINT "UserClient_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: _AssignedUsers _AssignedUsers_AB_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."_AssignedUsers"
    ADD CONSTRAINT "_AssignedUsers_AB_pkey" PRIMARY KEY ("A", "B");


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: user_permissions user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (id);


--
-- Name: Alert_status_severity_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Alert_status_severity_createdAt_idx" ON public."Alert" USING btree (status, severity, "createdAt");


--
-- Name: ClientTag_clientId_tag_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "ClientTag_clientId_tag_key" ON public."ClientTag" USING btree ("clientId", tag);


--
-- Name: Client_code_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Client_code_key" ON public."Client" USING btree (code);


--
-- Name: Client_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Client_name_idx" ON public."Client" USING btree (name);


--
-- Name: Client_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Client_status_idx" ON public."Client" USING btree (status);


--
-- Name: InteractionEvent_clientId_occurredAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "InteractionEvent_clientId_occurredAt_idx" ON public."InteractionEvent" USING btree ("clientId", "occurredAt");


--
-- Name: Material_code_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Material_code_key" ON public."Material" USING btree (code);


--
-- Name: ProjectBudgetLine_projectId_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProjectBudgetLine_projectId_createdAt_idx" ON public."ProjectBudgetLine" USING btree ("projectId", "createdAt");


--
-- Name: ProjectFile_projectId_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProjectFile_projectId_createdAt_idx" ON public."ProjectFile" USING btree ("projectId", "createdAt");


--
-- Name: ProjectFolder_projectId_parentId_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProjectFolder_projectId_parentId_createdAt_idx" ON public."ProjectFolder" USING btree ("projectId", "parentId", "createdAt");


--
-- Name: ProjectPayment_projectId_dataPagamento_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProjectPayment_projectId_dataPagamento_idx" ON public."ProjectPayment" USING btree ("projectId", "dataPagamento");


--
-- Name: ProjectProgressHistory_projectId_taskId_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProjectProgressHistory_projectId_taskId_date_idx" ON public."ProjectProgressHistory" USING btree ("projectId", "taskId", date);


--
-- Name: ProjectProgressTask_projectId_itemGroup_order_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProjectProgressTask_projectId_itemGroup_order_idx" ON public."ProjectProgressTask" USING btree ("projectId", "itemGroup", "order");


--
-- Name: ProjectStock_projectId_materialId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "ProjectStock_projectId_materialId_key" ON public."ProjectStock" USING btree ("projectId", "materialId");


--
-- Name: ProjectTransaction_projectId_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProjectTransaction_projectId_date_idx" ON public."ProjectTransaction" USING btree ("projectId", date);


--
-- Name: Project_code_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Project_code_key" ON public."Project" USING btree (code);


--
-- Name: Project_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Project_name_idx" ON public."Project" USING btree (name);


--
-- Name: Project_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Project_status_idx" ON public."Project" USING btree (status);


--
-- Name: StockMovement_projectId_dateEntry_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "StockMovement_projectId_dateEntry_idx" ON public."StockMovement" USING btree ("projectId", "dateEntry");


--
-- Name: UserClient_clientId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "UserClient_clientId_idx" ON public."UserClient" USING btree ("clientId");


--
-- Name: UserClient_userId_clientId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "UserClient_userId_clientId_key" ON public."UserClient" USING btree ("userId", "clientId");


--
-- Name: UserClient_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "UserClient_userId_idx" ON public."UserClient" USING btree ("userId");


--
-- Name: User_clientId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "User_clientId_idx" ON public."User" USING btree ("clientId");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: _AssignedUsers_B_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "_AssignedUsers_B_index" ON public."_AssignedUsers" USING btree ("B");


--
-- Name: role_permissions_role_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX role_permissions_role_idx ON public.role_permissions USING btree (role);


--
-- Name: role_permissions_role_module_action_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX role_permissions_role_module_action_key ON public.role_permissions USING btree (role, module, action);


--
-- Name: user_permissions_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "user_permissions_userId_idx" ON public.user_permissions USING btree ("userId");


--
-- Name: user_permissions_userId_module_action_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "user_permissions_userId_module_action_key" ON public.user_permissions USING btree ("userId", module, action);


--
-- Name: Alert Alert_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Alert"
    ADD CONSTRAINT "Alert_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Alert Alert_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Alert"
    ADD CONSTRAINT "Alert_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ClientTag ClientTag_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ClientTag"
    ADD CONSTRAINT "ClientTag_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: InteractionEvent InteractionEvent_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InteractionEvent"
    ADD CONSTRAINT "InteractionEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectBudgetLine ProjectBudgetLine_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectBudgetLine"
    ADD CONSTRAINT "ProjectBudgetLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectFile ProjectFile_folderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectFile"
    ADD CONSTRAINT "ProjectFile_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES public."ProjectFolder"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectFile ProjectFile_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectFile"
    ADD CONSTRAINT "ProjectFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectFolder ProjectFolder_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectFolder"
    ADD CONSTRAINT "ProjectFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public."ProjectFolder"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectFolder ProjectFolder_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectFolder"
    ADD CONSTRAINT "ProjectFolder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectPayment ProjectPayment_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectPayment"
    ADD CONSTRAINT "ProjectPayment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectPhoto ProjectPhoto_movementId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectPhoto"
    ADD CONSTRAINT "ProjectPhoto_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES public."StockMovement"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ProjectPhoto ProjectPhoto_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectPhoto"
    ADD CONSTRAINT "ProjectPhoto_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectProgressHistory ProjectProgressHistory_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectProgressHistory"
    ADD CONSTRAINT "ProjectProgressHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectProgressHistory ProjectProgressHistory_taskId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectProgressHistory"
    ADD CONSTRAINT "ProjectProgressHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES public."ProjectProgressTask"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectProgressTask ProjectProgressTask_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectProgressTask"
    ADD CONSTRAINT "ProjectProgressTask_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public."ProjectProgressTask"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectProgressTask ProjectProgressTask_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectProgressTask"
    ADD CONSTRAINT "ProjectProgressTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectStock ProjectStock_materialId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectStock"
    ADD CONSTRAINT "ProjectStock_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES public."Material"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectStock ProjectStock_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectStock"
    ADD CONSTRAINT "ProjectStock_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectTransaction ProjectTransaction_budgetLineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectTransaction"
    ADD CONSTRAINT "ProjectTransaction_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES public."ProjectBudgetLine"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ProjectTransaction ProjectTransaction_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectTransaction"
    ADD CONSTRAINT "ProjectTransaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Project Project_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Project"
    ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: StockAuditLog StockAuditLog_movementId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."StockAuditLog"
    ADD CONSTRAINT "StockAuditLog_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES public."StockMovement"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StockMovement StockMovement_materialId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."StockMovement"
    ADD CONSTRAINT "StockMovement_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES public."Material"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StockMovement StockMovement_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."StockMovement"
    ADD CONSTRAINT "StockMovement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: UserClient UserClient_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."UserClient"
    ADD CONSTRAINT "UserClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: UserClient UserClient_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."UserClient"
    ADD CONSTRAINT "UserClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: User User_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: _AssignedUsers _AssignedUsers_A_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."_AssignedUsers"
    ADD CONSTRAINT "_AssignedUsers_A_fkey" FOREIGN KEY ("A") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: _AssignedUsers _AssignedUsers_B_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."_AssignedUsers"
    ADD CONSTRAINT "_AssignedUsers_B_fkey" FOREIGN KEY ("B") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_permissions user_permissions_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT "user_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict AoOkhpsNeacKrTodOPhszMYfhqh0CnJv5n2iHGxQvvlgQ2zKM8fZcJ999XOoYEx

