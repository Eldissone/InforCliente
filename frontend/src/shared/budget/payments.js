// Lançamentos pendentes/histórico, aside de pagamento, lançamento e liquidação
import { apiRequest, getAssetUrl, apiUpload } from "/services/api.js";
import { can } from "/shared/permissions.js";
import { getSessionUser } from "/services/auth.js";
import { formatCurrency, formatDateBR, formatDateOnlyBR, toDateKey, dateInputToUtcNoonIso } from "/shared/format.js";
import { renderGroupedListRows, TIMELINE_STATUS, formatTimelineDayLabel } from "/shared/paymentTimeline.js";
import { computeFiscalBreakdown, paymentPayableAmount } from "/shared/supplierFiscal.js";
import { renderAsideProductSection, renderAsideAccountingLine } from "/shared/paymentDetailAside.js";

let _ctx = null;
const ctx = () => _ctx;
let currentSuppliers = [];
let currentTxStatus = "PENDING";

/** ctx: { getProject, showToast(msg,type), onChanged(), reloadCronograma() } */
export function initPayments(context) {
  _ctx = context;
}

function reloadPaymentsView() {
  ctx().onChanged?.();
  ctx().reloadCronograma?.();
  loadTransactions?.();
  loadHistory?.();
}

const PENDING_HTML = `                <!-- KPIs pendentes -->
                <div class="grid grid-cols-3 gap-4 mb-4">
                    <div class="kpi-card">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Pendentes
                        </p>
                        <p id="kpiTxPending" class="text-xl font-bold text-amber-600 tracking-tight">—</p>
                    </div>
                    <div class="kpi-card">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Valor
                            Comprometido</p>
                        <p id="kpiTxCommitted" class="text-xl font-bold text-slate-900 tracking-tight">—</p>
                    </div>
                    <div class="kpi-card">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Liquidados
                        </p>
                        <p id="kpiTxPaid" class="text-xl font-bold text-emerald-600 tracking-tight">—</p>
                    </div>
                </div>

                <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div
                        class="px-6 py-5 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div>
                            <h3 class="font-bold text-slate-900">Lançamentos Pendentes de Liquidação</h3>
                            <p class="text-xs text-slate-400 mt-0.5">Lançamentos da obra aguardando liquidação</p>
                        </div>
                        <div class="flex items-center gap-3 flex-wrap">
                            <select id="txCategoryFilter"
                                class="h-9 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none">
                                <option value="">Todas as categorias</option>
                                <option value="MATERIAL">Material</option>
                                <option value="SERVICO">Serviço</option>
                                <option value="MAO_DE_OBRA">Mão de Obra</option>
                                <option value="EQUIPAMENTO">Equipamento</option>
                                <option value="TRANSPORTE">Transporte</option>
                                <option value="ADMINISTRATIVO">Administrativo</option>
                                <option value="OUTRO">Outro</option>
                            </select>
                        </div>
                    </div>
                    <div class="overflow-x-auto custom-scroll">
                        <table class="w-full cc-table">
                            <thead>
                                <tr>
                                    <th class="text-left">Data</th>
                                    <th class="text-left">Descrição</th>
                                    <th class="text-left">Fornecedor</th>
                                    <!-- <th class="text-left">Categoria</th> -->
                                    <th class="text-center">Tipo</th>
                                    <th class="text-center">Centro</th>
                                    <th class="text-right">Previsto</th>
                                    <th class="text-right">Realizado</th>
                                    <th class="text-center">Status</th>
                                    <th class="text-center">Ações</th>
                                </tr>
                            </thead>
                            <tbody id="txTableBody">
                                <tr>
                                    <td colspan="10">
                                        <div class="spinner my-8"></div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div id="txPagination"
                        class="flex items-center justify-between px-6 py-4 border-t border-slate-50 text-xs font-semibold text-slate-400">
                    </div>
                </div>`;
const HISTORY_HTML = `                <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div
                        class="px-6 py-5 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div>
                            <h3 class="font-bold text-slate-900">Histórico de Liquidações</h3>
                            <p class="text-xs text-slate-400 mt-0.5">Lançamentos da obra já liquidados / pagos</p>
                        </div>
                        <div class="flex items-center gap-3 flex-wrap">
                            <select id="historyCategoryFilter"
                                class="h-9 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none">
                                <option value="">Todas as categorias</option>
                                <option value="MATERIAL">Material</option>
                                <option value="SERVICO">Serviço</option>
                                <option value="MAO_DE_OBRA">Mão de Obra</option>
                                <option value="EQUIPAMENTO">Equipamento</option>
                                <option value="TRANSPORTE">Transporte</option>
                                <option value="ADMINISTRATIVO">Administrativo</option>
                                <option value="OUTRO">Outro</option>
                            </select>
                        </div>
                    </div>
                    <div class="overflow-x-auto custom-scroll">
                        <table class="w-full cc-table">
                            <thead>
                                <tr>
                                    <th class="text-left">Data Liq.</th>
                                    <th class="text-left">Descrição</th>
                                    <th class="text-left">Fornecedor</th>
                                    <th class="text-left">Categoria</th>
                                    <th class="text-left">Tipo</th>
                                    <th class="text-left">CC</th>
                                    <th class="text-right">Comprometido</th>
                                    <th class="text-right">Liquidado</th>
                                    <th class="text-center">Status</th>
                                    <th class="text-center">—</th>
                                </tr>
                            </thead>
                            <tbody id="historyTableBody">
                                <tr>
                                    <td colspan="10">
                                        <div class="spinner my-8"></div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div id="historyPagination"
                        class="flex items-center justify-between px-6 py-4 border-t border-slate-50 text-xs font-semibold text-slate-400">
                    </div>
                </div>`;
