# Fix Erro 400 em Tarefas

Este plano resolve o erro de "Bad Request" (400) que impede o carregamento da página de Gestão de Tarefas.

## Proposed Changes

### Backend (Módulos)

#### [MODIFY] [repository.js](file:///c:/Users/Evilonga/AUDMBT/backend/src/modules/tarefa/repository.js)
Ajustar o método `getInclude()` para selecionar `proprietario` a partir do modelo `pt` (Cliente) em vez de `subestacao`.

```javascript
// De:
subestacao: {
  select: {
    id: true,
    nome: true,
    municipio: true,
    proprietario: true // Erro aqui!
  }
}

// Para:
pt: {
  select: {
    // ...
    proprietario: true, // Correto aqui!
    subestacao: {
       select: {
         id: true,
         nome: true,
         municipio: true
         // proprietario removido daqui
       }
    }
  }
}
```

## Verification Plan

### Automated Tests
- Verificar o log do servidor backend para garantir que não há erros de inicialização.
- Testar o endpoint `/api/tarefas` via console ou ferramenta de API (se disponível).

### Manual Verification
- Aceder à página de **Gestão de Tarefas** no frontend.
- Confirmar que a tabela de tarefas carrega sem erros 400.
- Verificar se o nome do proprietário aparece corretamente nos detalhes da tarefa.
