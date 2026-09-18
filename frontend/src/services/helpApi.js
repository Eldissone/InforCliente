import { apiRequest, apiUpload } from "./api.js";

export function createHelpTicket(formData) {
  return apiUpload("/help-tickets", formData);
}

export function fetchMyHelpTickets() {
  return apiRequest("/help-tickets/mine");
}

export function fetchHelpTickets({ type, status, search, skip, take } = {}) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  if (skip != null) params.set("skip", String(skip));
  if (take != null) params.set("take", String(take));
  const qs = params.toString();
  return apiRequest(`/help-tickets${qs ? `?${qs}` : ""}`);
}

export function fetchHelpTicket(id) {
  return apiRequest(`/help-tickets/${encodeURIComponent(id)}`);
}

export function updateHelpTicket(id, body) {
  return apiRequest(`/help-tickets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
  });
}
