const { test } = require("node:test");
const assert = require("node:assert/strict");

// A chave é lida no arranque do config, por isso tem de ser definida antes do require.
process.env.GEMINI_API_KEY = "chave-de-teste";
process.env.GEMINI_MODEL = "gemini-de-teste";

const {
  isConfigured,
  readInvoiceDocument,
  normalizeMimeType,
  parseDateValue,
  parseNumberValue,
  matchProject,
} = require("./invoiceScanService");

const PDF = Buffer.from("%PDF-1.4 teste");

function mockFetch(handler) {
  const original = global.fetch;
  global.fetch = handler;
  return () => {
    global.fetch = original;
  };
}

function geminiReply(payload) {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(payload) }] } }],
      }),
  };
}

test("isConfigured reflete a presença da GEMINI_API_KEY", () => {
  assert.equal(isConfigured(), true);
});

test("normalizeMimeType aceita o tipo declarado ou a extensão", () => {
  assert.equal(normalizeMimeType("application/pdf"), "application/pdf");
  assert.equal(normalizeMimeType("", "fatura.JPG"), "image/jpeg");
  assert.equal(normalizeMimeType("image/png; charset=binary"), "image/png");
  assert.equal(normalizeMimeType("text/plain", "nota.txt"), null);
});

test("parseDateValue aceita ISO, dia/mês/ano e número de série do Excel", () => {
  assert.equal(parseDateValue("2026-10-14").toISOString().slice(0, 10), "2026-10-14");
  assert.equal(parseDateValue("14/10/2026").toISOString().slice(0, 10), "2026-10-14");
  assert.equal(parseDateValue("14-10-26").toISOString().slice(0, 10), "2026-10-14");
  // Número de série do Excel (45000 = 2023-03-15)
  assert.equal(parseDateValue(45000).toISOString().slice(0, 10), "2023-03-15");
  assert.equal(parseDateValue(""), null);
  assert.equal(parseDateValue("ontem"), null);
});

test("parseNumberValue lê o formato angolano (1.234,56) e o internacional", () => {
  assert.equal(parseNumberValue("1.234,56"), 1234.56);
  assert.equal(parseNumberValue("1,234.56"), 1234.56);
  assert.equal(parseNumberValue("1234,5"), 1234.5);
  assert.equal(parseNumberValue("1 000 000,00 Kz"), 1000000);
  assert.equal(parseNumberValue(""), null);
});

test("matchProject encontra a obra pelo código, pelo nome ou dentro do texto", () => {
  const projects = [
    { id: "a", code: "OBR-001", name: "Edifício Kilamba" },
    { id: "b", code: "OBR-002", name: "Estrada Talatona" },
  ];
  assert.equal(matchProject(projects, "obr-002").id, "b");
  assert.equal(matchProject(projects, "Edifício Kilamba").id, "a");
  assert.equal(matchProject(projects, "Obra: OBR-001 — Edifício Kilamba, Luanda").id, "a");
  assert.equal(matchProject(projects, "Obra desconhecida"), null);
  assert.equal(matchProject(projects, ""), null);
});

test("readInvoiceDocument devolve os campos normalizados e sugere a obra", async () => {
  let requestedUrl = "";
  let requestedBody = null;
  const restore = mockFetch(async (url, options) => {
    requestedUrl = url;
    requestedBody = JSON.parse(options.body);
    return geminiReply({
      documentType: "FATURA",
      docNumber: "FT 2026/145",
      docDate: "2026-10-02",
      dueDate: "02/11/2026",
      grossAmount: "1.500.000,00",
      vatAmount: "210.000,00",
      vatPercent: 14,
      withholdingAmount: "90.000,00",
      withholdingPercent: 6.5,
      netAmount: "1.620.000,00",
      currency: "AOA",
      supplierName: "Construções ABC, Lda",
      supplierNif: "5000000000",
      projectHint: "OBR-001",
      notes: "Pagamento a 30 dias",
      confidence: 0.92,
    });
  });

  try {
    const result = await readInvoiceDocument({
      buffer: PDF,
      mimeType: "application/pdf",
      fileName: "fatura.pdf",
      projects: [{ id: "a", code: "OBR-001", name: "Edifício Kilamba", clientName: "Cliente X" }],
    });

    assert.match(requestedUrl, /models\/gemini-de-teste:generateContent\?key=chave-de-teste/);
    const parts = requestedBody.contents[0].parts;
    assert.equal(parts[1].inline_data.mime_type, "application/pdf");
    assert.equal(Buffer.from(parts[1].inline_data.data, "base64").toString(), PDF.toString());
    assert.equal(requestedBody.generationConfig.responseFormat.text.mimeType, "APPLICATION_JSON");
    assert.deepEqual(requestedBody.generationConfig.responseFormat.text.schema.required, [
      "documentType",
      "docNumber",
      "docDate",
      "dueDate",
      "grossAmount",
      "vatAmount",
      "vatPercent",
      "withholdingAmount",
      "withholdingPercent",
      "carInsuranceAmount",
      "guaranteeAmount",
      "netAmount",
      "currency",
      "supplierName",
      "supplierNif",
      "clientName",
      "clientNif",
      "projectHint",
      "description",
      "notes",
      "confidence",
    ]);

    assert.equal(result.docNumber, "FT 2026/145");
    assert.equal(result.docDate, "2026-10-02");
    assert.equal(result.dueDate, "2026-11-02");
    assert.equal(result.grossAmount, 1500000);
    assert.equal(result.vatAmount, 210000);
    assert.equal(result.vatPercent, 14);
    assert.equal(result.withholdingAmount, 90000);
    assert.equal(result.withholdingPercent, 6.5);
    assert.equal(result.netAmount, 1620000);
    assert.equal(result.supplierName, "Construções ABC, Lda");
    assert.equal(result.suggestedProjectId, "a");
    assert.equal(result.confidence, 92);
    assert.equal(result.model, "gemini-de-teste");
  } finally {
    restore();
  }
});

test("readInvoiceDocument rejeita uma leitura sem JSON e formatos não suportados", async () => {
  const restore = mockFetch(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "desculpe, não consegui" }] } }] }),
  }));

  try {
    await assert.rejects(
      () => readInvoiceDocument({ buffer: PDF, mimeType: "application/pdf" }),
      (err) => err.status === 422 && err.code === "AI_UNREADABLE"
    );
    await assert.rejects(
      () => readInvoiceDocument({ buffer: PDF, mimeType: "text/plain", fileName: "nota.txt" }),
      (err) => err.status === 415 && err.code === "UNSUPPORTED_FILE_TYPE"
    );
  } finally {
    restore();
  }
});

test("readInvoiceDocument traduz os erros da API em mensagens úteis", async () => {
  const restore = mockFetch(async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }),
  }));

  try {
    await assert.rejects(
      () => readInvoiceDocument({ buffer: PDF, mimeType: "image/png" }),
      (err) => err.status === 503 && err.code === "AI_INVALID_KEY" && /GEMINI_API_KEY/.test(err.message)
    );
  } finally {
    restore();
  }
});

test("readInvoiceDocument falha cedo sem ficheiro", async () => {
  await assert.rejects(
    () => readInvoiceDocument({ buffer: Buffer.alloc(0), mimeType: "application/pdf" }),
    (err) => err.status === 400 && err.code === "NO_FILE_UPLOADED"
  );
});
