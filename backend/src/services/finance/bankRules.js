/**
 * Regras de classificação automática dos movimentos bancários (T2/T3), como
 * no protótipo: «a descrição contém X» (e, se se quiser, só saídas ou só
 * entradas) → tipo e, opcionalmente, a obra. A primeira regra que
 * corresponde ganha. Os tipos são os da app (BankMovementType).
 */

const TIPOS = ["TRANSFERENCIA_INTERNA", "PF", "REEMBOLSO", "OPERACAO_ANULADA", "RECEBIMENTO_CLIENTE", "LEVANTAMENTO_ATM", "OUTRO"];

/**
 * As regras de base do protótipo (REGRAS_DEF) que têm tipo na app. As de
 * encargos bancários (COM, IVA, JUROS, CGM, DESP), Estado (PE), saldo inicial
 * (SI), empréstimos (EMP), salários (SL, AD SL), SC e CC não têm tipo próprio
 * na app e ficam de fora. «MCX-LEV» (levantamento Multicaixa) é PF no
 * protótipo; na app há o tipo próprio Levantamento ATM.
 */
const REGRAS_BASE = [
  ["TRF INT", "", "TRANSFERENCIA_INTERNA"],
  ["SUBCONT", "-", "PF"],
  ["TRF KWIK PF", "", "PF"],
  ["PF |", "-", "PF"],
  ["TPA-", "-", "PF"],
  ["PGTO SERVI", "-", "PF"],
  ["SPTR DE", "+", "RECEBIMENTO_CLIENTE"],
  ["TC STC", "+", "RECEBIMENTO_CLIENTE"],
  ["TRF HBMB", "-", "PF"],
  ["MCX-LEV", "-", "LEVANTAMENTO_ATM"],
  ["OPE F/O", "-", "PF"],
  ["FRETE", "-", "PF"],
].map(([texto, sinal, tipo]) => ({ texto, sinal, tipo, projectId: null }));

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** A regra que classifica um movimento, ou null. `saida`: true / false. */
function regraPara(desc, saida, regras) {
  const d = norm(desc);
  return (
    (regras || []).find(
      (r) =>
        r.texto &&
        d.includes(norm(r.texto)) &&
        (!r.sinal || (r.sinal === "-" ? saida : !saida)) &&
        !(r.tipo === "RECEBIMENTO_CLIENTE" && saida)
    ) || null
  );
}

module.exports = { TIPOS, REGRAS_BASE, regraPara };
