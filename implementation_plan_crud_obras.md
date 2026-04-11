# CRUD Completo para Gestão de Obras

Atualmente, o sistema permite listar e criar obras, mas não exporta as funcionalidades de edição e exclusão de forma acessível na interface. Este plano habilita o CRUD completo no módulo de projetos.

## Mudanças Propostas

### Frontend

#### [MODIFY] [ProjectGeral.js](file:///c:/Users/Evilonga/InforCliente/frontend/src/pages/Projectos/ProjectGeral.js)
- **Visualização**: Atualizar `renderRow` para exibir botões de "Visualizar" e "Editar", seguindo o padrão visual do módulo de Clientes.
- **Edição**: Implementar a função `openEdit(id)` que:
  - Carrega os dados atuais da obra e a lista de clientes para o dropdown.
  - Abre um modal com todos os campos editáveis (Nome, Cliente, Contato, Região, Orçamento, Datas, Progresso, Status).
  - Envia uma requisição `PATCH /projects/:id` ao salvar.
- **Exclusão**: Adicionar um botão "Excluir" dentro do modal de edição que executa `DELETE /projects/:id` após confirmação do utilizador.

### Backend

#### [VERIFY] [projects.js](file:///c:/Users/Evilonga/InforCliente/backend/src/routes/projects.js)
- Confirmar que as rotas `PATCH` e `DELETE` estão a processar corretamente todos os campos do modelo `Project` (o check inicial confirma que sim).

## Plano de Verificação

### Testes Manuais
1. Abrir a Gestão de Obras.
2. Clicar no botão de edição de uma obra existente.
3. Alterar o status da obra (ex: de Ativo para Em Andamento) e o orçamento.
4. Salvar e verificar se a lista reflete as mudanças.
5. Tentar excluir uma obra de teste e confirmar se ela desaparece da lista.