const MODALS_HTML = `    <div id="paymentAsideOverlay"
        class="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[50] hidden transition-opacity opacity-0"
        onclick="closePaymentAside()"></div>
    <aside id="paymentAside"
        class="fixed right-0 top-0 h-full w-full max-w-[600px] bg-white shadow-2xl z-[60] transform translate-x-full transition-transform duration-300 flex flex-col border-l border-slate-200">
        <div class="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <div>
                <div class="flex items-center gap-3">
                    <h2 class="text-lg font-bold text-slate-900 tracking-tight">Detalhes do Lançamento</h2>
                    <span id="asideStatusBadge"
                        class="hidden px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest"></span>
                </div>
                <p class="text-xs font-semibold text-slate-500 mt-0.5">Verificação antes do pagamento</p>
            </div>
            <button type="button" onclick="closePaymentAside()" aria-label="Fechar Detalhes"
                class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-200 text-slate-400 transition-colors">
                <span class="material-symbols-outlined text-lg">close</span>
            </button>
        </div>
        <div class="flex-1 overflow-y-auto p-6 custom-scroll flex flex-col gap-6">
            <!-- Resumo -->
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-1">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Descrição</p>
                    <p id="asideDesc" class="text-sm font-bold text-slate-900"></p>
                </div>
                <div id="asideProductSection"
                    class="hidden flex flex-col gap-1 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Produto</p>
                    <p id="asideProductName" class="text-sm font-bold text-slate-900">—</p>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div class="flex flex-col gap-1">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Data</p>
                        <p id="asideDate" class="text-sm font-bold text-slate-700"></p>
                    </div>
                    <div class="flex flex-col gap-1">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Fornecedor</p>
                        <p id="asideSupplier" class="text-sm font-bold text-slate-700"></p>
                    </div>
                    <!-- Fornecedor Info (NIF/IBAN) -->
                    <div id="asideSupplierDetails"
                        class="hidden col-span-2 flex flex-col gap-2 p-4 bg-slate-50 border border-slate-200 rounded-xl mb-1">
                        <div class="flex justify-between items-center">
                            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">NIF</p>
                            <p id="asideNIF" class="text-xs font-bold text-slate-700">—</p>
                        </div>
                        <div class="flex justify-between items-center">
                            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">IBAN</p>
                            <p id="asideIBAN" class="text-xs font-bold text-slate-700">—</p>
                        </div>
                    </div>
                    <div class="flex flex-col gap-1">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Categoria</p>
                        <p id="asideCategory" class="text-sm font-bold text-slate-700"></p>
                    </div>
                    <div class="flex flex-col gap-1">
                        <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Tipo de Pagamento</p>
                        <p id="asidePaymentType" class="text-sm font-bold text-slate-700">—</p>
                    </div>
                    <div id="asideCreditTermSection"
                        class="hidden col-span-2 flex flex-col gap-2 p-4 bg-sky-50 border border-sky-100 rounded-xl">
                        <div class="flex justify-between items-center gap-4">
                            <p class="text-[10px] font-black uppercase tracking-widest text-sky-700">Prazo acordado</p>
                            <p id="asideCreditTerm" class="text-sm font-black text-sky-900">—</p>
                        </div>
                        <div id="asideCreditInstallmentRow" class="flex justify-between items-center gap-4">
                            <p class="text-[10px] font-black uppercase tracking-widest text-sky-700">Parcela</p>
                            <p id="asideCreditInstallment" class="text-xs font-bold text-sky-800">—</p>
                        </div>
                    </div>
                    <div id="asideAccountingSection"
                        class="col-span-2 flex flex-col gap-2 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                        <div class="overflow-x-auto custom-scroll">
                            <div class="flex items-start gap-5 min-w-max">
                                <div class="flex flex-col gap-0.5">
                                    <span class="text-[9px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">Qtd</span>
                                    <span id="asideAcctQty" class="text-xs font-bold text-slate-800 tabular-nums whitespace-nowrap">—</span>
                                </div>
                                <div class="flex flex-col gap-0.5">
                                    <span class="text-[9px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">P. Unit.</span>
                                    <span id="asideAcctUnitPrice" class="text-xs font-bold text-slate-800 tabular-nums whitespace-nowrap">—</span>
                                </div>
                                <div class="flex flex-col gap-0.5 min-w-[5.5rem]">
                                    <span class="text-[9px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">IVA</span>
                                    <div id="asideAcctVat" class="flex flex-col gap-0.5 text-emerald-600 tabular-nums">—</div>
                                </div>
                                <div class="flex flex-col gap-0.5">
                                    <span class="text-[9px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">Desc</span>
                                    <span id="asideAcctDesc" class="text-xs font-bold text-red-600 tabular-nums whitespace-nowrap">—</span>
                                </div>
                                <div class="flex flex-col gap-0.5">
                                    <span class="text-[9px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">Ret</span>
                                    <span id="asideAcctRet" class="text-xs font-bold text-red-600 tabular-nums whitespace-nowrap">—</span>
                                </div>
                                <div class="flex flex-col gap-0.5">
                                    <span class="text-[9px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">Valor Previsto (base)</span>
                                    <span id="asideAcctBase" class="text-sm font-black text-slate-900 tabular-nums whitespace-nowrap">—</span>
                                </div>
                                <div class="flex flex-col gap-0.5">
                                    <span class="text-[9px] font-black uppercase tracking-widest text-emerald-700 whitespace-nowrap">Líquido a pagar</span>
                                    <span id="asideAcctNet" class="text-sm font-black text-[#212e3e] tabular-nums whitespace-nowrap">—</span>
                                </div>
                            </div>
                        </div>
                        <p id="asideAccountingNote" class="hidden text-[10px] text-slate-400 font-semibold">Não altera o valor base do orçamento.</p>
                    </div>
                </div>
            </div>

            <hr class="border-slate-100">

            <!-- Proforma / Documento -->
            <div class="flex flex-col gap-3 flex-1">
                <div class="flex items-center justify-between">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Documento / Proforma</p>
                </div>

                <div id="asideProformaContainer"
                    class="flex-1 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col items-center justify-center min-h-[250px] p-4 text-center overflow-hidden">
                    <span class="material-symbols-outlined text-4xl text-slate-300 mb-2">description</span>
                    <p class="text-xs font-semibold text-slate-500">Sem documento disponível.</p>
                </div>
            </div>

            <!-- Comprovativo -->
            <div id="asideComprovativoSection" class="flex flex-col gap-3 flex-1 hidden">
                <div class="flex items-center justify-between">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Comprovativo de Pagamento
                    </p>
                </div>

                <div id="asideComprovativoContainer"
                    class="flex-1 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col items-center justify-center min-h-[250px] p-4 text-center overflow-hidden">
                </div>
            </div>

            <!-- Fatura -->
            <div id="asideFaturaSection" class="flex flex-col gap-3 flex-1 hidden">
                <div class="flex items-center justify-between">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Fatura / Recibo</p>
                </div>

                <div id="asideFaturaContainer"
                    class="flex-1 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col items-center justify-center min-h-[250px] p-4 text-center overflow-hidden">
                </div>
            </div>
        </div>
        <div class="p-6 border-t border-slate-100 bg-white flex flex-col items-end gap-2">
            <p id="asideFinanceHint"
                class="hidden text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-3 py-2 rounded-lg">
                A liquidação deste lançamento é feita exclusivamente no Perfil Financeiro.
            </p>
            <button id="asideActionBtn" type="button" hidden
                class="hidden h-11 px-6 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2">
                <span class="material-symbols-outlined text-base">payments</span> Confirmar & Pagar
            </button>
        </div>
    </aside>

    <!-- Modal: Novo / Editar Lançamento -->
    <div class="modal-overlay" id="modalPay">
        <div class="modal-box" style="max-width:640px">
            <div class="flex items-center justify-between mb-6">
                <h2 id="modalPayTitle" class="text-lg font-bold text-slate-900">Novo Lançamento</h2>
                <button type="button" onclick="document.getElementById('modalPay').classList.remove('open')"
                    aria-label="Fechar"
                    class="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 transition-all">
                    <span class="material-symbols-outlined text-base">close</span>
                </button>
            </div>
            <form id="formPay" class="flex flex-col gap-4">
                <input type="hidden" id="payId">
                <input type="hidden" id="payCCId">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label for="payCC"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Centro de
                            Custo *</label>
                        <select id="payCC" required
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
                            <option value="">Selecionar...</option>
                        </select>
                    </div>
                    <div>
                        <label for="payDoc"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Nº
                            Documento</label>
                        <input id="payDoc" type="text" placeholder="FAT-001"
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label for="payDate"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Data
                            Pagamento *</label>
                        <input id="payDate" type="date" required
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
                    </div>
                    <div>
                        <label for="paySupplier"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Fornecedor</label>
                        <input id="paySupplier" type="text" list="paySupplierDatalist" autocomplete="off"
                            placeholder="Nome do fornecedor (opcional: selecionar registado)"
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
                        <datalist id="paySupplierDatalist"></datalist>
                        <input type="hidden" id="paySupplierId">
                        <p id="paySupplierHint" class="text-[11px] text-emerald-600 font-semibold mt-1 hidden">
                            <span class="material-symbols-outlined text-xs align-middle">verified</span>
                            Fornecedor registado associado
                        </p>
                    </div>
                </div>
                <div>
                    <label for="payDesc"
                        class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Descrição
                        *</label>
                    <input id="payDesc" type="text" required placeholder="Motivo do pagamento"
                        class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
                </div>
                <div class="grid grid-cols-3 gap-4">
                    <div>
                        <label for="payCat"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Categoria</label>
                        <select id="payCat"
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
                            <option value="MATERIAL">Material</option>
                            <option value="SERVICO">Serviço</option>
                            <option value="MAO_DE_OBRA">Mão de Obra</option>
                            <option value="EQUIPAMENTO">Equipamento</option>
                            <option value="TRANSPORTE">Transporte</option>
                            <option value="ADMINISTRATIVO">Administrativo</option>
                            <option value="OUTRO">Outro</option>
                        </select>
                    </div>
                    <div>
                        <label for="payType"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Tipo de
                            Pagamento</label>
                        <select id="payType"
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
                            <option value="PRONTO_PAGAMENTO">PP</option>
                            <option value="CREDITO">C</option>
                        </select>
                    </div>
                    <div>
                        <label for="payBudgeted"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Valor
                            Previsto *</label>
                        <input id="payBudgeted" type="number" step="0.01" min="0" required placeholder="0.00"
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
                    </div>
                    <div>
                        <label for="payPaid"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Valor Pago
                            *</label>
                        <input id="payPaid" type="number" step="0.01" min="0" required placeholder="0.00"
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-4">
                    <div>
                        <label for="payMethod"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Forma de
                            Pagamento</label>
                        <select id="payMethod"
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
                            <option value="">—</option>
                            <option value="Caixa">Caixa</option>
                            <option value="Banco">Banco</option>
                            <option value="Transferência">Transferência</option>
                            <option value="Cheque">Cheque</option>
                            <option value="Multicaixa">Multicaixa</option>
                        </select>
                    </div>
                    <div>
                        <label for="payWeek"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Semana</label>
                        <select id="payWeek"
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
                            <option value="">—</option>
                            <option value="SEM 0">SEM 0</option>
                            <option value="SEM 1">SEM 1</option>
                            <option value="SEM 2">SEM 2</option>
                            <option value="SEM 3">SEM 3</option>
                            <option value="SEM 4">SEM 4</option>
                            <option value="SEM 5">SEM 5</option>
                            <option value="SEM 6">SEM 6</option>
                            <option value="SEM 7">SEM 7</option>
                            <option value="SEM 8">SEM 8</option>
                            <option value="SEM 9">SEM 9</option>
                            <option value="SEM 10">SEM 10</option>
                            <option value="SEM 11">SEM 11</option>
                            <option value="SEM 12">SEM 12</option>
                            <option value="SEM 13">SEM 13</option>
                            <option value="SEM 14">SEM 14</option>
                            <option value="SEM 15">SEM 15</option>
                            <option value="SEM 16">SEM 16</option>
                            <option value="SEM 17">SEM 17</option>
                            <option value="SEM 18">SEM 18</option>
                            <option value="SEM 19">SEM 19</option>
                            <option value="SEM 20">SEM 20</option>
                            <option value="SEM 21">SEM 21</option>
                            <option value="SEM 22">SEM 22</option>
                            <option value="SEM 23">SEM 23</option>
                            <option value="SEM 24">SEM 24</option>
                            <option value="SEM 25">SEM 25</option>
                        </select>
                    </div>
                    <div>
                        <label for="payStatus"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Status</label>
                        <select id="payStatus"
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none">
                            <option value="PENDENTE">Pendente</option>
                            <option value="CONFIRMADO">Confirmado</option>
                            <option value="CANCELADO">Cancelado</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label for="payNotes"
                        class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Observações</label>
                    <textarea id="payNotes" rows="2" placeholder="Notas adicionais..."
                        class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none resize-none"></textarea>
                </div>
                <div class="flex gap-3 justify-end pt-2">
                    <button type="button" onclick="document.getElementById('modalPay').classList.remove('open')"
                        class="h-10 px-5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-all">Cancelar</button>
                    <button type="submit"
                        class="h-10 px-6 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-all">Guardar</button>
                </div>
            </form>
        </div>
    </div>


    <!-- Modal: Liquidar Lançamento -->
    <div class="modal-overlay" id="modalLiq">
        <div class="modal-box">
            <div class="flex items-center justify-between mb-6">
                <div>
                    <h2 id="liqModalTitle" class="text-xl font-bold text-slate-900 tracking-tight">Liquidar Lançamento
                    </h2>
                    <p id="liqModalSubtitle" class="text-xs font-semibold text-slate-400 mt-0.5">Confirma o valor final
                        pago</p>
                </div>
                <button type="button" onclick="document.getElementById('modalLiq').classList.remove('open')"
                    aria-label="Fechar"
                    class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
                    <span class="material-symbols-outlined text-lg">close</span>
                </button>
            </div>
            <form id="formLiq" class="flex flex-col gap-5">
                <input type="hidden" id="liqTxId" />

                <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Descrição do
                        Lançamento</p>
                    <p id="liqDesc" class="text-sm font-bold text-slate-900"></p>
                </div>

                <div>
                    <label class="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Valor
                        Comprometido (base orçamental)</label>
                    <input type="text" id="liqCommitted" disabled
                        class="w-full px-4 h-12 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 cursor-not-allowed" />
                </div>

                <div>
                    <label for="liqAmount"
                        class="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Valor líquido
                        pago *</label>
                    <input id="liqAmount" type="number" min="0" step="0.01" required
                        class="w-full px-4 h-12 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#2afc8d]/40 focus:bg-white transition-all" />
                    <p class="text-[10px] text-slate-400 mt-1.5 font-semibold">Os impostos já estão no orçamento. Ajuste
                        apenas se o valor pago for diferente.</p>
                </div>

                <div>
                    <label for="liqConfirmedDate"
                        class="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Data da liquidação
                        *</label>
                    <input id="liqConfirmedDate" type="date" required
                        class="w-full px-4 h-12 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#2afc8d]/40 focus:bg-white transition-all" />
                    <p class="text-[10px] text-slate-400 mt-1.5 font-semibold">Registe quando o pagamento foi efectivamente
                        realizado.</p>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label for="liqComprovativo" id="liqComprovativoLabel"
                            class="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Comprovativo*</label>
                        <input id="liqComprovativo" type="file" accept="image/*,.pdf" required
                            class="w-full h-11 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-600 focus:outline-none file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-[#212e3e] file:text-white hover:file:bg-slate-800 transition-all cursor-pointer" />
                        <p id="liqComprovativoHint" class="text-[10px] text-slate-400 mt-1.5 font-semibold hidden">Já
                            existe um
                            comprovativo anexado. Só precisas de escolher um ficheiro se quiseres substituí-lo.</p>
                    </div>
                    <div>
                        <label for="liqFatura" id="liqFaturaLabel"
                            class="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Fatura /
                            Recibo (Opcional)</label>
                        <input id="liqFatura" type="file" accept="image/*,.pdf"
                            class="w-full h-11 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-600 focus:outline-none file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-slate-200 file:text-slate-700 hover:file:bg-slate-300 transition-all cursor-pointer" />
                    </div>
                </div>

                <div id="liqRecipientsSection">
                    <label class="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Notificar /
                        Enviar comprovativo a</label>
                    <div id="liqRecipientsList"
                        class="max-h-40 overflow-y-auto flex flex-col gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                        <p class="text-xs text-slate-400 text-center py-3">A carregar utilizadores...</p>
                    </div>
                    <p class="text-[10px] text-slate-400 mt-1.5 font-semibold">Selecionados recebem notificação
                        in-app imediata com o comprovativo. WhatsApp só quando o serviço estiver configurado no
                        servidor.</p>
                </div>

                <div class="flex items-center justify-end gap-3 mt-4">
                    <button type="button" onclick="document.getElementById('modalLiq').classList.remove('open')"
                        class="h-10 px-5 rounded-xl font-bold text-xs text-slate-500 hover:bg-slate-100 transition-all">Cancelar</button>
                    <button type="submit" id="liqSubmitBtn"
                        class="h-10 px-5 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 transition-all shadow-md shadow-emerald-600/20">Confirmar
                        Liquidação</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Toast -->
    <div id="toast" class="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none"></div>
`;

