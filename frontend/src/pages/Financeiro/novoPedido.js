import { apiRequest } from "/services/api.js";
import { getSessionUser } from "/services/auth.js";
import { guardPageAccess, initPermissionLayer, can } from "/shared/permissions.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { initMobileMenu, toast } from "/shared/ui.js";
import { sanitizeReturnTo } from "/shared/extraRequestModal.js";
import {
    initPurchaseOrderForm,
    ensureReferenceDataLoaded,
    applyTypeVisibility,
    applyQuoteRequirementVisibility,
    applyPedidoPresets,
    addItemRow,
    resetPedidoForm,
    fillPedidoForm,
    savePedido,
    uploadPedidoAttachment,
} from "/shared/purchaseOrderForm.js";

const MAX_ATTACHMENT_MB = 20;

function returnToUrl() {
    const q = new URLSearchParams(window.location.search).get("returnTo");
    if (q) return sanitizeReturnTo(q);
    try {
        if (document.referrer) {
            const ref = new URL(document.referrer);
            if (ref.origin === window.location.origin) {
                return sanitizeReturnTo(`${ref.pathname}${ref.search}`);
            }
        }
    } catch { /* ignore */ }
    return sanitizeReturnTo("");
}

function wireBackLink() {
    const link = document.querySelector(".pf-back");
    if (link) link.href = returnToUrl();
}

function showToast(msg, type = "info") {
    toast(msg, { type });
}

function apiError(err) {
    const e = err?.data?.error;
    if (e && typeof e === "object") {
        const fields = e.fieldErrors
            ? Object.entries(e.fieldErrors).flatMap(([k, msgs]) => (msgs || []).map((m) => `${k}: ${m}`))
            : [];
        const all = [...(e.formErrors || []), ...fields].filter(Boolean);
        if (all.length) return all.join(" · ");
    }
    if (typeof e === "string") {
        const map = {
            FORBIDDEN: "Sem permissão para esta acção",
            NOT_FOUND: "Pedido não encontrado",
            CANNOT_EDIT_IN_CURRENT_STATUS: "Este pedido já não pode ser editado neste estado",
            FILE_REQUIRED: "Seleccione um ficheiro",
            UPLOAD_FAILED: "Falha no envio do ficheiro",
        };
        return map[e] || e;
    }
    return err?.data?.message || err?.message || "Erro desconhecido";
}

// ─────────────────────────── Anexos ───────────────────────────
// PurchaseAttachment depende de uma requisição já existente, por isso num
// pedido novo os ficheiros ficam em memória e só sobem depois do POST.

const pendingFiles = [];
let uploadedAttachments = [];
let attachmentUploads = Promise.resolve();

