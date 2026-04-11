const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const API_URL = 'http://localhost:4000';
let token = '';

async function runTest() {
  try {
    console.log('--- Iniciando Teste de Validação ---');

    // 1. Login
    console.log('1. Autenticando...');
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: 'admin@inforcliente.com',
      password: 'admin' // Assumindo default
    });
    token = loginRes.data.token;
    console.log('   OK: Autenticado como admin.');

    // 2. Criar Obra de Teste (CRUD - Create)
    console.log('2. Criando obra de teste...');
    const projectRes = await axios.post(`${API_URL}/projects`, {
      name: 'Obra Validação ' + Date.now(),
      code: 'VAL-' + Math.floor(Math.random() * 1000),
      budgetTotal: 0,
      physicalProgressPct: 0
    }, { headers: { Authorization: `Bearer ${token}` } });
    const projectId = projectRes.data.id;
    console.log(`   OK: Obra criada com ID ${projectId}`);

    // 3. Upload de Orçamento (Sincronização)
    console.log('3. Importando orçamento (CSV)...');
    const form = new FormData();
    form.append('file', fs.createReadStream('c:/Users/Evilonga/InforCliente/scratch/test_budget.csv'));
    
    await axios.post(`${API_URL}/projects/${projectId}/budget/upload`, form, {
      headers: { 
        ...form.getHeaders(),
        Authorization: `Bearer ${token}` 
      }
    });

    // Verificar se orçamento total sincronizou
    let p = (await axios.get(`${API_URL}/projects/${projectId}`, { headers: { Authorization: `Bearer ${token}` } })).data.project;
    console.log(`   OK: Orçamento total sincronizado: ${p.budgetTotal} kz`);

    // 4. Lançamento de Custo (Sincronização Automática)
    console.log('4. Lançando custo vinculado ao orçamento...');
    
    // Pegar uma linha do orçamento
    const lines = (await axios.get(`${API_URL}/projects/${projectId}/budget/lines`, { headers: { Authorization: `Bearer ${token}` } })).data.items;
    const lineId = lines[0].id; // "Material Hidráulico"
    const amount = 50000;

    await axios.post(`${API_URL}/projects/${projectId}/transactions`, {
      description: 'Compra de Tubos',
      amount: amount,
      category: 'MATERIALS',
      budgetLineId: lineId
    }, { headers: { Authorization: `Bearer ${token}` } });

    // 5. Validar Resultados
    console.log('5. Validando resultados finais...');
    p = (await axios.get(`${API_URL}/projects/${projectId}`, { headers: { Authorization: `Bearer ${token}` } })).data.project;
    const linesFinal = (await axios.get(`${API_URL}/projects/${projectId}/budget/lines`, { headers: { Authorization: `Bearer ${token}` } })).data.items;
    const targetLine = linesFinal.find(l => l.id === lineId);

    console.log('--- RELATÓRIO FINAL ---');
    console.log(`Consumido Total (KZ): ${p.budgetConsumed}`);
    console.log(`Disponível Total (KZ): ${p.budgetAvailable}`);
    console.log(`Consumido na Linha "${targetLine.description}": ${targetLine.consumed} / ${targetLine.total}`);

    if (Number(p.budgetConsumed) === amount) {
      console.log('✅ SUCESSO: O orçamento geral e o detalhamento por item estão sincronizados!');
    } else {
      console.log('❌ FALHA: O valor consumido não bate com o lançamento.');
    }

  } catch (err) {
    console.error('❌ ERRO NO TESTE:', err.response?.data || err.message);
  }
}

runTest();
