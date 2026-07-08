# Plano de Evolução de Permissões InforCliente

> **Workspace:** c:\Users\Evilonga\InforCliente

---

**User**

plan, 
 Prompt: Plano de Evolução e Escalabilidade do Módulo Existente de Gestão de Permissões — InforCliente 
 Contexto 
 O sistema InforCliente  já possui um módulo funcional de autenticação e gestão de permissões. 
 O objetivo não é criar um novo sistema de permissões do zero, mas sim analisar, refatorar, melhorar a experiência administrativa e preparar a arquitetura atual para escalar de forma segura . 
 A evolução deve preservar as funcionalidades existentes, evitando regressões e indisponibilidade do sistema. 
 Stack atual: 
 Frontend: HTML, TAILWIND E CSS 
 Backend: Node.js + Express 
 Base de dados: PostgreSQL 
 ORM: Prisma 
 Autenticação: JWT 
 Objetivo 
 Elaborar um plano técnico detalhado para evoluir o módulo atual de permissões, tornando-o: 
 Mais intuitivo para administradores. 
 Mais flexível para novos perfis. 
 Mais seguro. 
 Mais fácil de manter. 
 Preparado para crescimento do número de utilizadores, módulos e permissões. 
 Etapa 1 — Auditoria do Sistema Atual 
 Antes de propor alterações, analisar: 
 Backend 
 Identificar: 
 Como os perfis são armazenados. 
 Como as permissões são estruturadas. 
 Como o middleware atual funciona. 
 Como as rotas validam autorização. 
 Como o JWT transporta informações do utilizador. 
 Onde existem regras fixas no código. 
 Frontend 
 Avaliar: 
 Como menus são carregados atualmente. 
 Como as rotas são protegidas. 
 Como componentes verificam permissões. 
 Como o painel administrativo gere permissões. 
 Base de Dados 
 Analisar: 
 Modelo atual Prisma. 
 Relacionamentos existentes. 
 Possíveis limitações. 
 Necessidade ou não de novas tabelas. 
 Objetivo da Refatoração 
 Evoluir de uma gestão de permissões funcional para uma solução mais próxima de um sistema empresarial. 
 Melhorias Desejadas 
 1. Nova Experiência Administrativa 
 Atualizar a interface de gestão de permissões. 
 Evitar uma visualização complexa com muitas permissões espalhadas. 
 Criar uma interface baseada em: 
 Módulos. 
 Categorias. 
 Filtros. 
 Pesquisa. 
 Selects de nível de acesso. 
 Cards visuais. 
 Exemplo: 
 Perfil: 
 Supervisor 
 Módulo: 
 Obras 
 Nível: 
 [Gestor ▼] 
 Permissões aplicadas: 
 ✓ Visualizar 
 ✓ Criar 
 ✓ Editar 
 ✓ Aprovar 
 ✗ Eliminar 
 2. Gestão por Módulos 
 Organizar permissões por áreas do sistema: 
 Exemplo: 
 Obras 
 Visualizar 
 Criar 
 Editar 
 Aprovar 
 Eliminar 
 Clientes 
 Visualizar 
 Criar 
 Editar 
 Chat 
 Visualizar 
 Enviar 
 Administrar 
 Relatórios 
 Consultar 
 Exportar 
 3. Navegação Dinâmica 
 Melhorar o comportamento após login. 
 O sistema deve: 
 Identificar o perfil do utilizador. 
 Carregar menus permitidos. 
 Exibir apenas funcionalidades autorizadas. 
 Bloquear acessos diretos por URL. 
 Exemplo: 
 Utilizador Técnico: 
 Mostrar: 
 Minhas obras 
 Checklists 
 Fotografias 
 Chat 
 Ocultar: 
 Gestão de utilizadores 
 Configurações 
 Financeiro 
 4. Permissões Granulares 
 Avaliar se o modelo atual suporta: 
 Permissões por módulo. 
 Permissões por ação. 
 Permissões específicas por utilizador. 
 Exemplo: 
 Perfil: 
 Técnico 
 Regra geral: 
 Pode editar obras. 
 Exceção: 
 Não pode editar obras concluídas. 
 Caso seja necessário, propor evolução futura. 
 5. Segurança 
 Garantir: 
 Backend continua sendo a fonte principal de autorização. 
 Frontend apenas controla experiência. 
 JWT não contém excesso de informação sensível. 
 Middleware centralizado. 
 Logs das alterações administrativas. 
 6. Migração Segura 
 Criar estratégia para: 
 Aproveitar dados existentes. 
 Não apagar permissões atuais. 
 Criar compatibilidade temporária. 
 Fazer migração gradual. 
 Definir: 
 Ordem das alterações. 
 Possíveis riscos. 
 Plano de rollback. 
 7. Melhorias Técnicas 
 Avaliar: 
 Cache de permissões. 
 Redução de consultas repetidas. 
 Organização do código. 
 Padronização dos nomes das permissões. 
 Melhor separação entre autenticação e autorização. 
 8. Auditoria 
 Adicionar histórico: 
 Exemplo: 
 "Administrador alterou o perfil Técnico" 
 Antes: 
 obra.delete = false 
 Depois: 
 obra.delete = true 
 Guardar: 
 Quem alterou. 
 Quando alterou. 
 O que mudou. 
 9. Roadmap de Implementação 
 Criar um plano dividido: 
 Fase 1 
 Análise do código atual. 
 Fase 2 
 Melhorias no modelo de dados caso necessário. 
 Fase 3 
 Refatoração backend. 
 Fase 4 
 Nova interface administrativa. 
 Fase 5 
 Integração frontend. 
 Fase 6 
 Testes e validação. 
 Fase 7 
 Deploy gradual. 
 Cada fase deve apresentar: 
 Objetivo. 
 Alterações. 
 Dependências. 
 Riscos. 
 Critério de conclusão. 
 Resultado esperado 
 Entregar um plano de evolução técnica contendo: 
 Diagnóstico do sistema atual. 
 Pontos de melhoria. 
 Arquitetura recomendada. 
 Estratégia de refatoração. 
 Plano de migração. 
 Melhorias de UX. 
 Estratégia de segurança. 
 Roadmap de implementação. 
 A solução proposta deve respeitar o sistema existente e evoluir gradualmente para uma arquitetura empresarial, evitando reconstrução desnecessária.