function formatBytes(bytes) {
    const kb = Number(bytes) / 1024;
    if (kb < 1024) return `${kb.toFixed(0)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
}

function renderAttachments() {
    const list = document.getElementById("ccAttachmentList");
    if (!list) return;
    list.innerHTML = "";

    uploadedAttachments.forEach((att) => {
        list.appendChild(attachmentItem({
            name: att.fileName || "Documento",
            size: att.size,
            icon: "task_alt",
            removable: false,
        }));
    });

    pendingFiles.forEach((file, index) => {
        const el = attachmentItem({
            name: file.name,
            size: file.size,
            icon: "schedule",
            removable: true,
        });
        el.querySelector(".pf-attach-remove")?.addEventListener("click", () => {
            pendingFiles.splice(index, 1);
            renderAttachments();
        });
        list.appendChild(el);
    });
}

function attachmentItem({ name, size, icon, removable }) {
    const el = document.createElement("div");
    el.className = "pf-attach-item";
    el.innerHTML = `
        <span class="material-symbols-outlined">${icon}</span>
        <span class="pf-attach-name"></span>
        <span class="pf-attach-size">${size ? formatBytes(size) : ""}</span>
        ${removable ? `<button type="button" class="pf-attach-remove" aria-label="Remover ficheiro"><span class="material-symbols-outlined">close</span></button>` : ""}
    `;
    el.querySelector(".pf-attach-name").textContent = name;
    return el;
}

function queueFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const editId = document.getElementById("ccPedidoEditId")?.value || "";

    for (const file of files) {
        if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
            showToast(`"${file.name}" excede ${MAX_ATTACHMENT_MB} MB`, "error");
            continue;
        }
        pendingFiles.push(file);
    }
    renderAttachments();

    // Em edição o pedido já existe, por isso os anexos sobem de imediato.
    if (editId) flushAttachments(editId);
}

function flushAttachments(orderId) {
    if (!pendingFiles.length) return attachmentUploads;
    const queue = pendingFiles.splice(0, pendingFiles.length);
    renderAttachments();

    attachmentUploads = attachmentUploads.then(async () => {
        for (const file of queue) {
            try {
                const attachment = await uploadPedidoAttachment(orderId, file);
                uploadedAttachments.push(attachment || { fileName: file.name, size: file.size });
            } catch (err) {
                showToast(`Falha ao anexar "${file.name}": ${apiError(err)}`, "error");
            }
        }
        renderAttachments();
    });
    return attachmentUploads;
}

function bindAttachments() {
    const dropzone = document.getElementById("ccDropzone");
    const input = document.getElementById("ccAttachmentInput");
    if (!dropzone || !input) return;

    const openPicker = () => input.click();
    dropzone.addEventListener("click", openPicker);
    dropzone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
        }
    });
    document.getElementById("btnCCAddFile")?.addEventListener("click", openPicker);

    input.addEventListener("change", () => {
        queueFiles(input.files);
        input.value = "";
    });

    ["dragenter", "dragover"].forEach((type) => {
        dropzone.addEventListener(type, (e) => {
            e.preventDefault();
            dropzone.classList.add("is-dragover");
        });
    });
    ["dragleave", "drop"].forEach((type) => {
        dropzone.addEventListener(type, (e) => {
            e.preventDefault();
            dropzone.classList.remove("is-dragover");
        });
    });
    dropzone.addEventListener("drop", (e) => queueFiles(e.dataTransfer?.files));
}

// ─────────────────────────── Formulário ───────────────────────────

function setSubmitLabel(text, { busy = false } = {}) {
    const btn = document.getElementById("btnSubmitNovoPedido");
    if (!btn) return;
    btn.disabled = busy;
    const label = btn.querySelector(".pf-btn-label");
    if (label) label.textContent = text;
    else btn.innerHTML = `<span class="material-symbols-outlined">save</span><span class="pf-btn-label">${text}</span>`;
}

async function onSubmit(e) {
    e.preventDefault();
    const isEdit = Boolean(
        document.getElementById("ccPedidoEditId")?.value ||
        document.getElementById("ccPedidoExtraId")?.value
    );
    setSubmitLabel("A salvar...", { busy: true });

    try {
        const result = await savePedido();
        if (!result) return;

        const { saved, requiresQuote } = result;
        const extraId = document.getElementById("ccPedidoExtraId")?.value;
        if (!extraId && saved?.id) {
            await attachmentUploads;
            await flushAttachments(saved.id);
        }

        const number = saved?.number;
        showToast(
            isEdit
                ? (number ? `Pedido ${number} actualizado` : "Pedido actualizado")
                : number
                    ? (requiresQuote
                        ? `Pedido ${number} criado e enviado para Cotação`
                        : `Pedido ${number} criado com sucesso`)
                    : "Pedido criado com sucesso",
            "success"
        );
        window.location.href = returnToUrl();
    } catch (err) {
        showToast(apiError(err), "error");
    } finally {
        setSubmitLabel(isEdit ? "Guardar alterações" : "Salvar Pedido");
    }
}

async function startNewPedido() {
    resetPedidoForm();
    addItemRow();

    const due = new Date();
    due.setDate(due.getDate() + 7);
    const dateEl = document.getElementById("ccPedidoData");
    if (dateEl) dateEl.value = due.toISOString().slice(0, 10);

    const user = getSessionUser();
    const solicitante = document.getElementById("ccPedidoSolicitante");
    if (solicitante && !solicitante.value) solicitante.value = user?.name || user?.email || "";

    applyTypeVisibility();
    applyQuoteRequirementVisibility();
    try {
        await ensureReferenceDataLoaded();
    } catch { /* dados de referência são melhor-esforço */ }
    await applyPedidoPresets(readCreatePresets());
}

function readCreatePresets() {
    const q = new URLSearchParams(window.location.search);
    const flag = (key) => {
        const v = q.get(key);
        return v === "1" || v === "true";
    };
    return {
        type: q.get("type") || "",
        projectId: q.get("projectId") || "",
        costCenterId: q.get("costCenterId") || "",
        costCategoryId: q.get("costCategoryId") || q.get("generalCostCenterId") || "",
        lockType: flag("lockType"),
        lockProject: flag("lockProject"),
    };
}

async function startEditPedido(id) {
    try {
        const order = await apiRequest(`/purchase-orders/${id}`);
        resetPedidoForm();
        await fillPedidoForm(order);

        const title = document.getElementById("pedidoPageTitle");
        if (title) title.textContent = `Editar ${order.number || "pedido"}`;
        document.title = `Info Gestor — ${order.number || "Editar pedido"}`;
        setSubmitLabel("Guardar alterações");

        uploadedAttachments = order.requisition?.attachments || [];
        renderAttachments();
    } catch (err) {
        showToast("Não foi possível abrir o pedido para edição: " + apiError(err), "error");
        setTimeout(() => { window.location.href = returnToUrl(); }, 2000);
    }
}

function extraAsPedido(extra) {
    return {
        id: extra.id,
        number: extra.number || `PE-${String(extra.id || "").slice(-6).toUpperCase()}`,
        priority: extra.priority,
        requestedByName: extra.requestedBy,
        needDate: extra.desiredDate,
        description: extra.description,
        justification: extra.notes,
        requiresQuote: extra.requiresQuote,
        projectId: extra.type === "OBRA" ? extra.projectId : extra.projectId,
        costCenterId: extra.costCenterId,
        costCategoryId: extra.costCategoryId,
        supplierId: extra.supplierId,
        supplierName: extra.supplierName || extra.supplierRef?.name,
        supplier: extra.supplierRef,
        items: (extra.items || []).map((it) => ({
            name: it.description || it.name,
            quantity: it.quantity,
            unit: it.unit,
            unitPrice: it.unitPrice,
            notes: it.notes,
        })),
    };
}

async function startEditExtra(extraId) {
    try {
        const extra = await apiRequest(`/extra-requests/${extraId}`);
        resetPedidoForm();
        const order = extraAsPedido(extra);
        await fillPedidoForm(order, { extra: true });
        await applyPedidoPresets({
            type: extra.type,
            projectId: extra.projectId,
            costCenterId: extra.costCenterId,
            costCategoryId: extra.costCategoryId,
        });

        const title = document.getElementById("pedidoPageTitle");
        if (title) title.textContent = `Editar ${order.number}`;
        document.title = `Info Gestor — ${order.number}`;
        setSubmitLabel("Guardar alterações");
    } catch (err) {
        showToast("Não foi possível abrir o pedido para edição: " + apiError(err), "error");
        setTimeout(() => { window.location.href = returnToUrl(); }, 2000);
    }
}

async function guardAccess() {
    const user = getSessionUser();
    if (!user) return false;
    await initPermissionLayer();
    if ((user.role || "").toLowerCase() === "admin") return true;
    if (can("pedidosExtras", "view")) return true;
    return guardPageAccess("pedidosExtras", "view");
}

async function init() {
    if (!(await guardAccess())) return;

    wireLogout();
    wireUsersNav();
    initMobileMenu();

    initPurchaseOrderForm({ showToast, apiError });
    bindAttachments();
    wireBackLink();
    document.getElementById("formNovoPedido")?.addEventListener("submit", onSubmit);

    const q = new URLSearchParams(window.location.search);
    const editId = q.get("id");
    const extraId = q.get("extraId");
    if (editId) await startEditPedido(editId);
    else if (extraId) await startEditExtra(extraId);
    else await startNewPedido();
}

init();
