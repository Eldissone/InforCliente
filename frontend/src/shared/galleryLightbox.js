import { getApiBaseUrl } from "../services/api.js";
import { getToken } from "../services/auth.js";
import { can } from "./permissions.js";
import { toast } from "./ui.js";

function parseDownloadFilename(contentDisposition, fallback) {
  if (!contentDisposition) return fallback;
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;\n]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      /* ignore */
    }
  }
  const asciiMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (asciiMatch?.[1]) return asciiMatch[1];
  return fallback;
}

export function galleryPhotoTitle(photoOrDescription) {
  const desc =
    typeof photoOrDescription === "string"
      ? photoOrDescription
      : photoOrDescription?.description;
  return String(desc ?? "").trim() || "Sem descrição";
}

/** @type {{ projectId?: string, photoId?: string, title?: string, portal?: boolean } | null} */
let downloadContext = null;

export function canDownloadGalleryPhoto({ portal = false } = {}) {
  const modules = portal ? ["portal", "obras"] : ["obras", "portal"];
  return modules.some((mod) => can(mod, "download_gallery", { method: "POST" }));
}

function updateDownloadButton() {
  const btn = document.getElementById("lightboxDownloadBtn");
  if (!btn) return;

  const allowed =
    downloadContext?.projectId &&
    downloadContext?.photoId &&
    canDownloadGalleryPhoto({ portal: downloadContext.portal });

  btn.classList.toggle("hidden", !allowed);
  btn.disabled = !allowed;
}

export function openGalleryLightbox({ url, title, date, projectId, photoId, portal = false }) {
  const lightbox = document.getElementById("imageLightbox");
  const img = document.getElementById("lightboxImage");
  const titleEl = document.getElementById("lightboxTitle");
  const dateEl = document.getElementById("lightboxDate");

  if (!lightbox || !img) return;

  downloadContext =
    projectId && photoId ? { projectId, photoId, title: title || "foto-obra", portal } : null;

  img.src = url;
  if (titleEl) titleEl.textContent = title || "";
  if (dateEl) dateEl.textContent = date || "";

  updateDownloadButton();
  lightbox.classList.add("active");
  document.body.style.overflow = "hidden";
}

export function closeGalleryLightbox() {
  const lightbox = document.getElementById("imageLightbox");
  if (!lightbox) return;
  lightbox.classList.remove("active");
  document.body.style.overflow = "";
  downloadContext = null;
  updateDownloadButton();
}

export async function downloadGalleryPhotoFromLightbox() {
  if (!downloadContext?.projectId || !downloadContext?.photoId) return;
  if (!canDownloadGalleryPhoto({ portal: downloadContext.portal })) {
    toast("Não tem permissão para descarregar fotos da galeria.", { type: "warning" });
    return;
  }

  const btn = document.getElementById("lightboxDownloadBtn");
  if (btn) btn.disabled = true;

  try {
    const { projectId, photoId, title } = downloadContext;
    const res = await fetch(
      `${getApiBaseUrl()}/projects/${encodeURIComponent(projectId)}/photos/${encodeURIComponent(photoId)}/download`,
      { headers: { Authorization: `Bearer ${getToken()}` } }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "DOWNLOAD_FAILED");
    }

    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") || "";
    const filename = parseDownloadFilename(disposition, `${title || "foto-obra"}.jpg`);

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    toast(err.message === "FORBIDDEN_BY_PERMISSION"
      ? "Não tem permissão para descarregar fotos da galeria."
      : "Não foi possível descarregar a foto.", { type: "error" });
  } finally {
    if (btn) btn.disabled = false;
    updateDownloadButton();
  }
}

export function initGalleryLightboxActions() {
  document.getElementById("lightboxDownloadBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    downloadGalleryPhotoFromLightbox();
  });
}
