export function createApiClient({ state, bus, fetchImpl = fetch }) {
  const persistSession = (token, refreshToken) => {
    try {
      localStorage.setItem("sysml.authToken", token);
      localStorage.setItem("sysml.refreshToken", refreshToken);
    } catch { /* Server-backed session remains valid when storage is unavailable. */ }
  };
  const api = {
    request(path, options = {}) {
      return api.rawRequest(path, options, true);
    },
    async rawRequest(path, options = {}, allowRefresh = true) {
      const authHeaders = state.authToken ? { authorization: `Bearer ${state.authToken}` } : {};
      const result = await fetchImpl(path, {
        ...options,
        headers: { "content-type": "application/json", "x-tenant-id": state.tenantId, ...authHeaders, ...(options.headers ?? {}) }
      });
      if (result.status === 401 && allowRefresh && state.refreshToken && path !== "/api/auth/refresh") {
        const refreshed = await api.rawRequest("/api/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: state.refreshToken }) }, false);
        state.authToken = refreshed.token;
        state.refreshToken = refreshed.refreshToken;
        state.user = refreshed.user;
        persistSession(refreshed.token, refreshed.refreshToken);
        bus.emit("auth:changed", state.user);
        return api.rawRequest(path, options, false);
      }
      if (!result.ok) throw new Error((await result.json()).error ?? result.statusText);
      return result.headers.get("content-type")?.includes("application/json") ? result.json() : result.blob();
    },
    saveDiagram: (diagram, { snapshot = false } = {}) => api.request(`/api/diagrams/${diagram.id}${snapshot ? "?snapshot=1" : ""}`, { method: "PUT", body: JSON.stringify(diagram) }),
    createBaseline: (projectId, input) => api.request(`/api/projects/${projectId}/versions`, { method: "POST", body: JSON.stringify(input) }),
    compareVersions: (projectId, from, to) => api.request(`/api/projects/${projectId}/versions/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    restoreElement: (projectId, version, input) => api.request(`/api/projects/${projectId}/versions/${version}/restore-element`, { method: "POST", body: JSON.stringify(input) }),
    restoreDiagram: (projectId, version, input) => api.request(`/api/projects/${projectId}/versions/${version}/restore-diagram`, { method: "POST", body: JSON.stringify(input) }),
    releaseBaseline: (projectId, baselineId) => api.request(`/api/projects/${projectId}/baselines/${baselineId}/release`, { method: "POST" }),
    listReviews: (projectId) => api.request(`/api/projects/${projectId}/reviews`),
    createReview: (projectId, input) => api.request(`/api/projects/${projectId}/reviews`, { method: "POST", body: JSON.stringify(input) }),
    approveReview: (projectId, reviewId, input) => api.request(`/api/projects/${projectId}/reviews/${reviewId}/approval`, { method: "POST", body: JSON.stringify(input) }),
    collaborationState: (projectId, diagramId) => api.request(`/api/projects/${projectId}/collaboration?diagram_id=${encodeURIComponent(diagramId)}`),
    publishPresence: (projectId, input) => api.request(`/api/projects/${projectId}/collaboration`, { method: "POST", body: JSON.stringify(input) }),
    createComment: (projectId, input) => api.request(`/api/projects/${projectId}/comments`, { method: "POST", body: JSON.stringify(input) })
  };
  return api;
}