let mounted = false;
export function mountPayments(pendingEl, historyEl) {
  if (mounted || !pendingEl || !historyEl) return;
  mounted = true;
  pendingEl.innerHTML = PENDING_HTML;
  historyEl.innerHTML = HISTORY_HTML;
  document.body.insertAdjacentHTML("beforeend", MODALS_HTML);

  document.getElementById("txCategoryFilter")?.addEventListener("change", () => { txPage = 1; loadTransactions(); });
  document.getElementById("historyCategoryFilter")?.addEventListener("change", () => { historyPage = 1; loadHistory(); });
  document.getElementById("paySupplier")?.addEventListener("input", resolvePaySupplierFromText);
  document.getElementById("formPay")?.addEventListener("submit", submitPay);
  document.getElementById("formLiq")?.addEventListener("submit", submitLiquidation);
  ["modalPay", "modalLiq"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
    });
  });
}

export function showPendingPayments() { currentTxStatus = "PENDING"; txPage = 1; return loadTransactions(); }
export function showPaymentHistory() { historyPage = 1; return loadHistory(); }

function renderPaymentRowHtml(p, { showProject = false, allowEdit = false } = {}) {
  const statusClasses = { PENDENTE: "badge-pendente", CONFIRMADO: "badge-confirmado", CANCELADO: "badge-cancelado" };
  const statusLabels = { PENDENTE: "Pendente", CONFIRMADO: "Liquidado", CANCELADO: "Cancelado" };
  const typeLabels = { PRONTO_PAGAMENTO: "PP", CREDITO: "C" };
  const typeClasses = {
    PRONTO_PAGAMENTO: "bg-red-50 text-red-700 border border-red-200",
    CREDITO: "bg-sky-50 text-sky-700 border border-sky-100",
  };
  const cur = p.costCenter?.currency || "AOA";
  const payload = JSON.stringify(p).replace(/'/g, "&#39;");
  const projectCell = showProject
    ? `<td class="text-xs font-bold text-slate-700 max-w-[120px] truncate" title="${p.project?.name || ""}">${p.project?.name || "—"}</td>`
    : "";

  const editActions = allowEdit ? `
          <button onclick="event.stopPropagation(); editPay(${JSON.stringify(p).replace(/"/g, "&quot;")})" title="Editar lançamento"
            class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-emerald-100 hover:text-emerald-600 transition-all text-slate-500">
            <span class="material-symbols-outlined text-base">edit</span>
          </button>
          <button onclick="event.stopPropagation(); deletePay('${p.id}', '${p.costCenterId}')" title="Eliminar lançamento"
            class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-all text-slate-500">
            <span class="material-symbols-outlined text-base">delete</span>
          </button>` : `
          <button onclick="event.stopPropagation(); openPaymentAsideHandler(this)" data-payload='${payload}' data-type="VIEW" title="Ver detalhes"
            class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-[#2afc8d] hover:text-slate-900 transition-all text-slate-500">
            <span class="material-symbols-outlined text-base">visibility</span>
          </button>`;

  return `
    <tr class="cursor-pointer hover:bg-slate-50 transition-colors" onclick="openPaymentAsideHandler(this)" data-payload='${payload}' data-type="VIEW">
      <td class="text-xs font-bold text-slate-500">${p.docNumber || "—"}</td>
      <td class="text-xs text-slate-500">${formatDateBR(p.paymentDate)}</td>
      ${projectCell}
      <td class="text-sm font-medium text-slate-700 max-w-[120px] truncate">${p.supplier || "—"}</td>
      <td><span class="text-xs font-bold text-blue-600">${p.costCenter?.code || "—"}</span></td>
      <td class="text-sm font-medium text-slate-900 max-w-xs truncate">${p.description}</td>
      <td><span class="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${typeClasses[p.paymentType] || "bg-slate-100 text-slate-500 border border-slate-200"}">${typeLabels[p.paymentType] || "—"}</span></td>
      <td class="text-right tabular-nums text-sm font-medium text-slate-600">${formatCurrency(p.budgetedAmount, cur)}</td>
      <td class="text-right tabular-nums text-sm font-bold ${Number(p.paidAmount) > Number(p.netAmount ?? p.budgetedAmount) ? "text-red-600" : "text-slate-900"}">${formatCurrency(p.paidAmount || paymentPayableAmount(p), cur)}</td>
      <td class="text-center text-xs font-bold text-slate-500">${p.week || "—"}</td>
      <td class="text-center"><span class="text-xs font-bold px-2.5 py-1 rounded-full ${statusClasses[p.status] || "badge-pendente"}">${statusLabels[p.status] || p.status}</span></td>
      <td class="text-center">
        <div class="flex justify-center gap-2">
          ${editActions}
        </div>
      </td>
    </tr>`;
}

async function ensureSuppliersLoadedForPay() {
  if (!currentSuppliers.length) {
    try {
      const data = await apiRequest("/suppliers");
      currentSuppliers = data.items || [];
    } catch (err) {
      console.error("Erro ao carregar fornecedores:", err);
    }
  }
  const datalist = document.getElementById("paySupplierDatalist");
  if (datalist) {
    datalist.innerHTML = currentSuppliers
      .map((s) => `<option value="${(s.name || "").replace(/"/g, "&quot;")}"></option>`)
      .join("");
  }
}

function resolvePaySupplierFromText() {
  const input = document.getElementById("paySupplier");
  const hiddenId = document.getElementById("paySupplierId");
  const hint = document.getElementById("paySupplierHint");
  const name = (input?.value || "").trim().toLowerCase();
  const match = name ? currentSuppliers.find((s) => (s.name || "").trim().toLowerCase() === name) : null;
  if (hiddenId) hiddenId.value = match ? match.id : "";
  if (hint) hint.classList.toggle("hidden", !match);
}

async function openPayModal(pay = null) {
  document.getElementById("modalPayTitle").textContent = pay ? "Editar Lançamento" : "Novo Lançamento";
  document.getElementById("payId").value = pay?.id || "";
  document.getElementById("payCCId").value = pay?.costCenterId || "";
  document.getElementById("payCC").value = pay?.costCenterId || "";
  document.getElementById("payDoc").value = pay?.docNumber || "";
  document.getElementById("payDate").value = pay?.paymentDate ? pay.paymentDate.substring(0, 10) : new Date().toISOString().substring(0, 10);
  document.getElementById("paySupplier").value = pay?.supplierName || pay?.supplier || "";
  document.getElementById("paySupplierId").value = pay?.supplierId || "";
  document.getElementById("payDesc").value = pay?.description || "";
  document.getElementById("payCat").value = pay?.category || "MATERIAL";
  document.getElementById("payType").value = pay?.paymentType || "PRONTO_PAGAMENTO";
  document.getElementById("payBudgeted").value = pay?.budgetedAmount || "";
  document.getElementById("payPaid").value = pay?.paidAmount || "";
  document.getElementById("payMethod").value = pay?.paymentMethod || "";
  document.getElementById("payWeek").value = pay?.week || "";
  document.getElementById("payStatus").value = pay?.status || "PENDENTE";
  document.getElementById("payNotes").value = pay?.notes || "";
  document.getElementById("modalPay").classList.add("open");

  await ensureSuppliersLoadedForPay();
  resolvePaySupplierFromText();
}

window.editPay = function (pay) {
  if (typeof pay === "string") pay = JSON.parse(pay);
  openPayModal(pay);
};

window.deletePay = async function (id, ccId) {
  if (!confirm("Eliminar este lançamento?")) return;
  try {
    let costCenterId = ccId;
    if (!costCenterId && ctx().getProject()) {
      const pay = await apiRequest(`/cost-centers/project/${ctx().getProject().id}/payments`).then(
        (d) => d.items?.find((p) => p.id === id)
      );
      costCenterId = pay?.costCenterId;
    }
    if (!costCenterId) {
      ctx().showToast("Não foi possível identificar o centro de custo", "error");
      return;
    }
    await apiRequest(`/cost-centers/${costCenterId}/payments/${id}`, { method: "DELETE" });
    ctx().showToast("Lançamento eliminado", "success");
    reloadPaymentsView();
  } catch (err) {
    ctx().showToast("Erro: " + err.message, "error");
  }
};

window.payCostPayment = async function (pay) {
  if (typeof pay === "string") pay = JSON.parse(pay);
  const paidAmount = Number(pay.paidAmount) > 0 ? Number(pay.paidAmount) : Number(pay.budgetedAmount) || 0;

  if (!confirm(`Confirmar pagamento de ${formatCurrency(paidAmount, pay.costCenter?.currency || "AOA")}?`)) return;

  try {
    await apiRequest(`/cost-centers/${pay.costCenterId}/payments/${pay.id}`, {
      method: "PATCH",
      body: {
        paidAmount,
        status: "CONFIRMADO",
      },
    });
    ctx().showToast("Lançamento pago com sucesso", "success");
    reloadPaymentsView();
  } catch (err) {
    ctx().showToast("Erro ao pagar: " + err.message, "error");
  }
};

async function submitPay(e) {
  e.preventDefault();
  const id = document.getElementById("payId").value;
  const ccId = document.getElementById("payCC").value;
  if (!ccId) { ctx().showToast("Seleciona um Centro de Custo", "error"); return; }

  const payDateVal = document.getElementById("payDate").value;
  const body = {
    docNumber: document.getElementById("payDoc").value.trim() || null,
    paymentDate: payDateVal ? new Date(payDateVal).toISOString() : new Date().toISOString(),
    supplier: document.getElementById("paySupplier").value.trim() || null,
    supplierId: document.getElementById("paySupplierId").value || null,
    description: document.getElementById("payDesc").value.trim(),
    category: document.getElementById("payCat").value,
    paymentType: document.getElementById("payType").value,
    budgetedAmount: parseFloat(document.getElementById("payBudgeted").value) || 0,
    paidAmount: parseFloat(document.getElementById("payPaid").value) || 0,
    paymentMethod: document.getElementById("payMethod").value || null,
    week: document.getElementById("payWeek").value || null,
    status: document.getElementById("payStatus").value,
    notes: document.getElementById("payNotes").value.trim() || null,
  };

  try {
    if (id) {
      await apiRequest(`/cost-centers/${ccId}/payments/${id}`, { method: "PATCH", body });
      ctx().showToast("Lançamento actualizado", "success");
    } else {
      await apiRequest(`/cost-centers/${ccId}/payments`, { method: "POST", body });
      ctx().showToast("Lançamento criado", "success");
    }
    document.getElementById("modalPay").classList.remove("open");
    reloadPaymentsView();
  } catch (err) {
    ctx().showToast("Erro: " + err.message, "error");
  }
}

// ── Toast ──────────────────────────────────────────────────────────────────────

let txPage = 1;
let historyPage = 1;
const TX_PAGE_SIZE = 20;

function openPaymentAsideHandler(el) {
  const data = JSON.parse(el.getAttribute('data-payload'));
  const type = el.getAttribute('data-type');
  openPaymentAside(data, type);
}

async function loadTransactions() {
  if (!ctx().getProject()) return;
  const tbody = document.getElementById("txTableBody");
  if (!tbody) return;

  const statusFilter = currentTxStatus === "PENDING" ? "PENDENTE" : "CONFIRMADO";
  const catFilter = document.getElementById("txCategoryFilter").value;

  tbody.innerHTML = `<tr><td colspan="8"><div class="spinner my-8"></div></td></tr>`;

  try {
    const data = await apiRequest(
      `/cost-centers/project/${ctx().getProject().id}/payments?page=${txPage}&pageSize=${TX_PAGE_SIZE}&status=${statusFilter}`
    );

    // Update KPIs using the fetched data (if pagination is an issue, we should fetch all for KPI)
    updateTxKPIs(data.items);

    if (data.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-400 text-sm">Nenhum lançamento encontrado.</td></tr>`;
      document.getElementById("txPagination").innerHTML = "";
      return;
    }

    const catNames = {
      MATERIALS: "Materiais",
      LABOR: "Mão de Obra",
      EQUIPMENT: "Equipamentos",
      MATERIAIS_INSUMOS: "Materiais/Insumos",
      SERVICOS_MAO_DE_OBRA: "Serviços/Mão Obra",
      GASTOS_PESSOAL: "Gastos Pessoal",
      DESPESAS_OPERACIONAIS: "Desp. Operacionais",
      INVESTIMENTOS: "Investimentos",
      OTHER: "Outro"
    };

    tbody.innerHTML = data.items.map((t) => {
      const isPaid = t.status === "CONFIRMADO";
      const statusClass = isPaid ? "badge-approved" : (t.status === "CANCELADO" ? "badge-rejected" : "badge-pendente");
      const statusText = isPaid ? "Liquidado" : (t.status === "CANCELADO" ? "Cancelado" : "Pendente");

      // Use html encoded description safely
      const descStr = t.description ? t.description.replace(/'/g, "\\'").replace(/"/g, "&quot;") : "";
      const isAPrazo = t.paymentType === "CREDITO";
      const paymentTypeStr = isAPrazo ? "C" : "PP";
      const paymentTypeClass = isAPrazo
        ? "bg-sky-50 text-sky-700 border border-sky-100"
        : "bg-red-50 text-red-700 border border-red-200";
      const paymentTypeBadge = `<span class="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${paymentTypeClass}">${paymentTypeStr}</span>`;

      return `
        <tr class="cursor-pointer hover:bg-slate-50/50 transition-colors" onclick="openPaymentAsideHandler(this)" data-payload='${JSON.stringify(t).replace(/'/g, "&#39;")}' data-type="VIEW">
          <td class="text-xs text-slate-500">${new Date(t.paymentDate).toLocaleDateString("pt-PT")}</td>
          <td class="font-bold text-slate-700 max-w-[200px] truncate" title="${descStr}">${t.description}</td>
          <td class="text-xs text-slate-500">${t.supplier || "-"}</td>
          <!--<td class="text-xs text-slate-500">${catNames[t.category] || t.category || "-"}</td>-->
          <td>${paymentTypeBadge}</td>
          <td class="text-xs text-slate-500">${t.costCenter?.name || "Geral"}</td>
          <td class="text-right font-black text-slate-900">${formatCurrency(t.budgetedAmount, t.costCenter?.currency || "AOA")}</td>
          <td class="text-right font-black ${isPaid ? 'text-emerald-600' : 'text-slate-400'}">${isPaid ? formatCurrency(t.paidAmount, t.costCenter?.currency || "AOA") : "-"}</td>
          <td class="text-center">
            <span class="inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusClass}">
              ${statusText}
            </span>
          </td>
          <td class="text-center">
            <div class="flex items-center justify-center gap-2">
              <button onclick="event.stopPropagation(); openPaymentAsideHandler(this)" data-payload='${JSON.stringify(t).replace(/'/g, "&#39;")}' data-type="VIEW" title="Ver detalhes" class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-[#2afc8d] hover:text-slate-900 transition-all text-slate-500">
                <span class="material-symbols-outlined text-base">visibility</span>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    const totalPages = Math.ceil(data.total / data.pageSize);
    document.getElementById("txPagination").innerHTML = `
      <span>Página ${data.page} de ${totalPages} (${data.total} itens)</span>
      <div class="flex gap-2">
        <button onclick="txPage=Math.max(1, txPage-1); loadTransactions()" class="px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 ${data.page === 1 ? 'opacity-50 pointer-events-none' : ''}">Anterior</button>
        <button onclick="txPage=Math.min(${totalPages}, txPage+1); loadTransactions()" class="px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 ${data.page === totalPages ? 'opacity-50 pointer-events-none' : ''}">Próxima</button>
      </div>
    `;

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-red-400 text-sm">Erro ao carregar lançamentos pendentes.</td></tr>`;
  }
}

// ── Histórico de Liquidações ───────────────────────────────────────────────────
async function loadHistory() {
  if (!ctx().getProject()) return;
  const tbody = document.getElementById("historyTableBody");
  if (!tbody) return;

  const catFilter = document.getElementById("historyCategoryFilter")?.value || "";
  tbody.innerHTML = `<tr><td colspan="10"><div class="spinner my-8"></div></td></tr>`;

  try {
    const data = await apiRequest(
      `/cost-centers/project/${ctx().getProject().id}/payments?page=${historyPage}&pageSize=${TX_PAGE_SIZE}&status=CONFIRMADO&category=${catFilter}`
    );

    if (data.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><span class="material-symbols-outlined text-3xl">history</span><p class="text-sm font-semibold">Sem histórico de liquidações</p></div></td></tr>`;
      document.getElementById("historyPagination").innerHTML = "";
      return;
    }

    const catNames = {
      MATERIAL: "Material", SERVICO: "Serviço", MAO_DE_OBRA: "Mão de Obra",
      EQUIPAMENTO: "Equipamentos", TRANSPORTE: "Transporte", ADMINISTRATIVO: "Administrativo", OUTRO: "Outro"
    };

    tbody.innerHTML = data.items.map((t) => {
      const isAPrazo = t.paymentType === "CREDITO";
      const paymentTypeBadge = `<span class="inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isAPrazo ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}">${isAPrazo ? 'C' : 'PP'}</span>`;
      return `
        <tr class="cursor-pointer hover:bg-slate-50/50 transition-colors" onclick="openPaymentAsideHandler(this)" data-payload='${JSON.stringify(t).replace(/'/g, "&#39;")}' data-type="VIEW">
          <td class="text-xs text-slate-500">${new Date(t.paymentDate).toLocaleDateString("pt-PT")}</td>
          <td class="font-bold text-slate-700">${t.description}</td>
          <td class="text-xs text-slate-500">${t.supplier || "-"}</td>
          <td class="text-xs text-slate-500">${catNames[t.category] || t.category || "-"}</td>
          <td class="text-xs text-slate-500">${paymentTypeBadge}</td>
          <td class="text-xs text-slate-500">${t.costCenter?.name || "Geral"}</td>
          <td class="text-right font-black text-slate-900">${formatCurrency(t.budgetedAmount, t.costCenter?.currency || "AOA")}</td>
          <td class="text-right font-black text-emerald-600">${formatCurrency(t.paidAmount || t.budgetedAmount, t.costCenter?.currency || "AOA")}</td>
          <td class="text-center">
            <span class="inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold uppercase badge-approved">Liquidado</span>
          </td>
          <td class="text-center"><span class="text-xs text-slate-300">—</span></td>
        </tr>`;
    }).join("");

    const totalPages = Math.ceil(data.total / data.pageSize);
    document.getElementById("historyPagination").innerHTML = `
      <span>Página ${data.page} de ${totalPages} (${data.total} itens)</span>
      <div class="flex gap-2">
        <button onclick="historyPage=Math.max(1,historyPage-1);loadHistory()" class="px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 ${data.page === 1 ? 'opacity-50 pointer-events-none' : ''}">Anterior</button>
        <button onclick="historyPage=Math.min(${totalPages},historyPage+1);loadHistory()" class="px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 ${data.page === totalPages ? 'opacity-50 pointer-events-none' : ''}">Próxima</button>
      </div>`;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-red-400 text-sm">Erro ao carregar histórico.</td></tr>`;
  }
}

function updateTxKPIs(items) {
  let pending = 0;
  let committed = 0;
  let paid = 0;

  items.forEach(t => {
    if (t.status === "PENDENTE") {
      pending++;
      committed += Number(t.budgetedAmount);
    } else if (t.status === "CONFIRMADO") {
      paid += Number(t.paidAmount || t.budgetedAmount);
    }
  });

  const currency = items[0]?.costCenter?.currency || "AOA";

  document.getElementById("kpiTxPending").textContent = pending;
  document.getElementById("kpiTxCommitted").textContent = formatCurrency(committed, currency);
  document.getElementById("kpiTxPaid").textContent = formatCurrency(paid, currency);

}

// Indica se a liquidação em curso já tinha sido confirmada anteriormente
// (reabertura do formulário apenas para anexar a fatura/substituir ficheiros).
let liqAlreadyConfirmed = false;

let _notificationRecipientsCache = null;
async function fetchNotificationRecipients() {
  if (_notificationRecipientsCache) return _notificationRecipientsCache;
  try {
    const data = await apiRequest("/users/notification-recipients");
    _notificationRecipientsCache = data.items || [];
  } catch {
    _notificationRecipientsCache = [];
  }
  return _notificationRecipientsCache;
}

async function renderLiqRecipients(preSelectedIds) {
  const list = document.getElementById("liqRecipientsList");
  if (!list) return;
  list.innerHTML = `<p class="text-xs text-slate-400 text-center py-3">A carregar utilizadores...</p>`;

  const users = await fetchNotificationRecipients();
  if (!users.length) {
    list.innerHTML = `<p class="text-xs text-slate-400 text-center py-3">Sem utilizadores disponíveis.</p>`;
    return;
  }

  const preSelected = new Set(preSelectedIds && preSelectedIds.length
    ? preSelectedIds
    : users.filter(u => u.isFinancialReceiver).map(u => u.id));

  list.innerHTML = users.map(u => {
    const checked = preSelected.has(u.id) ? "checked" : "";
    const label = u.name || u.email || "Utilizador";
    const badge = u.isFinancialReceiver
      ? `<span class="text-[9px] font-black uppercase tracking-wide text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">Receptor</span>`
      : "";
    return `
      <label class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white cursor-pointer transition-colors">
        <input type="checkbox" class="liq-recipient-checkbox w-4 h-4 rounded accent-emerald-600" value="${u.id}" ${checked} />
        <span class="text-xs font-semibold text-slate-700 flex-1 truncate">${label}</span>
        ${badge}
      </label>`;
  }).join("");
}

function getSelectedLiqRecipientIds() {
  return Array.from(document.querySelectorAll(".liq-recipient-checkbox:checked")).map(el => el.value);
}

window.openLiquidateModal = function (payment) {
  // Retrocompatibilidade: aceita também a assinatura antiga (txId, description, amount, ccId).
  const data = (payment && typeof payment === "object")
    ? payment
    : { id: arguments[0], description: arguments[1], budgetedAmount: arguments[2], costCenterId: arguments[3] };

  const amount = data.paidAmount ?? data.budgetedAmount ?? data.amount ?? 0;
  liqAlreadyConfirmed = data.status === "CONFIRMADO" || data.status === "PAID";

  document.getElementById("liqTxId").value = data.id;
  document.getElementById("liqDesc").textContent = data.description || "";
  document.getElementById("liqCommitted").value = formatCurrency(data.budgetedAmount ?? amount, "AOA");
  document.getElementById("liqAmount").value = paymentPayableAmount(data) || amount;

  // Create or update a hidden field for ccId
  let ccInput = document.getElementById("liqCcId");
  if (!ccInput) {
    ccInput = document.createElement("input");
    ccInput.type = "hidden";
    ccInput.id = "liqCcId";
    document.getElementById("formLiq").appendChild(ccInput);
  }
  ccInput.value = data.costCenterId;

  const liqConfirmedDate = document.getElementById("liqConfirmedDate");
  if (liqConfirmedDate) {
    liqConfirmedDate.value = toDateKey(data.confirmedAt) || toDateKey(new Date());
  }

  const compInput = document.getElementById("liqComprovativo");
  const compLabel = document.getElementById("liqComprovativoLabel");
  const compHint = document.getElementById("liqComprovativoHint");
  const title = document.getElementById("liqModalTitle");
  const subtitle = document.getElementById("liqModalSubtitle");
  const submitBtn = document.getElementById("liqSubmitBtn");

  if (compInput) compInput.value = "";
  const fatInput = document.getElementById("liqFatura");
  if (fatInput) fatInput.value = "";

  const recipientsSection = document.getElementById("liqRecipientsSection");

  if (liqAlreadyConfirmed) {
    // Já foi liquidado (comprovativo já existe). Reabertura serve tipicamente
    // para anexar/substituir a fatura final — não obriga a re-enviar o comprovativo
    // nem repete o envio de notificações (já disparadas na liquidação inicial).
    compInput?.removeAttribute("required");
    if (compLabel) compLabel.textContent = "Comprovativo (substituir, opcional)";
    compHint?.classList.remove("hidden");
    if (title) title.textContent = data.faturaUrl ? "Editar Liquidação" : "Anexar Fatura";
    if (subtitle) subtitle.textContent = data.faturaUrl
      ? "Atualiza documentos da liquidação"
      : "Ainda não há fatura final — podes anexá-la agora";
    if (submitBtn) submitBtn.textContent = "Guardar";
    recipientsSection?.classList.add("hidden");
    const recipientsList = document.getElementById("liqRecipientsList");
    if (recipientsList) recipientsList.innerHTML = "";
  } else {
    compInput?.setAttribute("required", "required");
    if (compLabel) compLabel.textContent = "Comprovativo*";
    compHint?.classList.add("hidden");
    if (title) title.textContent = "Liquidar Lançamento";
    if (subtitle) subtitle.textContent = "Confirma o valor final pago";
    if (submitBtn) submitBtn.textContent = "Confirmar Liquidação";
    recipientsSection?.classList.remove("hidden");
    renderLiqRecipients(data.notifiedRecipientIds);
  }

  document.getElementById("modalLiq").classList.add("open");
};

async function submitLiquidation(e) {
  e.preventDefault();
  const txId = document.getElementById("liqTxId").value;
  const ccId = document.getElementById("liqCcId").value;
  const realizedAmount = document.getElementById("liqAmount").value;

  if (!realizedAmount) return ctx().showToast("Valor é obrigatório", "error");

  const confirmedDate = document.getElementById("liqConfirmedDate")?.value?.trim();
  if (!confirmedDate) return ctx().showToast("Data da liquidação é obrigatória", "error");

  const compInput = document.getElementById("liqComprovativo");
  if (!liqAlreadyConfirmed && (!compInput || !compInput.files[0])) {
    return ctx().showToast("Comprovativo de pagamento é obrigatório", "error");
  }

  const fd = new FormData();
  fd.append("paidAmount", realizedAmount);
  fd.append("confirmedAt", dateInputToUtcNoonIso(confirmedDate));
  if (!liqAlreadyConfirmed) fd.append("status", "CONFIRMADO");
  if (compInput && compInput.files[0]) fd.append("comprovativo", compInput.files[0]);

  const fatInput = document.getElementById("liqFatura");
  if (fatInput && fatInput.files[0]) {
    fd.append("fatura", fatInput.files[0]);
  }

  const recipientIds = getSelectedLiqRecipientIds();
  if (recipientIds.length) fd.append("recipientIds", JSON.stringify(recipientIds));

  try {
    const btn = e.target.querySelector("button[type='submit']");
    const oldText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner w-4 h-4 mr-2 inline-block align-middle border-white"></span> A guardar...`;
    btn.disabled = true;

    const result = await apiUpload(`/cost-centers/${ccId}/payments/${txId}`, fd, "PATCH");

    btn.innerHTML = oldText;
    btn.disabled = false;

    const sent = Number(result?.notificationsSent ?? 0);
    let toastMsg = liqAlreadyConfirmed ? "Lançamento atualizado com sucesso!" : "Lançamento liquidado com sucesso!";
    if (!liqAlreadyConfirmed && recipientIds.length) {
      toastMsg += sent
        ? ` Notificação enviada a ${sent} destinatário(s) (in-app).`
        : " Nenhuma notificação foi entregue — confirma que o backend foi reiniciado e que estás com sessão aberta.";
    }
    ctx().showToast(toastMsg, sent || liqAlreadyConfirmed ? "success" : "info");
    document.getElementById("modalLiq").classList.remove("open");

    // Reset inputs
    compInput.value = "";
    if (fatInput) fatInput.value = "";

    if (ctx().getProject()) {
      loadTransactions();
      ctx().onChanged?.();
    } else reloadPaymentsView();
  } catch (err) {
    const btn = e.target.querySelector("button[type='submit']");
    btn.innerHTML = liqAlreadyConfirmed ? "Guardar" : "Confirmar Liquidação";
    btn.disabled = false;
    ctx().showToast("Erro: " + err.message, "error");
  }
}


// ── Payment Aside Logic ────────────────────────────────────────────────────────
window.openPaymentAsideHandler = function (btn) {
  try {
    const payload = JSON.parse(btn.getAttribute("data-payload"));
    const type = btn.getAttribute("data-type");
    openPaymentAside(payload, type);
  } catch (err) {
    console.error("Erro ao abrir aside de pagamento:", err);
  }
};

window.openPaymentAside = function (data, type) {
  const aside = document.getElementById("paymentAside");
  const overlay = document.getElementById("paymentAsideOverlay");

  const badge = document.getElementById("asideStatusBadge");
  if (badge) {
    badge.classList.remove("hidden", "bg-emerald-100", "text-emerald-700", "bg-amber-100", "text-amber-700", "bg-red-100", "text-red-700");
    if (data.status === "CONFIRMADO" || data.status === "PAID") {
      badge.textContent = "Liquidado";
      badge.classList.add("bg-emerald-100", "text-emerald-700");
    } else if (data.status === "CANCELADO") {
      badge.textContent = "Cancelado";
      badge.classList.add("bg-red-100", "text-red-700");
    } else {
      badge.textContent = "Pendente";
      badge.classList.add("bg-amber-100", "text-amber-700");
    }
  }

  document.getElementById("asideDesc").textContent = data.description || "—";
  renderAsideProductSection(data);
  document.getElementById("asideDate").textContent = data.paymentDate ? formatDateBR(data.paymentDate) : (data.date ? formatDateBR(data.date) : "—");
  document.getElementById("asideSupplier").textContent = data.supplier || "—";
  document.getElementById("asideCategory").textContent = data.category || "—";

  document.getElementById("asideNIF").textContent = data.supplierNif || data.nif || "—";
  document.getElementById("asideIBAN").textContent = data.supplierIban || data.iban || "—";

  const supplierDetails = document.getElementById("asideSupplierDetails");
  supplierDetails.classList.remove("hidden");

  renderAsideAccountingLine(data);

  function renderAsideDocument(url, title = "Documento") {
    if (!url) {
      return `
        <div class="py-8 text-center text-slate-300">
          <span class="material-symbols-outlined text-4xl mb-2">description</span>
          <p class="text-xs font-semibold text-slate-500">Sem ${title.toLowerCase()} disponível.</p>
        </div>
      `;
    }
    const isImage = url.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i);
    if (isImage) {
      return `
        <div class="relative w-full h-full flex flex-col items-center justify-center">
          <img src="${getAssetUrl(url)}" alt="${title}" class="w-full h-auto object-contain max-h-full rounded-lg shadow-sm border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity" onclick="window.open('${getAssetUrl(url)}','_blank')">
          <button type="button" onclick="window.open('${getAssetUrl(url)}','_blank')" class="absolute top-2 right-2 w-8 h-8 bg-white/80 backdrop-blur-md border border-slate-200 rounded-lg flex items-center justify-center text-slate-600 hover:bg-white hover:text-emerald-600 transition-all shadow-sm" title="Expandir Imagem">
            <span class="material-symbols-outlined text-[16px]">open_in_new</span>
          </button>
        </div>
      `;
    } else {
      return `
        <div class="relative w-full h-full min-h-[300px]">
          <iframe src="${getAssetUrl(url)}" class="w-full h-full rounded-lg shadow-sm border border-slate-200"></iframe>
          <button type="button" onclick="window.open('${getAssetUrl(url)}','_blank')" class="absolute top-2 right-2 w-8 h-8 bg-white/80 backdrop-blur-md border border-slate-200 rounded-lg flex items-center justify-center text-slate-600 hover:bg-white hover:text-emerald-600 transition-all shadow-sm" title="Expandir Documento">
            <span class="material-symbols-outlined text-[16px]">open_in_new</span>
          </button>
        </div>
      `;
    }
  }

  document.getElementById("asideProformaContainer").innerHTML = renderAsideDocument(data.proformaUrl, "Documento");

  const compSection = document.getElementById("asideComprovativoSection");
  const compContainer = document.getElementById("asideComprovativoContainer");
  const faturaSection = document.getElementById("asideFaturaSection");
  const faturaContainer = document.getElementById("asideFaturaContainer");

  if (data.status === "CONFIRMADO" || data.status === "PAID") {
    if (data.comprovativoUrl) {
      compSection.classList.remove("hidden");
      compContainer.innerHTML = renderAsideDocument(data.comprovativoUrl, "Comprovativo");
    } else {
      compSection.classList.add("hidden");
    }

    if (data.faturaUrl) {
      faturaSection.classList.remove("hidden");
      faturaContainer.innerHTML = renderAsideDocument(data.faturaUrl, "Fatura");
    } else {
      faturaSection.classList.add("hidden");
    }
  } else {
    compSection.classList.add("hidden");
    faturaSection.classList.add("hidden");
  }

  const actionBtn = document.getElementById("asideActionBtn");
  const asideFinanceHint = document.getElementById("asideFinanceHint");

  actionBtn?.classList.add("hidden");
  if (asideFinanceHint) {
    const pending =
      data.status === "PENDENTE" || data.status === "APROVADO" || data.timelineStatus === "PENDENTE" || data.timelineStatus === "VENCIDO";
    asideFinanceHint.classList.toggle("hidden", !pending);
  }

  overlay.classList.remove("hidden");
  // Força reflow
  void overlay.offsetWidth;
  overlay.classList.remove("opacity-0");
  aside.classList.remove("translate-x-full");
};

window.closePaymentAside = function () {
  const aside = document.getElementById("paymentAside");
  const overlay = document.getElementById("paymentAsideOverlay");

  aside.classList.add("translate-x-full");
  overlay.classList.add("opacity-0");
  setTimeout(() => overlay.classList.add("hidden"), 300);
};


window.__openPayModal = openPayModal;
export { loadTransactions, loadHistory, openPayModal };
