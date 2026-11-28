/**
 * Frota — regras sem base de dados, tiradas do módulo «frota» do protótipo
 * (`docEst`, `cartaEst`, `planEst`, `segEstado`, `abCalc`, `custosLin`,
 * `alertas`). Recebem registos já lidos (datas em ISO `YYYY-MM-DD`, números
 * como Number) e devolvem estados e listas prontas a mostrar.
 */

const AV_DOC = 30; // dias de aviso para documentos e seguros
const AV_CARTA = 60; // dias de aviso para a carta de condução
const AV_PLANO_FRAC = 0.1; // aviso quando falta ≤ 10% do intervalo do plano
const AV_PLANO_DIAS = 30;
const SEM_KM_DIAS = 45;

const ESTADOS_VIATURA = ["Operacional", "Em obra", "Em manutenção", "Avariada", "Acidentada", "Parada", "Em reserva", "Vendida", "Abatida"];
const TIPOS_INTERVENCAO = ["Manutenção Preventiva", "Manutenção Correctiva", "Reparação", "Pequena Reparação", "Inspecção", "Lubrificação", "Troca de Pneus", "Revisão Geral", "Outros"];
const SISTEMAS = ["Motor", "Caixa / Transmissão", "Travões", "Suspensão", "Direcção", "Eléctrico / Bateria", "Iluminação", "Escape", "Pneus", "Ar Condicionado", "Carroçaria", "Lubrificação / Fluidos", "Outros"];
const TIPOS_OCORRENCIA = ["Avaria", "Acidente", "Infracção de Trânsito", "Multa", "Excesso de Velocidade", "Uso Indevido / Desvio", "Furto / Roubo", "Dano / Vandalismo", "Quase-Acidente", "Falha de Equipamento", "Reclamação", "Atraso / Incumprimento", "Outra"];
const GRAVIDADES = ["Baixa", "Média", "Alta", "Crítica"];
const ESTADOS_OCORRENCIA = ["Aberta", "Em análise", "Em reparação", "Resolvida", "Arquivada"];
const OCORRENCIA_FECHADA = ["Resolvida", "Arquivada"];
const TIPOS_DOCUMENTO = ["Livrete / Título de Propriedade", "Inspecção Periódica", "Taxa de Circulação", "Licença de Transporte", "Manifesto", "GPS / Rastreio", "Seguro Automóvel", "Outro"];
const DOCUMENTOS_OBRIGATORIOS = ["Livrete / Título de Propriedade", "Inspecção Periódica", "Taxa de Circulação"];
const SITUACOES_DOCUMENTO = ["Em vigor", "Não se aplica", "Arquivado"];
const COMBUSTIVEIS = ["Gasóleo", "Gasolina", "Eléctrico", "Híbrido"];
const PAGAMENTOS = ["Cartão de Combustível", "Numerário", "Fundo de Maneio", "Transferência", "Crédito no Posto", "Outro"];
const CATEGORIAS_CARTA = ["A", "B", "B/C", "C", "C/CE", "C + E", "D", "D/E"];
const COBERTURAS = ["Responsabilidade Civil", "Danos Próprios", "Quebra de Vidros", "Furto / Roubo", "Incêndio", "Ocupantes", "Assistência em Viagem"];
const PERIODICIDADES = ["ANUAL", "SEMESTRAL", "TRIMESTRAL", "MENSAL"];
const UNIDADES = [["KM", "Quilómetros"], ["HORAS", "Horas"], ["KM_HORAS", "Quilómetros / horas"]];
const PROPRIEDADES = [["PROPRIA", "Própria"], ["ALUGADA", "Alugada"], ["LEASING", "Leasing"]];
const CATEGORIAS_CUSTO = ["Combustível", "Manutenção e Reparação", "Pneus", "Ocorrências e Sinistros", "Multas", "Documentos e Taxas"];

const n = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const vazio = (v) => v === null || v === undefined || v === "";
const iso = (d) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : "");

function dias(d, hoje) {
  if (!d) return null;
  return Math.round((Date.parse(`${iso(d)}T00:00:00Z`) - Date.parse(`${iso(hoje)}T00:00:00Z`)) / 864e5);
}

