import { apiRequest, apiUpload } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { escapeFinanceHtml as esc } from "../financePage.js";

/**
 * «Conciliar» uma saída do extrato — alinhado com FXDRAW.conc do protótipo (v624–v638d).
 *
 *  - Suporta conciliação simples, conciliação parcial («Parcial · falta X» + «＋ Conciliar o Resto»)
 *    e repartição de um movimento por vários pedidos («Repartir Valores», v630).
 *  - Reconhece pagamentos já registados no pedido sem banco (v626): liga ao movimento sem duplicar pagamento.
 *  - Avisa quando o valor a pagar excede o valor em falta no pedido (v628).
 */

const fmt = (v) => (Number(v) || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const fmtD = (iso) => {
  const s = String(iso || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—";
};
const contaCod = (c) => (c ? [c.bank, c.label].filter(Boolean).join(" ") + (c.lastDigits ? ` •${c.lastDigits}` : "") : "Sem conta");

function parseInputMoney(raw) {
  const s = String(raw || "").trim().replace(/\s+/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? r2(Math.max(0, n)) : 0;
}

export function abrirConciliarSaida(m, { onSaved, onCusto, returnTo = "/Financeiro/conciliacao" } = {}) {
  const movTotal = r2(Math.abs(Number(m.amount) || 0));
  const contParc = Boolean(m.reparticao?.partial);
  const dispInicial = contParc ? r2(m.reparticao.falta) : movTotal;

  const st = {
    q: "",
    todos: false,
    itens: null,
    disp: dispInicial,
    pick: null,
    multi: [], // extra candidate objects selected
    alOn: contParc,
    aloc: {}, // orderId -> amount
    registar: true,
    comps: [],
    fats: [],
    tempo: null,
    _foco: false,
  };
  let corpo = null;
  let fechar = null;

  const selectedOrders = () => {
    if (!st.pick) return [];
    return [st.pick, ...st.multi.filter((x) => x && x.id !== st.pick.id)];
  };

  const buildAlocRows = () => {
    const orders = selectedOrders();
    let rem = st.disp;
    return orders.map((o) => {
      const regTotal = r2(o.regTotal || 0);
      const falta = r2(o.faltaPagar ?? o.falta ?? 0);
      let defVal = regTotal > 0.005 ? Math.min(regTotal, rem) : Math.min(falta > 0.005 ? falta : o.total, rem);
      if (st.aloc[o.id] !== undefined) defVal = r2(st.aloc[o.id]);
      defVal = r2(Math.max(0, defVal));
      rem = r2(rem - defVal);
      const jaPagoOuReg = o.estado === "Pago" || (regTotal > 0.005 && Math.abs(regTotal - defVal) <= 0.5);
      return { o, falta, regTotal, regSemBanco: o.regSemBanco || [], val: defVal, linkOnly: jaPagoOuReg };
    });
  };

  const isRepartirActive = () => {
    if (!st.pick) return false;
    if (st.alOn || contParc || st.multi.length > 0) return true;
    const rows = buildAlocRows();
    const tot = r2(rows.reduce((s, r) => s + r.val, 0));
    return rows.some((r) => r.regTotal > 0.005) || Math.abs(tot - st.disp) > 0.5;
  };

  const tabela = () => {
    if (st.itens === null) return '<p class="fx2-mut t3-small">A procurar…</p>';
    if (!st.itens.length) return '<p class="fx2-mut t3-small">Nada encontrado. Procure pelo número, fornecedor ou valor.</p>';
    return `<div class="fx2-tw"><table class="fx2-t cs-t"><thead><tr><th>Requisição</th><th>Venc.</th><th>Terceiro</th><th>Descrição</th><th class="r">Valor</th><th class="r">Já conciliado</th><th>Estado</th><th></th></tr></thead><tbody>
      ${st.itens
        .map(
          (o, i) => `<tr class="${o.proximo ? "cs-prox" : ""}"><td><b>${esc(o.number)}</b></td><td>${fmtD(o.dueDate)}</td><td>${esc(o.terceiro || "—")}</td><td>${esc(o.descricao)}</td>
        <td class="r">${fmt(o.total)}</td><td class="r">${o.conciliado ? fmt(o.conciliado) : "—"}</td>
        <td><span class="t2-pill${o.estado === "Pago" ? " t2-ok" : ""}">${esc(o.estado)}</span></td>
        <td><button type="button" class="finance-btn finance-btn--sm" data-cspick="${i}">Selecionar</button></td></tr>`
        )
        .join("")}</tbody></table></div>`;
  };

  const anexos = (L, tipo) =>
    L.map((f, i) => `<span class="cs-file">📎 ${esc(f.name)} <button type="button" class="t2-mini" data-csdel="${tipo}|${i}" title="Retirar">×</button></span>`).join("");

  const multiOrdersSection = () => {
    if (!st.pick || !st.itens) return "";
    const sameSupplier = st.itens.filter(
      (x) => x.id !== st.pick.id && (st.multi.some((m2) => m2.id === x.id) || (st.pick.terceiro && x.terceiro === st.pick.terceiro) || st.alOn)
    );
    if (!sameSupplier.length) return "";
    return `<div class="cs-multi" style="margin:8px 0;padding:8px 10px;border:1px dashed var(--line,#cbd5e1);border-radius:8px;background:#fff">
      <div class="t3-small"><b>Esta saída paga várias faturas / pedidos?</b> <span class="fx2-mut">Junte os outros pedidos e indique na repartição quanto cabe a cada um:</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">
        ${sameSupplier
          .slice(0, 12)
          .map((x) => {
            const checked = st.multi.some((m2) => m2.id === x.id);
            return `<label class="t3-small" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer">
              <input type="checkbox" data-csmulti="${esc(x.id)}"${checked ? " checked" : ""}>
              <b>${esc(x.number)}</b> · ${esc(x.terceiro || "—")} · falta ${fmt(x.falta)}
            </label>`;
          })
          .join("")}
      </div>
    </div>`;
  };

  const reparticaoBox = (rows) => {
    const tot = r2(rows.reduce((s, x) => s + x.val, 0));
    const resto = r2(st.disp - tot);
    return `<section class="cs-box" style="border-color:#1f5fd1;background:#f5f8ff;margin:8px 0">
      <h4 style="margin:0 0 6px">Repartição do Movimento${contParc ? " (resto)" : ""}</h4>
      <div class="fx2-tw"><table class="fx2-t" style="width:100%">
        <thead><tr><th>Pedido</th><th>Fornecedor</th><th class="r">Em falta no pedido</th><th class="r">Já registado (sem banco)</th><th class="r" style="width:165px">Valor a conciliar</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (x) => `<tr>
                <td><b>${esc(x.o.number)}</b></td>
                <td class="t3-small">${esc(x.o.terceiro || "—")}</td>
                <td class="r">${fmt(x.falta)}</td>
                <td class="r">${x.regSemBanco.length ? `${fmt(x.regTotal)} <span class="t3-small fx2-mut">(${x.regSemBanco.map((z) => fmtD(z.paidAt)).join(", ")})</span>` : "—"}</td>
                <td class="r"><input class="finance-input r" inputmode="decimal" data-csalv="${esc(x.o.id)}" value="${esc(fmt(x.val))}" style="width:145px;text-align:right"></td>
              </tr>`
            )
            .join("")}
        </tbody>
        <tfoot><tr><td colspan="4"><b>Total a conciliar agora</b> (movimento${contParc ? " — falta" : ""} ${fmt(st.disp)})</td><td class="r"><b>${fmt(tot)}</b></td></tr></tfoot>
      </table></div>
      ${
        resto > 0.5
          ? `<p class="t3-small" style="margin:6px 0 0;color:#b45309;font-weight:600">Ficam por conciliar ${fmt(resto)}: o movimento fica «Parcial» e depois concilia o resto com outro pedido (botão «＋ Conciliar o Resto» no extrato).</p>`
          : resto < -0.5
          ? `<p class="t3-small" style="margin:6px 0 0;color:#dc2626;font-weight:600">O total é maior do que o disponível no movimento em ${fmt(-resto)}.</p>`
          : `<p class="t3-small" style="margin:6px 0 0;color:#15803d;font-weight:600">✓ O total bate com o movimento.</p>`
      }
      <p class="fx2-mut t3-small" style="margin:4px 0 0">Se o pedido já tem o pagamento registado com este valor, fica só ligado ao banco; se não, regista-se o pagamento com este valor.</p>
    </section>`;
  };

  const confirmar = () => {
    const o = st.pick;
    const repOn = isRepartirActive();
    const rows = buildAlocRows();
    const tot = r2(rows.reduce((s, r) => s + r.val, 0));
    const resto = r2(st.disp - tot);
    const okRep = tot > 0.005 && resto >= -0.5;
    const pagoJa = o.estado === "Pago" || (o.regTotal > 0.005 && Math.abs(o.regTotal - st.disp) <= 0.5);
    const precisaComp = repOn
      ? rows.some((r) => r.val > 0.005 && !r.linkOnly && !r.o.temComprovativo)
      : !pagoJa && st.registar && !o.temComprovativo;

    return `<section class="cs-box cs-ok">
      <h4>Confirmar a Conciliação</h4>
      <p>O movimento de <b>${fmt(st.disp)}</b>${contParc ? ` (resto de ${fmt(movTotal)})` : ""} com o pedido <b>${esc(o.number)}</b> · ${esc(o.terceiro || "—")} · ${fmt(o.total)} (${esc(o.estado)}).</p>
      ${
        !repOn
          ? pagoJa
            ? '<p class="fx2-mut t3-small">O pedido já tem o pagamento registado: fica só a ligação ao movimento bancário.</p>'
            : `<label class="cs-chk"><input type="checkbox" data-csreg${st.registar ? " checked" : ""}> o pedido ainda não está pago: registar este movimento como pagamento</label>
               ${st.registar ? `<p class="fx2-mut t3-small">Fica registado um pagamento de <b>${fmt(st.disp)}</b>${st.disp < o.falta - 0.5 ? ` (faltam ${fmt(o.falta - st.disp)} do pedido)` : ""}.</p>` : ""}`
          : ""
      }
      ${multiOrdersSection()}
      ${repOn ? reparticaoBox(rows) : ""}
      <div class="cs-doc"><span>Comprovativos de pagamento ${precisaComp ? '<b class="t3-req">*</b>' : '<span class="fx2-mut">(opcional — pagamento já registado)</span>'} <span class="fx2-mut">(pode anexar vários)</span></span>
        <label class="finance-btn finance-btn--sm">Anexar<input type="file" hidden multiple accept=".pdf,image/*" data-csfile="comp"></label>${anexos(st.comps, "comp")}</div>
      <p class="fx2-mut t3-small">Os dados do pedido não batem com o banco (valor, fornecedor, centro de custo)? <a class="t3-lnk" href="/Financeiro/novoPedido?id=${encodeURIComponent(o.id)}&returnTo=${encodeURIComponent(returnTo)}">✎ Editar o pedido ${esc(o.number)}</a> — a informação fica sempre no centro de pagamentos.</p>
      <div class="cs-fat"><b>Fatura</b> <span class="fx2-mut">${st.fats.length ? "" : "ainda sem fatura (opcional)"}</span>${anexos(st.fats, "fat")}
        <label class="finance-btn finance-btn--sm finance-btn--primary cs-right">+ Anexar Fatura<input type="file" hidden multiple accept=".pdf,image/*" data-csfile="fat"></label></div>
      <div class="t3-acts">
        ${!repOn ? `<button type="button" class="finance-btn finance-btn--sm" data-csalon title="Conciliar só parte deste movimento com este pedido, ou repartir por vários pedidos">Repartir Valores</button>` : ""}
        <button type="button" class="finance-btn finance-btn--primary" data-csok${repOn && !okRep ? " disabled" : ""}>✓ Confirmar ${repOn && resto > 0.5 ? "Conciliação Parcial" : "conciliação"}</button>
        <button type="button" class="finance-btn" data-csback>Escolher outro</button>
      </div>
    </section>`;
  };

  const desenhar = () => {
    if (!corpo) return;
    const parcBanner = contParc
      ? `<div class="cs-box" style="border-color:#d97706;background:#fffbeb;margin-bottom:8px">
          Este movimento de <b>${fmt(movTotal)}</b> já está conciliado em parte — ${esc((m.reparticao.pedidos || []).map((p) => `${p.number}: ${fmt(p.amount)}`).join(" · "))}.
          <b>Falta conciliar ${fmt(st.disp)}</b>: escolha o pedido a que pertence.
        </div>`
      : "";
    corpo.innerHTML = `
      ${parcBanner}
      <section class="cs-box cs-novo"><b>Ainda não está no Centro de Pagamentos?</b>
        <a class="finance-btn finance-btn--primary" href="/Financeiro/novoPedido?movimento=${encodeURIComponent(m.id)}&returnTo=${encodeURIComponent(returnTo)}">＋ Registar o Pagamento e Conciliar</a>
        <span class="fx2-mut t3-small">regista o pedido já pago e conciliado; só o comprovativo é obrigatório</span></section>
      ${
        st.pick
          ? confirmar()
          : `<section class="cs-box"><h4>Escolha o Pedido do Centro de Pagamentos</h4>
        <div class="t3-acts"><input type="search" class="finance-input cs-q" data-csq placeholder="Procurar por n.º, fornecedor, produto, data, valor…" value="${esc(st.q)}">
          <span class="t3-small">${st.todos ? "Todos os tipos de pedido" : "Só pedidos <b>PF — Pagamento a Fornecedor</b> por conciliar"} · <button type="button" class="t3-lnk cs-lnk" data-cstodos>${st.todos ? "só PF" : "mostrar todos os tipos"}</button></span></div>
        ${tabela()}
        <p class="fx2-mut t3-small">Um movimento pode ser repartido por vários pedidos («Repartir Valores») ou um pedido pago por vários movimentos.</p></section>`
      }
      ${onCusto && !contParc ? `<p class="fx2-mut t3-small">Sem pedido de pagamento? <button type="button" class="t3-lnk cs-lnk" data-cscusto>Associar o custo da obra diretamente</button></p>` : ""}`;
    const q = corpo.querySelector("[data-csq]");
    if (q && document.activeElement?.dataset?.csq === undefined && st._foco) {
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
    }
  };

  const procurar = async () => {
    st.itens = null;
    desenhar();
    try {
      const r = await apiRequest(`/purchase-orders/bank-candidates?movementId=${encodeURIComponent(m.id)}&q=${encodeURIComponent(st.q)}${st.todos ? "&todos=1" : ""}`);
      st.itens = r.items || [];
      if (typeof r.movementRemaining === "number" && r.movementRemaining > 0.005) {
        st.disp = r2(r.movementRemaining);
      }
    } catch (e) {
      st.itens = [];
      toast(e.data?.message || e.message || "Falha ao procurar pedidos.", { type: "error" });
    }
    desenhar();
  };

  const gravar = async (btn) => {
    const o = st.pick;
    const repOn = isRepartirActive();

    if (!repOn && !contParc) {
      const pagoJa = o.estado === "Pago" || (o.regTotal > 0.005 && Math.abs(o.regTotal - st.disp) <= 0.5);
      const vaiPagar = !pagoJa && st.registar;
      if (vaiPagar && !st.comps.length && !o.temComprovativo) {
        return toast("Anexe o comprovativo de pagamento.", { type: "error" });
      }
      if (vaiPagar && st.disp > (o.faltaPagar ?? o.falta) + 0.5) {
        if (!window.confirm(`${o.number}: vai registar ${fmt(st.disp)}, mas só faltam ${fmt(o.faltaPagar ?? o.falta)} neste pedido. Continuar?`)) return;
      }
      btn.disabled = true;
      try {
        const fd = new FormData();
        fd.append("movementId", m.id);
        fd.append("registarPagamento", vaiPagar ? "1" : "0");
        st.comps.forEach((f) => fd.append("comprovativo", f));
        st.fats.forEach((f) => fd.append("fatura", f));
        await apiUpload(`/purchase-orders/${encodeURIComponent(o.id)}/bank-link`, fd);
        toast(`Conciliado com ${o.number}.`, { type: "success" });
        fechar?.();
        onSaved?.();
      } catch (e) {
        btn.disabled = false;
        toast(e.data?.message || e.message || "Falha ao conciliar.", { type: "error" });
      }
      return;
    }

    const rows = buildAlocRows().filter((r) => r.val > 0.005);
    if (!rows.length) return toast("Indique o valor a conciliar.", { type: "error" });
    const tot = r2(rows.reduce((s, r) => s + r.val, 0));
    if (tot > st.disp + 0.5) return toast("O total é maior do que o disponível no movimento.", { type: "error" });
    const precisaComp = rows.some((r) => !r.linkOnly && !r.o.temComprovativo);
    if (precisaComp && !st.comps.length) {
      return toast("Anexe o comprovativo de pagamento (para os pedidos que vão ser pagos agora).", { type: "error" });
    }
    for (const r of rows) {
      if (!r.linkOnly && r.val > r.falta + 0.5) {
        if (!window.confirm(`${r.o.number}: vai registar ${fmt(r.val)}, mas só faltam ${fmt(r.falta)} neste pedido. Continuar?`)) return;
      }
    }
    const resto = r2(st.disp - tot);
    const msg =
      `Conciliar ${fmt(tot)} deste movimento de ${fmt(movTotal)}:\n\n` +
      rows.map((r) => `• ${r.o.number}: ${fmt(r.val)}${r.linkOnly ? " — pagamento já registado, fica ligado ao banco" : " — regista o pagamento"}`).join("\n") +
      (resto > 0.5 ? `\n\nFicam por conciliar ${fmt(resto)} (o movimento fica Parcial).` : "");
    if (!window.confirm(msg)) return;

    btn.disabled = true;
    try {
      const fd = new FormData();
      fd.append("movementId", m.id);
      fd.append(
        "allocations",
        JSON.stringify(
          rows.map((r) => ({
            orderId: r.o.id,
            amount: r.val,
            linkOnly: r.linkOnly,
          }))
        )
      );
      st.comps.forEach((f) => fd.append("comprovativo", f));
      st.fats.forEach((f) => fd.append("fatura", f));
      const res = await apiUpload("/purchase-orders/bank-reconcile", fd);
      toast(res.partial ? `Conciliação parcial registada (falta ${fmt(res.remaining)}).` : "Conciliação registada.", { type: "success" });
      fechar?.();
      onSaved?.();
    } catch (e) {
      btn.disabled = false;
      toast(e.data?.message || e.message || "Falha ao conciliar.", { type: "error" });
    }
  };

  openModal({
    title: `<span class="rg-kick">CONCILIAR · ${esc(contaCod(m.card))}</span><br>Saída de ${fmt(movTotal)} AOA${contParc ? ` <span class="t2-pill t2-warnp">falta ${fmt(st.disp)}</span>` : ""}<div class="cs-sub">${fmtD(m.movementDate)} · ${esc(m.description || "")}</div>`,
    width: 1020,
    contentHtml: "<div data-cs></div>",
    primaryLabel: null,
    secondaryLabel: "Fechar",
    onRender: ({ panel, close }) => {
      fechar = close;
      corpo = panel.querySelector("[data-cs]");
      corpo.addEventListener("click", (e) => {
        const t = e.target;
        const pk = t.closest("[data-cspick]");
        if (pk) {
          st.pick = st.itens[Number(pk.dataset.cspick)];
          st.multi = [];
          st.aloc = {};
          st.alOn = contParc;
          st.registar = st.pick.estado !== "Pago";
          return desenhar();
        }
        if (t.closest("[data-csalon]")) {
          st.alOn = true;
          return desenhar();
        }
        if (t.closest("[data-csback]")) {
          st.pick = null;
          st.multi = [];
          st.aloc = {};
          st.alOn = contParc;
          return desenhar();
        }
        if (t.closest("[data-cstodos]")) {
          st.todos = !st.todos;
          return procurar();
        }
        if (t.closest("[data-csok]")) return gravar(t.closest("[data-csok]"));
        if (t.closest("[data-cscusto]")) {
          close();
          return onCusto?.();
        }
        const del = t.closest("[data-csdel]");
        if (del) {
          const [tipo, i] = del.dataset.csdel.split("|");
          (tipo === "comp" ? st.comps : st.fats).splice(Number(i), 1);
          return desenhar();
        }
      });
      corpo.addEventListener("change", (e) => {
        const t = e.target;
        if (t.dataset.csreg !== undefined) {
          st.registar = t.checked;
          return desenhar();
        }
        if (t.dataset.csmulti) {
          const id = t.dataset.csmulti;
          if (t.checked) {
            const found = (st.itens || []).find((x) => x.id === id);
            if (found && !st.multi.some((x) => x.id === id)) st.multi.push(found);
            st.alOn = true;
          } else {
            st.multi = st.multi.filter((x) => x.id !== id);
            delete st.aloc[id];
          }
          return desenhar();
        }
        if (t.dataset.csalv) {
          st.aloc[t.dataset.csalv] = parseInputMoney(t.value);
          return desenhar();
        }
        if (t.dataset.csfile) {
          const L = [...(t.files || [])].filter((f) => f.size <= 20 * 1024 * 1024);
          (t.dataset.csfile === "comp" ? st.comps : st.fats).push(...L);
          desenhar();
        }
      });
      corpo.addEventListener("input", (e) => {
        if (e.target.dataset.csq === undefined) return;
        st.q = e.target.value;
        st._foco = true;
        clearTimeout(st.tempo);
        st.tempo = setTimeout(procurar, 300);
      });
      procurar();
    },
  });
}