**Assistant**

Vou auditar o módulo atual de autenticação/permissões no backend, frontend e Prisma para montar um plano de evolução sem assumir mudanças que o código não suporta hoje.

Encontrei um módulo de permissões já evoluído com `permissionsCatalog`, `permissionResolver`, rotas dedicadas e migrações recentes; agora vou aprofundar backend, frontend e Prisma em paralelo para basear o plano no estado real do projeto.

Fiz uma leitura abrangente do schema Prisma, das migrações relevantes e da camada de resolução de permissões, por isso a análise abaixo cobre o estado actual do modelo, os relacionamentos efectivos, a granularidade suportada e as limitações reais de implementação.

**Modelo Actual**
- O utilizador continua a ter um papel base no campo `User.role`, tipado pelo enum `Role` com `admin`, `operador`, `tecnico`, `supervisor`, `leitura` e `cliente` em [schema.prisma:L10-L35](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L10-L35) e [schema.prisma:L641-L648](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L641-L648).
- Existe associação utilizador-cliente em dois níveis: um vínculo principal opcional em `User.clientId` e uma tabela de junção `UserClient` com `userId`, `clientId` e `role`, em [schema.prisma:L10-L35](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L10-L35) e [schema.prisma:L167-L179](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L167-L179).
- Existe associação utilizador-projecto por many-to-many através de `assignedProjects`/`assignedUsers`, materializada pela tabela `_AssignedUsers`, em [schema.prisma:L21-L24](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L21-L24), [schema.prisma:L265-L267](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L265-L267) e [migration.sql:L1-L16](file:///c:/Users/Evilonga/InforCliente/backend/prisma/migrations/20260512185423_add_project_assignments/migration.sql#L1-L16).
- As permissões de perfil ficam em `RolePermission(role,module,action,allowed)` e os overrides por utilizador em `UserPermission(userId,module,action,allowed)`, ambos com unicidade por tripla lógica, em [schema.prisma:L571-L595](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L571-L595).

**Migrações Ligadas**
- A migração inicial cria `User`, enum `Role`, `UserClient`, `Client` e a base do modelo de identidade/acesso, em [migration.sql:L16-L18](file:///c:/Users/Evilonga/InforCliente/backend/prisma/migrations/20260427133620_init/migration.sql#L16-L18), [migration.sql:L40-L62](file:///c:/Users/Evilonga/InforCliente/backend/prisma/migrations/20260427133620_init/migration.sql#L40-L62) e [migration.sql:L426-L433](file:///c:/Users/Evilonga/InforCliente/backend/prisma/migrations/20260427133620_init/migration.sql#L426-L433).
- A migração `add_role_permissions` introduz a matriz por perfil, sem FK para enum/tabela de roles, em [migration.sql:L1-L16](file:///c:/Users/Evilonga/InforCliente/backend/prisma/migrations/20260512154238_add_role_permissions/migration.sql#L1-L16).
- A migração `add_user_permissions` introduz overrides por utilizador com FK para `User`, em [migration.sql:L1-L19](file:///c:/Users/Evilonga/InforCliente/backend/prisma/migrations/20260522120000_add_user_permissions/migration.sql#L1-L19).
- A migração `add_project_assignments` acrescenta o vínculo many-to-many utilizador-projecto, crucial para o scope `own`, em [migration.sql:L1-L16](file:///c:/Users/Evilonga/InforCliente/backend/prisma/migrations/20260512185423_add_project_assignments/migration.sql#L1-L16).

**Relacionamentos**
- `User -> Client` é 0..1 via `clientId`, servindo como cliente principal/contexto activo em [schema.prisma:L17-L21](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L17-L21).
- `User <-> Client` também existe via `UserClient`, permitindo múltiplas contas/contextos por cliente e até papel por vínculo, em [schema.prisma:L167-L179](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L167-L179).
- `User <-> Project` existe via `_AssignedUsers`, usado para atribuição directa de obras, em [schema.prisma:L21-L24](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L21-L24) e [migration.sql:L1-L16](file:///c:/Users/Evilonga/InforCliente/backend/prisma/migrations/20260512185423_add_project_assignments/migration.sql#L1-L16).
- `User -> UserPermission` é 1:N e `RolePermission` é uma matriz flat por `role/module/action`, em [schema.prisma:L24-L25](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L24-L25) e [schema.prisma:L571-L595](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L571-L595).

**Granularidade Compatível**
- O sistema suporta granularidade por perfil e por utilizador, com merge de permissões de role e overrides individuais em [permissionResolver.js:L51-L83](file:///c:/Users/Evilonga/InforCliente/backend/src/services/permissionResolver.js#L51-L83).
- Suporta granularidade por módulo e por acção (`module + action`), incluindo acções funcionais, tabs e sub-tabs, em [permissionsCatalog.js:L111-L251](file:///c:/Users/Evilonga/InforCliente/backend/src/config/permissionsCatalog.js#L111-L251).
- O campo `allowed` aceita 4 níveis semânticos: `true`, `own`, `view`, `false`, em [permissionsCatalog.js:L1-L4](file:///c:/Users/Evilonga/InforCliente/backend/src/config/permissionsCatalog.js#L1-L4) e [permissionsCatalog.js:L20-L20](file:///c:/Users/Evilonga/InforCliente/backend/src/config/permissionsCatalog.js#L20-L20).
- Há fallback entre permissões de tab e permissões do módulo base, o que aumenta a granularidade de UI sem duplicar toda a lógica, em [permissionResolver.js:L85-L110](file:///c:/Users/Evilonga/InforCliente/backend/src/services/permissionResolver.js#L85-L110) e [permissionsCatalog.js:L93-L100](file:///c:/Users/Evilonga/InforCliente/backend/src/config/permissionsCatalog.js#L93-L100).
- O middleware reconhece `own` e `view`, mas só `true` autoriza genericamente qualquer método; `view` só passa em GET, em [auth.js:L35-L64](file:///c:/Users/Evilonga/InforCliente/backend/src/middlewares/auth.js#L35-L64).

**Limitações**
- `RolePermission.role` é `String`, não enum nem FK; isso permite inconsistências entre roles reais e roles registadas em permissões, em [schema.prisma:L571-L581](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L571-L581).
- `module`, `action` e `allowed` também são `String` nas tabelas de permissões; não há enum nem catálogo imposto na BD, logo a integridade depende só da aplicação, em [schema.prisma:L571-L595](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L571-L595).
- O scope `own` existe semanticamente, mas a aplicação efectiva é parcial: encontrei uso explícito apenas na listagem de projectos, onde restringe a `assignedUsers`, em [projects.js:L96-L205](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/projects.js#L96-L205).
- O scope `view` é mais um nível de autorização HTTP do que um filtro de dados; o middleware deixa passar GET, mas a maioria das rotas não diferencia `view` de `true` em profundidade, em [auth.js:L42-L58](file:///c:/Users/Evilonga/InforCliente/backend/src/middlewares/auth.js#L42-L58).
- Não existe um modelo relacional de permissões por recurso concreto, por projecto, por cliente ou por entidade específica; a granularidade é `role/user + module/action`, com excepções implementadas manualmente via `clientId` e `assignedUsers`, em [auth.js:L28-L36](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L28-L36), [auth.js:L115-L150](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L115-L150) e [projects.js:L49-L77](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/projects.js#L49-L77).
- O modelo mistura contexto de acesso com dado do utilizador: `User.clientId` é usado tanto como vínculo principal como contexto activo seleccionado no login, o que reduz clareza semântica, em [schema.prisma:L17-L21](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L17-L21) e [auth.js:L147-L161](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L147-L161).

**Conclusão**
- O modelo actual já suporta RBAC com overrides por utilizador e alguma granularidade de UI/rota.
- Para granularidade fina real, está razoavelmente preparado ao nível lógico, mas ainda não ao nível relacional.
- O principal bloqueio não é o Prisma em si; é a ausência de entidades formais para scope de permissão e a aplicação desigual de `own/view` nas rotas.

Se quiseres, no passo seguinte posso devolver uma matriz “o que existe vs o que falta” para evoluir isto para permissões por projecto/cliente/recurso sem quebrar o modelo actual.

Fiz uma passagem abrangente ao backend e o mapa actual de autenticação/autorização está consistente com o código em disco.

**Ficheiros-chave**
- Bootstrap e montagem de rotas: [server.js:L1-L140](file:///c:/Users/Evilonga/InforCliente/backend/src/server.js#L1-L140)
- Configuração do segredo JWT: [config.js:L1-L19](file:///c:/Users/Evilonga/InforCliente/backend/src/config.js#L1-L19)
- Middleware de autenticação e autorização: [auth.js:L1-L66](file:///c:/Users/Evilonga/InforCliente/backend/src/middlewares/auth.js#L1-L66)
- Login, selecção de conta e emissão de token: [auth.js:L12-L279](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L12-L279)
- Resolver de permissões efectivas: [permissionResolver.js:L1-L164](file:///c:/Users/Evilonga/InforCliente/backend/src/services/permissionResolver.js#L1-L164)
- Catálogo/matriz base de permissões e regras por role: [permissionsCatalog.js:L1-L479](file:///c:/Users/Evilonga/InforCliente/backend/src/config/permissionsCatalog.js#L1-L479)
- API de gestão de permissões: [permissions.js:L1-L277](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/permissions.js#L1-L277)
- Escopo adicional para cliente em armazéns/projectos: [warehouseAccess.js:L1-L105](file:///c:/Users/Evilonga/InforCliente/backend/src/utils/warehouseAccess.js#L1-L105)
- Autenticação Socket.IO: [socket/auth.js:L1-L36](file:///c:/Users/Evilonga/InforCliente/backend/src/socket/auth.js#L1-L36)
- Persistência de roles e overrides: [schema.prisma:L571-L595](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L571-L595)

**JWT**
- O token é emitido em [auth.js:L88-L97](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L88-L97) e [auth.js:L153-L162](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L153-L162).
- Payload actual: `sub`, `email`, `name`, `role`, `clientId`; validade fixa de `7d`.
- Validação HTTP em [auth.js:L5-L20](file:///c:/Users/Evilonga/InforCliente/backend/src/middlewares/auth.js#L5-L20) e validação WebSocket em [socket/auth.js:L4-L33](file:///c:/Users/Evilonga/InforCliente/backend/src/socket/auth.js#L4-L33).
- O segredo é obrigatório por variável de ambiente `JWT_SECRET` em [config.js:L5-L17](file:///c:/Users/Evilonga/InforCliente/backend/src/config.js#L5-L17).

**Middleware**
- `authRequired` valida `Authorization: Bearer <token>` e mete o payload em `req.user`: [auth.js:L5-L20](file:///c:/Users/Evilonga/InforCliente/backend/src/middlewares/auth.js#L5-L20)
- `requireRole` faz controlo estático por role do token: [auth.js:L22-L33](file:///c:/Users/Evilonga/InforCliente/backend/src/middlewares/auth.js#L22-L33)
- `requirePermission` chama o resolver e aceita `true`, `own` ou `view` em GET; para `own/view` apenas define `req.permissionScope`: [auth.js:L35-L63](file:///c:/Users/Evilonga/InforCliente/backend/src/middlewares/auth.js#L35-L63)

**Resolver**
- A base são `role_permissions`; overrides por utilizador vivem em `user_permissions`: [schema.prisma:L571-L595](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L571-L595)
- O resolver combina permissões do role com overrides do utilizador em [permissionResolver.js:L41-L83](file:///c:/Users/Evilonga/InforCliente/backend/src/services/permissionResolver.js#L41-L83)
- Há aliases/fallbacks para tabs e para `read/view`: [permissionResolver.js:L85-L110](file:///c:/Users/Evilonga/InforCliente/backend/src/services/permissionResolver.js#L85-L110)
- `admin` faz bypass total no resolver: [permissionResolver.js:L112-L120](file:///c:/Users/Evilonga/InforCliente/backend/src/services/permissionResolver.js#L112-L120)
- O catálogo define defaults por role, guards de páginas e heranças/fallbacks: [permissionsCatalog.js:L253-L395](file:///c:/Users/Evilonga/InforCliente/backend/src/config/permissionsCatalog.js#L253-L395)

**Rotas protegidas**
- Quase todos os routers montados em [server.js:L90-L106](file:///c:/Users/Evilonga/InforCliente/backend/src/server.js#L90-L106) usam `authRequired` no router ou por rota.
- Pública: `/health` em [server.js:L86-L86](file:///c:/Users/Evilonga/InforCliente/backend/src/server.js#L86-L86)
- Públicas em `/auth`: `/login`, `/select-account`, `/available-projects`; só `/auth/me` exige token: [auth.js:L12-L279](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L12-L279)
- Por permissões: `projects`, `clients`, `dashboard`, `stock`, `products`, `warehouses`, `items`, `daily-plans`, `conversations`, `users` usam `requirePermission(...)` em várias operações, por exemplo [projects.js:L96-L189](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/projects.js#L96-L189), [clients.js:L40-L118](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/clients.js#L40-L118), [dashboard.js:L36-L120](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/dashboard.js#L36-L120), [stock.js:L892-L1019](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/stock.js#L892-L1019)
- Por role fixa: `suppliers`, `quotes` e várias operações de `projects`, `costCenters`, `logs`, `permissions` usam `requireRole(...)`; isto cria uma segunda camada paralela à matriz dinâmica, por exemplo [permissions.js:L66-L67](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/permissions.js#L66-L67)

**Regras fixas**
- `admin` tem acesso total por default, excepto `portal:view=false`: [permissionsCatalog.js:L270-L275](file:///c:/Users/Evilonga/InforCliente/backend/src/config/permissionsCatalog.js#L270-L275)
- A API de permissões impede revogar a admins acesso a `sistema` e `permissoes.manage_permissions`: [permissions.js:L226-L231](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/permissions.js#L226-L231)
- Há reparação automática de denies errados para perfis internos em [permissionResolver.js:L123-L152](file:///c:/Users/Evilonga/InforCliente/backend/src/services/permissionResolver.js#L123-L152)
- O escopo de cliente é aplicado manualmente em várias rotas com `clientId` e `assignedUsers`, por exemplo [projects.js:L49-L77](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/projects.js#L49-L77), [clients.js:L24-L38](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/clients.js#L24-L38), [warehouseAccess.js:L17-L43](file:///c:/Users/Evilonga/InforCliente/backend/src/utils/warehouseAccess.js#L17-L43)

**Fluxo actual**
- Login valida credenciais, detecta perfis internos vs. multi-conta e emite JWT com `role/clientId`: [auth.js:L22-L97](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L22-L97)
- Em pedidos HTTP, `authRequired` valida token e popula `req.user`: [auth.js:L5-L20](file:///c:/Users/Evilonga/InforCliente/backend/src/middlewares/auth.js#L5-L20)
- Se houver autorização por role, `requireRole` usa apenas o `role` do token: [auth.js:L22-L33](file:///c:/Users/Evilonga/InforCliente/backend/src/middlewares/auth.js#L22-L33)
- Se houver autorização por permissão, o resolver lê o utilizador na BD, carrega `role_permissions` + `user_permissions` e devolve `allowed`: [permissionResolver.js:L51-L120](file:///c:/Users/Evilonga/InforCliente/backend/src/services/permissionResolver.js#L51-L120)
- Em alguns módulos, o escopo final ainda depende de filtros Prisma adicionais por cliente/projecto/armazém: [projects.js:L109-L167](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/projects.js#L109-L167), [stock.js:L879-L1007](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/stock.js#L879-L1007)

**Limitações**
- `req.permissionScope` quase não é aplicado; no backend só aparece em [auth.js:L48-L55](file:///c:/Users/Evilonga/InforCliente/backend/src/middlewares/auth.js#L48-L55) e num único uso real em [projects.js:L154-L160](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/projects.js#L154-L160)
- A autorização não é centralizada; muito do scoping de cliente está espalhado e manual por rota.
- A matriz dinâmica não é a única fonte de verdade, porque várias rotas críticas continuam com `requireRole(...)`.
- O token guarda `role` e `clientId`, mas o sistema não tem refresh/revogação/blacklist.

**Riscos**
- Crítico: `/auth/select-account` emite JWT sem `authRequired`; basta `userId` + `clientId` válido para obter token: [auth.js:L101-L163](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L101-L163)
- Alto: `/auth/available-projects` também é público e permite consultar projectos por `userId`: [auth.js:L166-L258](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L166-L258)
- Alto: `requireRole` confia no `role` do token, não no valor actual da BD; mudanças de role só fazem efeito após expiração do JWT: [auth.js:L22-L33](file:///c:/Users/Evilonga/InforCliente/backend/src/middlewares/auth.js#L22-L33)
- Alto: o bypass de admin no resolver também usa o `role` do token: [permissionResolver.js:L112-L115](file:///c:/Users/Evilonga/InforCliente/backend/src/services/permissionResolver.js#L112-L115)
- Médio/alto: permissões `own/view` podem ser concedidas sem enforcement efectivo na maioria das rotas.
- Médio: `clientId` no token pode ficar desactualizado e manter acesso a um contexto antigo até ao fim dos 7 dias.

Se quiser, no passo seguinte posso devolver uma matriz “rota -> middleware -> regra -> escopo aplicado/não aplicado” para todo o backend.

Fiz um mapeamento completo do frontend relacionado com autenticação, navegação, proteção de rotas, permissões e UI administrativa, cruzando também com o backend para validar o fluxo real e os pontos de falha.

**Ficheiros‑chave**
- Login e sessão: [login.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Auth/login.js#L1-L84), [auth.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/services/auth.js#L1-L82), [api.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/services/api.js#L56-L92)
- Seleção pós-login: [accountSelection.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Auth/accountSelection.js#L1-L84), [projectSelection.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Auth/projectSelection.js#L1-L115), [auth.js](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L12-L99)
- Navegação/menus: [session.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/shared/session.js#L13-L141), [Dashboard/index.html](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Dashboard/index.html#L103-L181), [Users/index.html](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Users/index.html)
- Camada de permissões no frontend: [permissions.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/shared/permissions.js#L54-L275)
- Catálogo e guards centrais no backend: [permissionsCatalog.js](file:///c:/Users/Evilonga/InforCliente/backend/src/config/permissionsCatalog.js#L111-L264), [permissions.js](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/permissions.js#L25-L67), [auth middleware](file:///c:/Users/Evilonga/InforCliente/backend/src/middlewares/auth.js#L35-L64)
- UI administrativa de utilizadores/permissões: [users.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Users/users.js#L1-L1503), [users routes](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/users.js#L201-L285), [permissions routes](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/permissions.js#L85-L275)

**Fluxo atual**
- O login faz `POST /auth/login`; se receber `token`, grava sessão em `localStorage`; se receber `MULTI_ACCOUNT`, guarda estado temporário e redireciona para seleção intermédia em [login.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Auth/login.js#L46-L79).
- A sessão vive em `localStorage` com `InfoCliente.token` e `InfoCliente.user`; `logout()` limpa quase tudo e `checkAuth()` valida presença de token/utilizador antes de abrir a página em [auth.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/services/auth.js#L1-L82).
- O frontend tenta sempre preservar `?next=...`; em 401 a API limpa sessão e volta ao login em [api.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/services/api.js#L71-L91).
- Para perfis não internos, o backend devolve `MULTI_ACCOUNT` em vez de token; depois o frontend usa `/auth/select-account` para fechar o contexto ativo em [backend auth](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L62-L99) e [projectSelection.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Auth/projectSelection.js#L67-L100).
- As permissões efetivas vêm de `GET /permissions/me`, ficam em cache 5 min e são aplicadas à UI com `data-perm` e `data-nav-perm` em [permissions.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/shared/permissions.js#L54-L179).
- A proteção de páginas mais robusta usa `guardPageAccess(module, action)`; Stock e Project View usam-na, mas nem todas as páginas a usam em [stock.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Stock/stock.js#L56-L64) e [projectView.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Projectos/projectView.js#L29-L29), [projectView.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Projectos/projectView.js#L3152-L3153).

**Login e seleção**
- Perfis internos com login direto: `ADMIN`, `OPERADOR`, `TECNICO`, `SUPERVISOR` em [backend auth](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L38-L57).
- Perfis não internos entram em fluxo intermédio `MULTI_ACCOUNT`, mesmo que o ecrã seguinte seja “obra” e não “conta”, o que mostra acoplamento entre conta/cliente/projeto em [backend auth](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L62-L81).
- O frontend redireciona para `ProjectSelection.html` com `P` maiúsculo, enquanto o ficheiro é [projectSelection.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Auth/projectSelection.js); em Windows pode passar, mas em ambiente case-sensitive é risco claro em [login.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Auth/login.js#L51-L55).
- `select-account` altera `user.clientId` persistido no backend, o que mistura seleção de contexto com perfil base em [backend auth](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L147-L162).

**Menus e navegação**
- O link “Gestão” aparece só por papel `admin`, via `data-nav-users` e `wireUsersNav()`, não por permissão granular em [session.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/shared/session.js#L44-L54) e [Dashboard/index.html](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Dashboard/index.html#L131-L137).
- A navegação principal continua maioritariamente hardcoded em HTML; não é construída a partir do catálogo central de permissões em [Dashboard/index.html](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Dashboard/index.html#L112-L180).
- A visibilidade de muitos botões usa `data-role-visible`/`data-role-hidden`, o que é uma camada paralela ao sistema real de permissões em [session.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/shared/session.js#L13-L42).
- Tabs mais novas já usam `data-perm` e são escondidas pela permission layer em [Stock/index.html](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Stock/index.html#L241-L275) e [projectView.html](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Projectos/projectView.html#L328-L352).

**Proteção de rotas**
- Há duas estratégias em simultâneo:
- `checkAuth({ allowedRoles })` faz apenas controlo por papel e redirect básico em [auth.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/services/auth.js#L42-L81).
- `guardPageAccess(module, action)` valida permissões efetivas por módulo/ação em [permissions.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/shared/permissions.js#L249-L268).
- O backend define guards centrais por rota em [permissionsCatalog.js](file:///c:/Users/Evilonga/InforCliente/backend/src/config/permissionsCatalog.js#L253-L264), mas o frontend não os consome automaticamente para proteger páginas.
- Exemplo consistente: Stock usa `guardPageAccess("stock","view")` + `initPermissionLayer()` em [stock.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Stock/stock.js#L56-L64).
- Exemplo inconsistente: Dashboard geral usa só `checkAuth()` e nem sequer chama `guardPageAccess()` em [index.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Dashboard/index.js#L1-L6).
- Exemplo crítico: dashboard cliente só usa `checkAuth(["cliente","admin","operador","user"])` e `initPermissionLayer()`, sem `guardPageAccess()`, apesar do catálogo dizer que a página é para `cliente` em [clientDashboard.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Dashboard/clientDashboard.js#L1-L5), [clientDashboard.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Dashboard/clientDashboard.js#L2027-L2027), [permissionsCatalog.js](file:///c:/Users/Evilonga/InforCliente/backend/src/config/permissionsCatalog.js#L255-L263).
- Outro desvio: project view aceita `cliente` em `checkAuth()`, embora o catálogo central só marque `/Projectos/projectView.html` como `obras:view` sem whitelist de `cliente` em [projectView.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Projectos/projectView.js#L29-L29) e [permissionsCatalog.js](file:///c:/Users/Evilonga/InforCliente/backend/src/config/permissionsCatalog.js#L257-L263).

**Verificações de permissões**
- O frontend lê `/permissions/me` e usa o mapa para esconder elementos e abas em [permissions.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/shared/permissions.js#L55-L71) e [permissions.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/shared/permissions.js#L154-L205).
- `admin` faz bypass total no frontend (`canPermission` devolve sempre true) em [permissions.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/shared/permissions.js#L80-L87).
- O backend aplica a regra real com `requirePermission(module, action)` e distingue `true`, `own`, `view` em [auth middleware](file:///c:/Users/Evilonga/InforCliente/backend/src/middlewares/auth.js#L35-L64).
- A API de permissões expõe catálogo, matriz por perfil e overrides por utilizador; só admins podem alterar em [permissions routes](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/permissions.js#L51-L67) e [permissions routes](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/permissions.js#L105-L275).
- A app ainda mistura controlos por permissão com controlos por `requireRole([...])` em várias rotas backend, sobretudo em obras/logística, o que reduz previsibilidade da matriz de permissões em [grep de routes](file:///c:/Users/Evilonga/InforCliente/backend/src/routes).

**UI administrativa de utilizadores/permissões**
- A página admin arranca com `checkAuth({ allowedRoles: ["admin"] })` em [users.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Users/users.js#L1-L8).
- Gestão de utilizadores:
- Lista via `GET /users`, criação via `POST /users`, edição via `PATCH /users/:id`, eliminação via `DELETE /users/:id`; o backend protege com `requirePermission("sistema", ...)` em [users routes](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/users.js#L201-L285).
- O modal de criação permite associar cliente e obras ao utilizador em [users.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Users/users.js#L960-L1029).
- Mapa de permissões por perfil:
- Carrega `GET /permissions`, mostra módulos/páginas/abas do catálogo e permite ciclar `false -> view -> own -> true` em [users.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Users/users.js#L367-L541) e [users.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Users/users.js#L866-L888).
- Permissões individuais:
- Abre modal por utilizador com `GET /permissions/users/:userId`, mostra valor do perfil vs efetivo, e permite override com ciclo `inherit -> false -> view -> own -> true` em [users.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Users/users.js#L572-L842).
- Há também reset/sync global e histórico/logs admin na própria UI em [users.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Users/users.js#L1212-L1224) e [users.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Users/users.js#L1384-L1503).

**Limitações**
- Proteção de páginas inconsistente: algumas usam só papel (`checkAuth`), outras usam permissões (`guardPageAccess`), outras apenas escondem UI.
- Menu principal não nasce do catálogo central; qualquer alteração de permissões pode não refletir automaticamente nos links visíveis.
- Existem papéis referidos no frontend que não aparecem no catálogo base do backend, como `user`, `client` e variantes case-insensitive, criando ambiguidade em [auth.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/services/auth.js#L62-L67) e [permissionsCatalog.js](file:///c:/Users/Evilonga/InforCliente/backend/src/config/permissionsCatalog.js#L6-L15).
- A cache de permissões no frontend dura 5 minutos; fora da página admin, alterações podem não refletir imediatamente em sessões já abertas em [permissions.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/shared/permissions.js#L4-L8).
- A página de administração está concentrada numa única implementação muito grande (~1500 linhas), o que dificulta manutenção e testes em [users.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Users/users.js).

**Riscos**
- Inconsistência de autorização: utilizadores podem entrar numa página pelo frontend e só descobrir bloqueios ao chamar endpoints, ou o inverso.
- Falsa sensação de segurança na UI: vários botões/menus são escondidos por papel (`data-role-visible`) sem ligação direta ao sistema de permissões.
- Divergência frontend/backend: `clientDashboard` e `projectView` aceitam papéis no frontend que não batem certo com os route guards centrais.
- Portabilidade fraca: redirecionamento para `ProjectSelection.html` com capitalização diferente do padrão pode falhar fora de Windows.
- Acoplamento de contexto: `select-account` persiste `clientId` no utilizador, o que pode introduzir efeitos laterais entre sessões/contextos.
- Complexidade operacional: coexistem matriz por perfil, overrides por utilizador, guards por papel, guards por permissão e visibilidade por atributos HTML.

Se quiser, no passo seguinte posso devolver isto em formato de tabela “área → ficheiros → fluxo → risco → prioridade

A base já está clara: existe RBAC por perfil, overrides por utilizador e UI administrativa, mas com regras duplicadas entre role fixa, permissão dinâmica e filtros manuais. Vou confirmar alguns pontos críticos diretamente nos ficheiros antes de consolidar o plano.

O diagnóstico está fechado: o sistema já tem uma boa fundação para evolução gradual, mas ainda não tem uma fonte única de autorização nem uma navegação 100% orientada por permissões. Vou transformar isto num plano técnico faseado com prioridades, riscos e estratégia de migração sem quebra.

**Diagnóstico**
- O sistema já tem uma base sólida de RBAC evolutivo: perfis em `User.role`, matriz por perfil em [schema.prisma](file:///c:/Users/Evilonga/InforCliente/backend/prisma/schema.prisma#L571-L595) e catálogo central em [permissionsCatalog.js](file:///c:/Users/Evilonga/InforCliente/backend/src/config/permissionsCatalog.js#L1-L260).
- O backend combina `authRequired`, `requireRole` e `requirePermission`, mas a autorização ainda está dividida entre regras dinâmicas e regras fixas por papel em [auth.js](file:///c:/Users/Evilonga/InforCliente/backend/src/middlewares/auth.js#L5-L66).
- O frontend já consome permissões efetivas, esconde menus/abas e tem `guardPageAccess()`, mas a proteção de páginas ainda é inconsistente e parte da navegação continua hardcoded por role em [permissions.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/shared/permissions.js#L54-L275) e [session.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/shared/session.js#L13-L141).
- A UI administrativa já está num bom caminho: módulos, colapso, pesquisa, tabs e overrides por utilizador existem em [users.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Users/users.js#L367-L888).
- O modelo atual já suporta permissões por módulo, ação e utilizador, mas `own/view` ainda não é aplicado de forma uniforme nas rotas; hoje isso aparece de forma forte apenas em alguns fluxos, sobretudo obras.
- Há riscos imediatos de segurança e coerência: `/auth/select-account` e `/auth/available-projects` estão públicos em [auth.js](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L101-L258), e o token continua a carregar `role` e `clientId` como verdade operacional por até 7 dias.

**Problemas Prioritários**
- Fonte de verdade dupla: permissões dinâmicas coexistem com `requireRole`, o que dificulta manutenção e previsibilidade.
- Contexto de acesso misturado com dados do utilizador: `clientId` é persistido no `User` e também vai no JWT.
- Escopos incompletos: `own` e `view` existem semanticamente, mas ainda não foram centralizados como política de dados.
- Navegação parcialmente estática: menus e links não nascem automaticamente do catálogo de permissões.
- Integridade fraca na BD: `role`, `module`, `action` e `allowed` são `String` nas tabelas de permissão, sem enum/FK.
- Auditoria insuficiente: já existe logging geral, mas falta trilho específico e legível para alterações de permissões.

**Arquitetura Recomendada**
- Manter a arquitetura atual e evoluir, não reconstruir.
- Preservar `RolePermission` + `UserPermission` como base do sistema, porque já resolvem 80% do problema atual.
- Tornar o catálogo central a única fonte funcional para UI, guards de página, middleware e sincronização de defaults, expandindo o papel de [permissionsCatalog.js](file:///c:/Users/Evilonga/InforCliente/backend/src/config/permissionsCatalog.js#L111-L260).
- Criar uma camada explícita de autorização com 3 níveis:
  - `AuthN`: valida identidade e sessão.
  - `AuthZ`: resolve permissão efetiva e escopo.
  - `Scope enforcement`: aplica filtros de dados por cliente, obra, utilizador dono, estado do recurso.
- Separar “perfil base” de “contexto ativo”. O perfil continua no utilizador; o contexto ativo deixa de ser persistido como verdade de longo prazo em `User.clientId`.
- Introduzir versionamento de permissões/sessão para invalidar cache e JWT em alterações críticas.
- Evoluir para um modelo empresarial por etapas:
  - Etapa atual: RBAC + overrides por utilizador.
  - Etapa futura: RBAC + policies de escopo por recurso.
  - Etapa opcional futura: exceções por entidade concreta, apenas se houver necessidade real.

**Base de Dados**
- Não recomendo recriar o modelo de permissões agora.
- Recomendo manter `RolePermission` e `UserPermission`, mas endurecer o modelo:
  - Normalizar `role`, `module`, `action`, `allowed`.
  - Garantir sincronização com o catálogo central.
  - Adicionar índices e constraints coerentes com o uso real.
- Nova tabela recomendada já na primeira evolução:
  - `permission_audit_logs`
  - Campos: `id`, `actorUserId`, `targetType`, `targetId`, `role`, `module`, `action`, `beforeValue`, `afterValue`, `reason`, `createdAt`, `context`.
- Nova estrutura opcional, não obrigatória na fase inicial:
  - `auth_context_sessions` ou equivalente, para guardar contexto ativo por sessão sem contaminar `User.clientId`.
- Nova tabela apenas para futura granularidade fina:
  - `resource_access_rules` ou equivalente, se surgir requisito estável como “técnico X pode editar só obras Y” ou “não pode editar obras concluídas”.

**Segurança**
- Fechar imediatamente `/auth/select-account` e `/auth/available-projects`; estas rotas devem exigir prova de autenticação do passo anterior ou usar um token temporário de transição.
- Reduzir o JWT ao mínimo: `sub`, `sessionId/contextId`, `tokenVersion` e apenas claims indispensáveis.
- Deixar de confiar apenas no `role` do JWT para autorização privilegiada; validar versão/sessão e recarregar dados críticos do servidor.
- Centralizar o bypass de `admin` com regras explícitas e auditáveis, evitando exceções espalhadas.
- Transformar `own/view` em políticas reais de acesso a dados, não apenas estados retornados pelo resolver.
- Registar todas as alterações administrativas com antes/depois, ator e timestamp.
- Adicionar invalidação de sessão em alterações críticas de perfil/permissão.

**UX Administrativa**
- A interface atual já tem uma boa base modular; a evolução deve focar clareza, não recomeço.
- Recomendo uma UI em 3 camadas:
  - Visão por perfil.
  - Visão por módulo.
  - Personalizações por utilizador.
- Para cada módulo, usar:
  - card visual com resumo de acesso,
  - filtro por módulo/categoria,
  - pesquisa por ação/página,
  - select de nível (`Sem acesso`, `Leitura`, `Próprios`, `Total`),
  - resumo lateral das permissões aplicadas.
- Mostrar sempre “origem da permissão”:
  - herdada do perfil,
  - personalizada,
  - bloqueada por política do sistema.
- Adicionar comparação visual “Antes vs Depois” antes de guardar alterações em lote.
- Refatorar [users.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Users/users.js) em componentes/módulos menores para reduzir risco e facilitar testes.

**Navegação Dinâmica**
- Passar a construir menus a partir do catálogo e do mapa efetivo de permissões, e não de `role` hardcoded.
- Unificar o comportamento de páginas:
  - toda página protegida chama um guard comum,
  - o guard consulta catálogo + permissões efetivas,
  - a UI apenas melhora a experiência, nunca substitui o backend.
- Substituir `data-role-visible` e `wireUsersNav()` por uma camada baseada em `data-nav-perm`, mantendo exceções só onde houver razão explícita.
- Mapear cada rota/página a uma permissão mínima e consumir `PAGE_ROUTE_GUARDS` também no frontend.

**Estratégia de Refatoração**
- Começar pelo backend e segurança, não pela UI.
- Evitar big bang; manter compatibilidade entre `requireRole` e `requirePermission` durante uma fase transitória.
- Introduzir uma “camada adaptadora”:
  - rotas antigas continuam a funcionar,
  - novas rotas/módulos usam autorização central,
  - regras fixas vão sendo migradas para catálogo e política central.
- Tratar o catálogo atual como contrato interno do sistema:
  - nomes canónicos,
  - labels de UI,
  - defaults por perfil,
  - guards de página,
  - fallbacks de tabs.
- Separar autenticação, autorização e escopo em serviços independentes.

**Plano de Migração**
- Fasear por compatibilidade.
- Não apagar permissões atuais; migrar e validar.
- Criar scripts de diagnóstico:
  - permissões órfãs,
  - módulos/ações fora do catálogo,
  - overrides redundantes,
  - conflitos entre role fixa e permissão dinâmica.
- Fazer rollout com feature flags:
  - `useCentralPermissionGuards`
  - `useDynamicNav`
  - `usePermissionAuditLog`
  - `useScopedAuthorization`
- Rollback simples:
  - desativar flags,
  - voltar ao caminho antigo,
  - preservar dados novos sem os consumir.
- Medir impacto antes de expandir:
  - negações por permissão,
  - falhas 403 por rota,
  - tempo de resposta de `/permissions/me`,
  - divergências entre frontend e backend.

**Roadmap**
- **Fase 1**
- **Objetivo:** auditar e estabilizar o modelo atual sem alterar comportamento funcional.
- **Alterações:** inventário de rotas, catálogo canónico, matriz de inconsistências, fecho de endpoints públicos críticos, testes de regressão do fluxo de login e permissões.
- **Dependências:** acesso ao código atual e amostra de perfis reais.
- **Riscos:** descobrir regras implícitas fora do catálogo.
- **Critério de conclusão:** mapa completo `rota -> permissão -> escopo -> fonte atual`.

- **Fase 2**
- **Objetivo:** preparar o modelo de dados para escalar sem quebrar o atual.
- **Alterações:** normalização de valores, tabela de auditoria, opcionalmente tabela de contexto de sessão, scripts de validação e seed de catálogo.
- **Dependências:** catálogo consolidado da fase 1.
- **Riscos:** inconsistências históricas na BD.
- **Critério de conclusão:** schema preparado, migração reversível e sem perda de dados.

- **Fase 3**
- **Objetivo:** centralizar a autorização no backend.
- **Alterações:** serviço único de `authorize()`, enforcement real de `own/view`, migração gradual de `requireRole` para políticas baseadas no catálogo.
- **Dependências:** fase 2 concluída.
- **Riscos:** regressões em rotas com regras manuais por cliente/obra.
- **Critério de conclusão:** novas rotas e rotas críticas usam autorização central com logs e testes.

- **Fase 4**
- **Objetivo:** evoluir a experiência administrativa.
- **Alterações:** UI por módulos/categorias, filtros, pesquisa, selects de nível, resumo de impacto, histórico de alterações, batch save.
- **Dependências:** API estável de permissões e auditoria.
- **Riscos:** acoplamento com `users.js` atual.
- **Critério de conclusão:** admin consegue gerir perfil e exceções sem navegar por tabela extensa e sem ambiguidade.

- **Fase 5**
- **Objetivo:** unificar navegação e proteção de páginas no frontend.
- **Alterações:** menus dinâmicos por permissão, guard único por página, substituição progressiva de lógica baseada em role, invalidação de cache quando permissões mudam.
- **Dependências:** backend centralizado e catálogo fechado.
- **Riscos:** diferenças entre navegação atual e esperada por perfil.
- **Critério de conclusão:** páginas, menus e componentes consomem o mesmo contrato de permissões.

- **Fase 6**
- **Objetivo:** validar segurança, regressão e desempenho.
- **Alterações:** testes de integração, testes por perfil, testes de scoping `own/view`, testes de alteração administrativa, benchmarks de cache.
- **Dependências:** fases 3 a 5.
- **Riscos:** cobertura insuficiente em fluxos legados.
- **Critério de conclusão:** matriz de permissões validada para perfis-chave e sem regressões críticas.

- **Fase 7**
- **Objetivo:** deploy gradual e observável.
- **Alterações:** feature flags, rollout por grupo de utilizadores, monitorização de 401/403, plano de rollback, revisão pós-produção.
- **Dependências:** validação de testes e métricas.
- **Riscos:** permissões mal configuradas em utilizadores antigos.
- **Critério de conclusão:** nova camada ativa em produção com métricas estáveis e rollback testado.

**Prioridade Imediata**
- Corrigir as rotas públicas de transição de contexto em [auth.js](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/auth.js#L101-L258).
- Parar de usar `requireRole` como mecanismo principal em novos desenvolvimentos.
- Formalizar enforcement de `own/view` nas queries Prisma críticas.
- Passar a derivar menus do catálogo/permissões e não de `role`.
- Adicionar auditoria específica de alterações administrativas de permissões.
- Refatorar a página administrativa em módulos menores antes de lhe adicionar mais complexidade.

**Conclusão**
- A solução correta para o InforCliente não é reconstruir o módulo de permissões.
- O caminho mais seguro é evoluir o que já existe para uma arquitetura com:
  - catálogo central como contrato,
  - backend como fonte única de autorização,
  - frontend orientado por permissões reais,
  - contexto ativo separado do perfil,
  - auditoria e rollout gradual.
- O modelo atual já suporta essa evolução com baixo risco, desde que a ordem seja: segurança, centralização backend, UX administrativa, navegação dinâmica e só depois granularidade mais fina.

**Próximo Passo**
- Posso converter este plano num documento executável em fases com checklist técnica, tarefas por ficheiro e critérios de validação para implementação.

---

**User**

segue para a implementação viavel

**Assistant**

Vou implementar a fatia mais viável e de maior impacto imediato: fechar o risco de segurança no fluxo pós-login e alinhar o frontend com esse novo fluxo sem quebrar o módulo atual.

Estou a fechar o desenho técnico para que a correção seja segura e pequena: um token temporário de seleção no login, validado pelo backend, substituindo o uso inseguro de `userId` solto no frontend.

Já confirmei o ponto de integração: `apiRequest()` permite headers customizados, por isso consigo proteger o fluxo de seleção sem mexer no resto da app autenticada.

Vou editar primeiro o backend do `auth` e depois os ficheiros do frontend que dependem do novo token temporário, mantendo o comportamento atual de redirecionamento e sessão final.

A parte principal já está alterada: o backend deixou de aceitar `userId` solto nestes endpoints e o frontend passou a usar o token temporário devolvido no login. Agora vou fazer a verificação fina de sintaxe e warnings.

Vou validar agora os ficheiros alterados com diagnósticos e uma verificação rápida de sintaxe do backend para apanhar qualquer erro antes de te entregar.

Encontrei uma melhoria pequena e valiosa antes de fechar: vou mover o estado temporário do fluxo de seleção para `sessionStorage`, para que esse token curto não fique persistido além da sessão do separador.

A implementação já está estável e sem erros de diagnóstico; falta-me só uma revisão final do diff para te resumir exatamente o que mudou e o impacto.

---