function addMeses(d, m) {
  const x = new Date(`${iso(d)}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + n(m));
  return x.toISOString().slice(0, 10);
}

const unidade = (v) => (v?.unit === "HORAS" ? "h" : "km");
const ativa = (v) => v && v.active !== false && !["Vendida", "Abatida"].includes(v.status);

/** Próximo código de uma série: `AB-2026-007`, ou `FR-012` quando sem ano. */
function proximoCodigo(prefixo, existentes, { ano = null, digitos = 3 } = {}) {
  const base = ano ? `${prefixo}-${ano}-` : `${prefixo}-`;
  const max = (existentes || []).reduce((m, c) => {
    const s = String(c || "");
    if (!s.startsWith(base)) return m;
    const k = parseInt(s.slice(base.length), 10);
    return Number.isFinite(k) ? Math.max(m, k) : m;
  }, 0);
  return base + String(max + 1).padStart(digitos, "0");
}

/** Estado de um documento: [rótulo, tom]. Como o `docEst` do protótipo. */
function estadoDocumento(d, hoje) {
  if (d.situation === "Arquivado") return ["Arquivado", "neu"];
  if (d.situation === "Não se aplica") return ["Não se aplica", "neu"];
  if (!d.expiryDate) return ["Sem validade", "good"];
  const k = dias(d.expiryDate, hoje);
  if (k < 0) return ["Caducado", "bad"];
  if (k <= AV_DOC) return [`A caducar (${k} d)`, "warn"];
  return ["Válido", "good"];
}

/** Estado da carta de condução de um motorista. */
function estadoCarta(m, hoje) {
  if (!m.licenseExpiry) return ["Sem data", "neu"];
  const k = dias(m.licenseExpiry, hoje);
  if (k < 0) return ["Caducada", "bad"];
  if (k <= AV_CARTA) return [`Caduca em ${k} d`, "warn"];
  return ["Válida", "good"];
}

/** Estado de uma apólice. */
function estadoSeguro(s, hoje) {
  const k = dias(s.endDate, hoje);
  if (k === null) return ["Sem data", "neu"];
  if (k < 0) return ["Expirada", "bad"];
  if (k <= AV_DOC) return [`A expirar (${k} d)`, "warn"];
  if (dias(s.startDate, hoje) > 0) return ["Futura", "neu"];
  return ["Válida", "good"];
}

/**
 * Estado de um plano preventivo de uma viatura (`planEst` do protótipo).
 * plano: { nome, km, meses, ultKm, ultData }. Devolve { k: good|warn|bad|neu, t, proxKm, proxData }.
 */
function estadoPlano(v, p, hoje) {
  const at = n(v.odometer);
  const temKm = n(p.km) > 0;
  const temMeses = n(p.meses) > 0;
  const proxKm = temKm ? n(p.ultKm) + n(p.km) : null;
  const proxData = temMeses && p.ultData ? addMeses(p.ultData, p.meses) : null;
  if (!temKm && !temMeses) return { k: "neu", t: "Sem intervalo definido", proxKm, proxData };
  if ((temKm && vazio(p.ultKm)) && (temMeses && !p.ultData)) return { k: "warn", t: "Sem registo da última execução", proxKm, proxData };
  const un = unidade(v);
  let k = "good";
  const partes = [];
  if (proxKm !== null && !vazio(p.ultKm)) {
    const falta = proxKm - at;
    if (falta < 0) {
      k = "bad";
      partes.push(`ultrapassado em ${Math.round(-falta)} ${un}`);
    } else {
      if (falta <= n(p.km) * AV_PLANO_FRAC) k = "warn";
      partes.push(`faltam ${Math.round(falta)} ${un}`);
    }
  }
  if (proxData) {
    const d = dias(proxData, hoje);
    if (d < 0) {
      k = "bad";
      partes.push(`venceu há ${-d} dia(s)`);
    } else {
      if (d <= AV_PLANO_DIAS && k !== "bad") k = "warn";
      partes.push(`faltam ${d} dia(s)`);
    }
  }
  return { k, t: partes.join(" · ") || "Em dia", proxKm, proxData };
}

/** Pior estado dos planos de uma viatura. */
function estadoPlanos(v, hoje) {
  const planos = (Array.isArray(v.maintenancePlans) ? v.maintenancePlans : []).filter((p) => p?.nome);
  if (!planos.length) return { k: "neu", t: "Sem plano" };
  const est = planos.map((p) => ({ p, ...estadoPlano(v, p, hoje) }));
  const ordem = { bad: 0, warn: 1, good: 2, neu: 3 };
  est.sort((a, b) => ordem[a.k] - ordem[b.k]);
  const pior = est[0];
  return { k: pior.k, t: pior.k === "good" ? "Em dia" : `${pior.p.nome}: ${pior.t}` };
}

/** Apólices que cobrem a viatura, a mais recente primeiro. */
function segurosDaViatura(vid, seguros) {
  return (seguros || []).filter((s) => (s.vehicleIds || []).includes(vid)).sort((a, b) => iso(b.endDate).localeCompare(iso(a.endDate)));
}

function estadoSeguroViatura(vid, seguros, hoje) {
  const S = segurosDaViatura(vid, seguros);
  if (!S.length) return ["Sem seguro", "bad"];
  const val = S.map((s) => estadoSeguro(s, hoje)).find((e) => e[1] !== "bad");
  return val || ["Expirado", "bad"];
}

/** O último documento de um tipo para a viatura (ignora os arquivados). */
function ultimoDocumento(vid, tipo, documentos) {
  return (documentos || [])
    .filter((d) => d.vehicleId === vid && d.type === tipo && d.situation !== "Arquivado")
    .sort((a, b) => iso(b.expiryDate || b.issueDate).localeCompare(iso(a.expiryDate || a.issueDate)))[0];
}

const totalIntervencao = (i) => n(i.laborCost) + n(i.partsCost) + n(i.otherCost);

/**
 * Percurso, consumo e anomalias de cada abastecimento (`abCalc` do protótipo).
 * Devolve Map(id → { prevKm, perc, cons, ckm, an: [[tom, texto]] }).
 */
function calcularAbastecimentos(abastecimentos, viaturas) {
  const M = new Map();
  const porV = {};
  (abastecimentos || []).forEach((a) => (porV[a.vehicleId] = porV[a.vehicleId] || []).push(a));
  const vById = new Map((viaturas || []).map((v) => [v.id, v]));
  Object.entries(porV).forEach(([vid, L]) => {
    L.sort((a, b) => iso(a.date).localeCompare(iso(b.date)) || n(a.odometer) - n(b.odometer));
    const v = vById.get(vid);
    let prev = null;
    L.forEach((a) => {
      const r = { prevKm: prev ? n(prev.odometer) : null, perc: null, cons: null, ckm: null, an: [] };
      if (prev && !vazio(a.odometer)) {
        r.perc = n(a.odometer) - n(prev.odometer);
        if (r.perc < 0) r.an.push(["bad", `Km inferior ao abastecimento anterior (${n(prev.odometer)})`]);
        else if (r.perc === 0) r.an.push(["warn", "Km igual ao anterior"]);
        else {
          r.cons = (n(a.liters) / r.perc) * 100;
          r.ckm = n(a.amount) / r.perc;
          const ref = v && n(v.refConsumption);
          if (ref > 0 && (r.cons > ref * 1.3 || r.cons < ref * 0.7)) {
            r.an.push(["warn", `Consumo ${r.cons.toFixed(1)} L/100 km (referência ${ref.toFixed(1)})`]);
          }
        }
      }
      if (v && n(v.tankCapacity) > 0 && n(a.liters) > n(v.tankCapacity) * 1.05) {
        r.an.push(["warn", `Litros acima da capacidade do depósito (${n(v.tankCapacity)} L)`]);
      }
      M.set(a.id, r);
      if (!vazio(a.odometer)) prev = a;
    });
  });
  return M;
}

/** Linhas de custo por viatura (`custosLin` do protótipo). */
function linhasDeCusto({ abastecimentos = [], intervencoes = [], ocorrencias = [], documentos = [] }) {
  const L = [];
  const add = (d, vid, cat, v, origem, ref, desc) => {
    if (!vid || !n(v)) return;
    L.push({ d: iso(d), vid, cat, v: n(v), origem, ref, desc });
  };
  abastecimentos.forEach((a) => add(a.date, a.vehicleId, "Combustível", a.amount, "abastecimento", a.code, `${n(a.liters)} L${a.station ? ` · ${a.station}` : ""}`));
  intervencoes.forEach((i) => add(i.date, i.vehicleId, /pneu/i.test(i.type || "") ? "Pneus" : "Manutenção e Reparação", totalIntervencao(i), "intervencao", i.code, `${i.type} · ${i.description}`));
  ocorrencias.forEach((o) =>
    add(o.closedAt || o.date, o.vehicleId, /multa|infrac|velocid/i.test(o.type || "") ? "Multas" : "Ocorrências e Sinistros", o.cost, "ocorrencia", o.code, `${o.type} · ${o.description}`)
  );
  documentos.forEach((d) => add(d.issueDate, d.vehicleId, "Documentos e Taxas", d.cost, "documento", d.number || d.type, d.type));
  return L.sort((a, b) => b.d.localeCompare(a.d));
}

/**
 * Alertas da frota, por prioridade (1 alta, 2 média, 3 informativo).
 * Como o `alertas` do protótipo, sem pneus nem peças (ainda não há esses registos).
 */
function alertas(dados, hoje) {
  const { viaturas = [], motoristas = [], abastecimentos = [], ocorrencias = [], documentos = [], seguros = [] } = dados;
  const A = [];
  const add = (p, vid, area, problema, detalhe, link) => A.push({ p, vid, area, problema, detalhe, link });
  const mat = new Map(viaturas.map((v) => [v.id, v.plate]));

  viaturas.filter(ativa).forEach((v) => {
    if (["Avariada", "Acidentada"].includes(v.status)) add(2, v.id, "Viatura", `Viatura ${v.status.toLowerCase()}`, "Estado atual da viatura", `/frota/viaturas?id=${v.id}`);
    const S = segurosDaViatura(v.id, seguros);
    const sd = ultimoDocumento(v.id, "Seguro Automóvel", documentos);
    const sdOk = sd && estadoDocumento(sd, hoje)[1] !== "bad";
    const sVal = S.find((s) => estadoSeguro(s, hoje)[1] !== "bad");
    if (!sVal && !sdOk) {
      add(1, v.id, "Seguro", "Sem seguro válido", S.length ? `Última apólice terminou em ${iso(S[0].endDate)}` : "Nenhuma apólice cobre a viatura", "/frota/seguros");
    } else if (sVal && estadoSeguro(sVal, hoje)[1] === "warn") {
      add(2, v.id, "Seguro", "Seguro a expirar", `${sVal.insurer} · até ${iso(sVal.endDate)}`, "/frota/seguros");
    }
    (Array.isArray(v.maintenancePlans) ? v.maintenancePlans : []).filter((p) => p?.nome).forEach((p) => {
      const r = estadoPlano(v, p, hoje);
      if (r.k === "bad") add(1, v.id, "Manutenção", p.nome, r.t, "/frota/planos");
      else if (r.k === "warn") add(2, v.id, "Manutenção", p.nome, r.t, "/frota/planos");
    });
    DOCUMENTOS_OBRIGATORIOS.forEach((t) => {
      if (!ultimoDocumento(v.id, t, documentos)) add(3, v.id, "Documentos", `${t} em falta`, "Sem registo no quadro de documentos", `/frota/documentos?viatura=${v.id}`);
    });
    const ul = v.odometerAt;
    if (!ul || dias(ul, hoje) < -SEM_KM_DIAS) {
      add(3, v.id, "Quilometragem", `Sem registo de ${unidade(v)} há mais de ${SEM_KM_DIAS} dias`, ul ? `Último: ${iso(ul)}` : "Nunca registado", `/frota/viaturas?id=${v.id}`);
    }
  });

  const vAtivas = new Set(viaturas.filter(ativa).map((v) => v.id));
  documentos.forEach((d) => {
    if (!vAtivas.has(d.vehicleId) || ultimoDocumento(d.vehicleId, d.type, documentos) !== d) return;
    const e = estadoDocumento(d, hoje);
    if (e[1] === "bad") add(1, d.vehicleId, "Documentos", `${d.type} caducado`, `Validade ${iso(d.expiryDate)}`, `/frota/documentos?viatura=${d.vehicleId}`);
    else if (e[1] === "warn") add(2, d.vehicleId, "Documentos", `${d.type} a caducar`, `Validade ${iso(d.expiryDate)}`, `/frota/documentos?viatura=${d.vehicleId}`);
  });

  motoristas.filter((m) => m.status !== "Inativo").forEach((m) => {
    const e = estadoCarta(m, hoje);
    if (e[1] === "bad") add(1, "", "Motoristas", "Carta de condução caducada", `${m.name} · ${iso(m.licenseExpiry)}`, "/frota/motoristas");
    else if (e[1] === "warn") add(2, "", "Motoristas", "Carta de condução a caducar", `${m.name} · ${iso(m.licenseExpiry)}`, "/frota/motoristas");
  });

  ocorrencias.filter((o) => !OCORRENCIA_FECHADA.includes(o.status || "Aberta")).forEach((o) => {
    const ha = -dias(o.date, hoje);
    if (["Alta", "Crítica"].includes(o.severity)) add(1, o.vehicleId, "Ocorrências", `${o.type} ${o.severity.toLowerCase()} em aberto`, `${o.code} · ${ha} dia(s)`, "/frota/ocorrencias");
    else if (o.deadline && dias(o.deadline, hoje) < 0) add(2, o.vehicleId, "Ocorrências", "Ocorrência fora do prazo", `${o.code} · prazo ${iso(o.deadline)}`, "/frota/ocorrencias");
  });

  const C = calcularAbastecimentos(abastecimentos, viaturas);
  const lim = new Date(Date.parse(`${iso(hoje)}T00:00:00Z`) - 60 * 864e5).toISOString().slice(0, 10);
  abastecimentos.filter((a) => iso(a.date) >= lim).forEach((a) => {
    const r = C.get(a.id);
    (r?.an || []).forEach(([tom, t]) => {
      if (tom === "bad" && a.justification) return;
      add(tom === "bad" ? 1 : 2, a.vehicleId, "Abastecimentos", t, `${iso(a.date)} · ${n(a.odometer)} km · ${n(a.liters)} L`, "/frota/abastecimentos");
    });
  });

  return A.map((a) => ({ ...a, matricula: mat.get(a.vid) || "" })).sort((a, b) => a.p - b.p || a.matricula.localeCompare(b.matricula));
}

/** Indicadores do painel (V1). */
function painel(dados, hoje) {
  const { viaturas = [] } = dados;
  const ano = iso(hoje).slice(0, 4);
  const mes = iso(hoje).slice(0, 7);
  const A = viaturas.filter(ativa);
  const L = linhasDeCusto(dados);
  const porEstado = {};
  A.forEach((v) => (porEstado[v.status || "Operacional"] = (porEstado[v.status || "Operacional"] || 0) + 1));
  const meses = Array.from({ length: 12 }, (_, i) => {
    const k = `${ano}-${String(i + 1).padStart(2, "0")}`;
    return { mes: k, valor: L.filter((x) => x.d.slice(0, 7) === k).reduce((s, x) => s + x.v, 0) };
  });
  const porViatura = {};
  const porCategoria = {};
  L.filter((x) => x.d.slice(0, 4) === ano).forEach((x) => {
    porViatura[x.vid] = (porViatura[x.vid] || 0) + x.v;
    porCategoria[x.cat] = (porCategoria[x.cat] || 0) + x.v;
  });
  const mat = new Map(viaturas.map((v) => [v.id, v]));
  const ab = (dados.abastecimentos || []).filter((a) => iso(a.date).slice(0, 4) === ano);
  const AL = alertas(dados, hoje);
  return {
    ano,
    ativas: A.length,
    porEstado,
    custoMes: L.filter((x) => x.d.slice(0, 7) === mes).reduce((s, x) => s + x.v, 0),
    custoAno: L.filter((x) => x.d.slice(0, 4) === ano).reduce((s, x) => s + x.v, 0),
    litrosAno: ab.reduce((s, a) => s + n(a.liters), 0),
    meses,
    topViaturas: Object.entries(porViatura)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([vid, valor]) => ({ vid, matricula: mat.get(vid)?.plate || "", nome: [mat.get(vid)?.brand, mat.get(vid)?.model].filter(Boolean).join(" "), valor })),
    porCategoria: CATEGORIAS_CUSTO.map((c) => ({ categoria: c, valor: porCategoria[c] || 0 })).filter((c) => c.valor > 0),
    alertas: { total: AL.length, altas: AL.filter((a) => a.p === 1).length, primeiros: AL.slice(0, 8) },
    ocorrenciasAbertas: (dados.ocorrencias || []).filter((o) => !OCORRENCIA_FECHADA.includes(o.status || "Aberta")).length,
  };
}

/** Grupo da tipologia, como os filtros Viaturas / Máquinas / Equipamentos do protótipo. */
function grupoDe(kind) {
  const k = String(kind || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/reboq|trailer|semi/.test(k)) return "R";
  if (/maquin|escavad|retro|cilindro|grua|empilhad|motoniv|bulldo|pa carreg/.test(k)) return "M";
  if (/equip|gerador|compressor|betoneir/.test(k)) return "E";
  return "V";
}
const GRUPOS = [["V", "Viaturas"], ["M", "Máquinas"], ["E", "Equipamentos"], ["R", "Reboques"]];

function mesesAte(mes, quantos) {
  const [a, m] = mes.split("-").map(Number);
  return Array.from({ length: quantos }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - (quantos - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

/** Leitura de km / horas de uma viatura num mês (a maior menos a menor). */
function percursoMes(vid, dados, mes) {
  const kms = [
    ...(dados.abastecimentos || []).filter((a) => a.vehicleId === vid && !vazio(a.odometer) && iso(a.date).slice(0, 7) === mes).map((a) => n(a.odometer)),
    ...(dados.intervencoes || []).filter((i) => i.vehicleId === vid && !vazio(i.odometer) && iso(i.date).slice(0, 7) === mes).map((i) => n(i.odometer)),
  ];
  return kms.length > 1 ? Math.max(...kms) - Math.min(...kms) : 0;
}

/**
 * Painel de Gestão da Frota (o `V.frges` do protótipo, v667): quanto custa a
 * frota no mês e nos últimos 12, por categoria e por viatura, e o volume da
 * operação. `grupo` filtra por V / M / E / R; `per` é mes | 3 | 12.
 */
function painelGestao(dados, hoje, { mes = "", grupo = "", per = "mes" } = {}) {
  const M = /^\d{4}-\d{2}$/.test(mes) ? mes : iso(hoje).slice(0, 7);
  const keys = mesesAte(M, 12);
  const VV = (dados.viaturas || []).filter((v) => ativa(v) && (!grupo || grupoDe(v.kind) === grupo));
  const ids = new Set(VV.map((v) => v.id));
  const L = linhasDeCusto(dados).filter((x) => ids.has(x.vid) && keys.includes(x.d.slice(0, 7)));
  const soma = (f) => L.filter(f).reduce((s, x) => s + x.v, 0);
  const KP = per === "12" ? keys : per === "3" ? keys.slice(-3) : [M];
  const linhas = VV.map((v) => {
    const mine = L.filter((x) => x.vid === v.id);
    const cat = Object.fromEntries(CATEGORIAS_CUSTO.map((c) => [c, mine.filter((x) => x.cat === c && x.d.slice(0, 7) === M).reduce((s, x) => s + x.v, 0)]));
    return {
      vid: v.id,
      matricula: v.plate,
      nome: [v.brand, v.model].filter(Boolean).join(" "),
      cat,
      mes: Object.values(cat).reduce((s, x) => s + x, 0),
      doze: mine.reduce((s, x) => s + x.v, 0),
      km: percursoMes(v.id, dados, M),
    };
  }).sort((a, b) => b.mes - a.mes || b.doze - a.doze);
  const custoMes = linhas.reduce((s, x) => s + x.mes, 0);
  const km = linhas.reduce((s, x) => s + x.km, 0);
  const todas = (dados.viaturas || []).filter(ativa);
  const AL = alertas(dados, hoje);
  return {
    mes: M,
    meses: keys.map((k) => ({ mes: k, valor: soma((x) => x.d.slice(0, 7) === k), porCategoria: Object.fromEntries(CATEGORIAS_CUSTO.map((c) => [c, soma((x) => x.cat === c && x.d.slice(0, 7) === k)])) })),
    grupos: GRUPOS.map(([k, l]) => ({ k, l, n: todas.filter((v) => grupoDe(v.kind) === k).length })),
    ativas: VV.length,
    custoMes,
    custo12: L.reduce((s, x) => s + x.v, 0),
    km,
    viaturasComKm: linhas.filter((x) => x.km).length,
    custoPorKm: km > 0 ? custoMes / km : null,
    paradas: VV.filter((v) => /avari|manut|oficina|parad|acident/i.test(v.status || "")).length,
    categorias: CATEGORIAS_CUSTO.map((c) => ({ categoria: c, valor: soma((x) => x.cat === c && KP.includes(x.d.slice(0, 7))) })).filter((c) => c.valor > 0).sort((a, b) => b.valor - a.valor),
    linhas,
    alertas: { total: AL.length, altas: AL.filter((a) => a.p === 1).length },
    ocorrenciasAbertas: (dados.ocorrencias || []).filter((o) => !OCORRENCIA_FECHADA.includes(o.status || "Aberta")).length,
  };
}

/** Custos de uma viatura num período (V13): totais por categoria e as linhas. */
function custosViatura(vid, dados, { de = "", ate = "" } = {}) {
  const L = linhasDeCusto(dados).filter((x) => x.vid === vid && (!de || x.d >= de) && (!ate || x.d <= ate));
  const porCategoria = CATEGORIAS_CUSTO.map((c) => ({ categoria: c, valor: L.filter((x) => x.cat === c).reduce((s, x) => s + x.v, 0) }));
  const total = L.reduce((s, x) => s + x.v, 0);
  const kms = [
    ...(dados.abastecimentos || []).filter((a) => a.vehicleId === vid && !vazio(a.odometer) && (!de || iso(a.date) >= de) && (!ate || iso(a.date) <= ate)).map((a) => n(a.odometer)),
    ...(dados.intervencoes || []).filter((i) => i.vehicleId === vid && !vazio(i.odometer) && (!de || iso(i.date) >= de) && (!ate || iso(i.date) <= ate)).map((i) => n(i.odometer)),
  ];
  const percurso = kms.length > 1 ? Math.max(...kms) - Math.min(...kms) : 0;
  return { total, porCategoria, linhas: L, percurso, custoPorKm: percurso > 0 ? total / percurso : null };
}

/** Resumo de custos de todas as viaturas num período. */
function custosResumo(dados, { de = "", ate = "" } = {}) {
  const L = linhasDeCusto(dados).filter((x) => (!de || x.d >= de) && (!ate || x.d <= ate));
  return (dados.viaturas || [])
    .map((v) => {
      const mine = L.filter((x) => x.vid === v.id);
      const cat = Object.fromEntries(CATEGORIAS_CUSTO.map((c) => [c, mine.filter((x) => x.cat === c).reduce((s, x) => s + x.v, 0)]));
      return { vid: v.id, matricula: v.plate, nome: [v.brand, v.model].filter(Boolean).join(" "), ativa: ativa(v), total: mine.reduce((s, x) => s + x.v, 0), cat };
    })
    .sort((a, b) => b.total - a.total);
}

const LISTAS = {
  estadosViatura: ESTADOS_VIATURA,
  tiposIntervencao: TIPOS_INTERVENCAO,
  sistemas: SISTEMAS,
  tiposOcorrencia: TIPOS_OCORRENCIA,
  gravidades: GRAVIDADES,
  estadosOcorrencia: ESTADOS_OCORRENCIA,
  tiposDocumento: TIPOS_DOCUMENTO,
  documentosObrigatorios: DOCUMENTOS_OBRIGATORIOS,
  situacoesDocumento: SITUACOES_DOCUMENTO,
  combustiveis: COMBUSTIVEIS,
  pagamentos: PAGAMENTOS,
  categoriasCarta: CATEGORIAS_CARTA,
  coberturas: COBERTURAS,
  periodicidades: PERIODICIDADES,
  unidades: UNIDADES,
  propriedades: PROPRIEDADES,
  categoriasCusto: CATEGORIAS_CUSTO,
};

module.exports = {
  LISTAS,
  OCORRENCIA_FECHADA,
  proximoCodigo,
  estadoDocumento,
  estadoCarta,
  estadoSeguro,
  estadoSeguroViatura,
  estadoPlano,
  estadoPlanos,
  segurosDaViatura,
  ultimoDocumento,
  totalIntervencao,
  calcularAbastecimentos,
  linhasDeCusto,
  alertas,
  painel,
  painelGestao,
  grupoDe,
  GRUPOS,
  custosViatura,
  custosResumo,
  ativa,
  iso,
  addMeses,
};
