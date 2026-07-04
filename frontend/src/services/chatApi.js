import { apiRequest } from "./api.js";

export function fetchConversations() {
  return apiRequest("/conversations");
}

export function fetchMessages(conversationId, { cursor, limit } = {}) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return apiRequest(`/conversations/${encodeURIComponent(conversationId)}/messages${qs ? `?${qs}` : ""}`);
}

export function createConversation({ participantIds, title, type }) {
  return apiRequest("/conversations", {
    method: "POST",
    body: { participantIds, title, type },
  });
}

export function sendMessageRest(conversationId, body, mentionIds) {
  return apiRequest(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    body: { body, mentionIds },
  });
}

export function markConversationRead(conversationId) {
  return apiRequest(`/conversations/${encodeURIComponent(conversationId)}/read`, {
    method: "PATCH",
  });
}

export function searchUsers(q) {
  return apiRequest(`/users/search?q=${encodeURIComponent(q)}`);
}

export function fetchNotifications({ unreadOnly = false } = {}) {
  return apiRequest(`/notifications${unreadOnly ? "?unreadOnly=true" : ""}`);
}

export function fetchUnreadNotificationCount() {
  return apiRequest("/notifications/unread-count");
}
