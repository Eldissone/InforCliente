import { apiRequest, apiUpload, getApiBaseUrl } from "../../services/api.js";
import { getToken } from "../../services/auth.js";
import { setButtonLoading, toast } from "../../shared/ui.js";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function el(id) { return document.getElementById(id); }
function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatBytes(size) {
  const n = Number(size) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatWhen(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-PT");
}

function setProgress(text, visible = true) {
  const box = el("backupProgress");
  if (!box) return;
  box.textContent = text || "";
  box.classList.toggle("hidden", !visible || !text);
}

function downloadUrl(path) {
  const token = getToken();
  const base = getApiBaseUrl().replace(/\/$/, "");
  const join = path.startsWith("/") ? path : `/${path}`;
  return `${base}${join}${join.includes("?") ? "&" : "?"}token=${encodeURIComponent(token || "")}`;
}

function triggerDownload(path) {
  const link = document.createElement("a");
  link.href = downloadUrl(path);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeRun(run) {
  if (!run) return "Ainda não há cópias";
  const when = formatWhen(run.at);
  if (run.source === "restore") {
    return run.status === "ok" ? `Dados repostos em ${when}` : `Reposição falhou em ${when}`;
  }
  if (run.status === "ok") return run.remoteOk ? `Enviada em ${when}` : `Descarregada em ${when}`;
  if (run.status === "partial") return `Descarregada em ${when}. O destino externo falhou.`;
  return `Falhou em ${when}`;
}

function describeSchedule(settings) {
  if (!settings || settings.schedule === "off") return "Desligado";
  const when = settings.scheduleTime || "02:15";
  if (settings.schedule === "weekly") {
    return `Semanal, ${WEEKDAYS[Number(settings.weekday)] || "Segunda"} às ${when}`;
  }
  return `Diário às ${when}`;
}

function toggleDestinationFields() {
  const type = el("backupDestType")?.value || "s3";
  el("backupS3Fields")?.classList.toggle("hidden", type !== "s3");
  el("backupSftpFields")?.classList.toggle("hidden", type !== "sftp");
  const weekly = el("backupSchedule")?.value === "weekly";
  const weekday = el("backupWeekday");
  if (weekday) weekday.disabled = !weekly;
}

function fillForm(settings) {
  if (!settings) return;
  el("backupSchedule").value = settings.schedule || "off";
  el("backupTime").value = settings.scheduleTime || "02:15";
  el("backupWeekday").value = String(settings.weekday ?? 1);
  el("backupRetention").value = String(settings.retentionDays ?? 30);
  el("backupDestType").value = settings.destination?.type || "s3";
  const s3 = settings.destination?.s3 || {};
  el("backupS3Endpoint").value = s3.endpoint || "";
  el("backupS3Region").value = s3.region || "eu-central-1";
  el("backupS3Bucket").value = s3.bucket || "";
  el("backupS3Prefix").value = s3.prefix || "inforcliente/";
  el("backupS3AccessKey").value = s3.accessKeyId || "";
  el("backupS3Secret").placeholder = s3.hasSecret ? "Secret key já guardada" : "Secret key";
  const sftp = settings.destination?.sftp || {};
  el("backupSftpHost").value = sftp.host || "";
  el("backupSftpPort").value = String(sftp.port || 22);
  el("backupSftpUser").value = sftp.username || "";
  el("backupSftpDir").value = sftp.remoteDir || "/backups/inforcliente";
  el("backupSftpFingerprint").value = sftp.hostFingerprint || "";
  el("backupSftpPassword").placeholder = sftp.hasPassword ? "Palavra-passe já guardada" : "Palavra-passe";
  el("backupSftpKey").placeholder = sftp.hasPrivateKey
    ? "Chave privada já guardada"
    : "Chave privada (opcional, em alternativa à palavra-passe)";
  hasPassphrase = Boolean(settings.hasPassphrase);
  el("backupPassphraseState").textContent = settings.hasPassphrase
    ? "Há uma frase-passe guardada. Preencha os campos só para a substituir."
    : "Ainda não há frase-passe. Defina uma antes de gerar a cópia.";
  el("backupLastRun").textContent = describeRun(settings.lastRun);
  el("backupScheduleLabel").textContent = describeSchedule(settings);
  el("backupPgDump").textContent = settings.pgDumpAvailable ? "pg_dump disponível" : "pg_dump não encontrado";
  toggleDestinationFields();
}

function collectSettings() {
  const passphrase = el("backupPassphrase")?.value || "";
  const confirm = el("backupPassphraseConfirm")?.value || "";
  if (passphrase || confirm) {
    if (passphrase.length < 12) throw new Error("A frase-passe deve ter pelo menos 12 caracteres.");
    if (passphrase !== confirm) throw new Error("A confirmação da frase-passe não coincide.");
  }
  return {
    schedule: el("backupSchedule").value,
    scheduleTime: el("backupTime").value,
    weekday: Number(el("backupWeekday").value),
    retentionDays: Number(el("backupRetention").value),
    ...(passphrase ? { passphrase } : {}),
    destination: {
      type: el("backupDestType").value,
      s3: {
        endpoint: el("backupS3Endpoint").value,
        region: el("backupS3Region").value,
        bucket: el("backupS3Bucket").value,
        prefix: el("backupS3Prefix").value,
        accessKeyId: el("backupS3AccessKey").value,
        secretAccessKey: el("backupS3Secret").value,
      },
      sftp: {
        host: el("backupSftpHost").value,
        port: Number(el("backupSftpPort").value),
        username: el("backupSftpUser").value,
        remoteDir: el("backupSftpDir").value,
        hostFingerprint: el("backupSftpFingerprint").value,
        password: el("backupSftpPassword").value,
        privateKey: el("backupSftpKey").value,
      },
    },
  };
}

function renderRemote(files) {
  const body = el("backupRemoteBody");
  if (!body) return;
  if (!files?.length) {
    body.innerHTML = `<tr><td colspan="4" class="px-6 py-8 text-sm text-slate-400">Ainda não há cópias no destino externo.</td></tr>`;
    return;
  }
  body.innerHTML = files.map((file) => `
    <tr class="border-b border-slate-50">
      <td class="px-6 py-4 text-sm font-semibold text-slate-800">${esc(file.name)}</td>
      <td class="px-6 py-4 text-sm text-slate-500">${formatBytes(file.size)}</td>
      <td class="px-6 py-4 text-sm text-slate-500">${esc(formatWhen(file.modifiedAt))}</td>
      <td class="px-6 py-4 text-right">
        <button type="button" data-backup-download="${esc(file.name)}" class="text-xs font-black uppercase tracking-widest text-slate-600 hover:text-slate-900">Descarregar</button>
      </td>
    </tr>
  `).join("");
}

async function pollJob(id, { download }) {
  const started = Date.now();
  while (Date.now() - started < 60 * 60 * 1000) {
    const job = await apiRequest(`/backups/jobs/${id}`);
    setProgress(job.phaseLabel || "A trabalhar…");
    if (job.status === "ready") {
      if (download) triggerDownload(`/backups/jobs/${id}/download`);
      return job;
    }
    if (job.status === "done") return job;
    if (job.status === "error") throw new Error(job.error || "A operação falhou.");
    await sleep(2000);
  }
  throw new Error("A operação demorou demasiado.");
}

export async function loadBackupPanel() {
  try {
    const settings = await apiRequest("/backups/settings");
    fillForm(settings);
  } catch (error) {
    toast(error.message || "Não foi possível ler as cópias.", { type: "error" });
  }
  try {
    const remote = await apiRequest("/backups/remote");
    renderRemote(remote.files || []);
  } catch {
    renderRemote([]);
  }
}

let hasPassphrase = false;
let wired = false;

export function initBackupPanel() {
  if (wired) return;
  wired = true;

  el("backupDestType")?.addEventListener("change", toggleDestinationFields);
  el("backupSchedule")?.addEventListener("change", toggleDestinationFields);

  el("backupForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = el("backupSaveBtn");
    try {
      const body = collectSettings();
      setButtonLoading(button, true);
      const settings = await apiRequest("/backups/settings", { method: "PUT", body });
      fillForm(settings);
      el("backupPassphrase").value = "";
      el("backupPassphraseConfirm").value = "";
      el("backupS3Secret").value = "";
      el("backupSftpPassword").value = "";
      el("backupSftpKey").value = "";
      toast("Definições guardadas.", { type: "success" });
    } catch (error) {
      toast(error.message || "Não foi possível guardar.", { type: "error" });
    } finally {
      setButtonLoading(button, false);
    }
  });

  el("backupTestBtn")?.addEventListener("click", async () => {
    const button = el("backupTestBtn");
    try {
      setButtonLoading(button, true);
      const result = await apiRequest("/backups/test", { method: "POST", body: collectSettings() });
      const extra = result.fingerprint ? ` Impressão: ${result.fingerprint}` : "";
      toast(`${result.message || "Ligação confirmada."}${extra}`, { type: "success" });
    } catch (error) {
      toast(error.message || "O destino externo não respondeu.", { type: "error" });
    } finally {
      setButtonLoading(button, false);
    }
  });

  el("backupRunBtn")?.addEventListener("click", async () => {
    const button = el("backupRunBtn");
    const downloadLocal = Boolean(el("backupDownloadLocal")?.checked);
    let body;
    try {
      body = collectSettings();
    } catch (error) {
      setProgress(error.message);
      toast(error.message, { type: "error" });
      return;
    }
    if (!hasPassphrase && !body.passphrase) {
      const message = "Defina e confirme a frase-passe antes de gerar a cópia.";
      setProgress(message);
      toast(message, { type: "error" });
      return;
    }
    body.downloadLocal = downloadLocal;
    try {
      setButtonLoading(button, true);
      setProgress("A preparar a cópia…");
      const job = await apiRequest("/backups/run", { method: "POST", body });
      const done = await pollJob(job.id, { download: downloadLocal });
      setProgress("");
      if (done.remoteOk && downloadLocal) toast("Cópia externa enviada. O download começou.", { type: "success" });
      else if (done.remoteOk) toast("Cópia enviada para o destino externo.", { type: "success" });
      else if (downloadLocal && done.remoteError) toast(`Download iniciado. O destino externo falhou: ${done.remoteError}`, { type: "error" });
      else if (downloadLocal) toast("Download da cópia iniciado.", { type: "success" });
      else toast(done.remoteError || "A cópia externa falhou.", { type: "error" });
      await loadBackupPanel();
    } catch (error) {
      setProgress(error.message || "Não foi possível gerar a cópia.");
      toast(error.message || "Não foi possível gerar a cópia.", { type: "error" });
    } finally {
      setButtonLoading(button, false);
    }
  });

  el("backupRestoreForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = el("backupRestoreBtn");
    const file = el("backupRestoreFile")?.files?.[0];
    const passphrase = el("backupRestorePassphrase")?.value || "";
    const confirm = el("backupRestoreConfirm")?.value || "";
    if (!file) {
      toast("Seleccione o ficheiro .icbk.", { type: "error" });
      return;
    }
    if (confirm.trim().toUpperCase() !== "REPOR") {
      toast("Escreva REPOR para confirmar a substituição dos dados.", { type: "error" });
      return;
    }
    const form = new FormData();
    form.append("file", file);
    form.append("passphrase", passphrase);
    form.append("confirm", confirm.trim());
    try {
      setButtonLoading(button, true);
      setProgress("A enviar o ficheiro…");
      const job = await apiUpload("/backups/restore", form);
      await pollJob(job.id, { download: false });
      setProgress("");
      el("backupRestoreConfirm").value = "";
      el("backupRestorePassphrase").value = "";
      el("backupRestoreFile").value = "";
      toast("Dados repostos. Actualize a página. Se a sessão deixar de ser aceite, entre outra vez.", { type: "success" });
      await loadBackupPanel();
    } catch (error) {
      setProgress("");
      toast(error.message || "Não foi possível repor os dados.", { type: "error" });
    } finally {
      setButtonLoading(button, false);
    }
  });

  el("backupRemoteBody")?.addEventListener("click", (event) => {
    const name = event.target?.closest?.("[data-backup-download]")?.getAttribute("data-backup-download");
    if (!name) return;
    triggerDownload(`/backups/remote/${encodeURIComponent(name)}/download`);
  });
}
