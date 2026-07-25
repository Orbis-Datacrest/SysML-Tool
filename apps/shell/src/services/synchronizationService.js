export function createSynchronizationService({ api, state, bus, pollInterval = 1500 }) {
  let timer = null;
  let pendingPresence = null;
  let inFlight = false;
  let lastPayloadSignature = "";

  const apply = (payload) => {
    const signature = JSON.stringify(payload);
    if (signature === lastPayloadSignature && state.collaboration.online && !state.collaboration.loading && !state.collaboration.error) return;
    lastPayloadSignature = signature;
    const { diagram: remoteDiagram, ...collaborationPayload } = payload;
    let conflict = state.collaboration.conflict ?? null;
    if (remoteDiagram?.id === state.diagram?.id && Number(remoteDiagram.version) > Number(state.diagram.version)) {
      if (state.dirtyTabIds?.has(remoteDiagram.id)) {
        const isNewConflict = Number(conflict?.remoteVersion) !== Number(remoteDiagram.version);
        conflict = {
          diagramId: remoteDiagram.id,
          localVersion: state.diagram.version,
          remoteVersion: remoteDiagram.version,
          message: "A collaborator saved a newer version while you have unsaved changes."
        };
        if (isNewConflict) bus.emit("collaboration:conflict", conflict);
      } else {
        state.diagram = remoteDiagram;
        state.diagrams = (state.diagrams ?? []).map((item) => item.id === remoteDiagram.id ? remoteDiagram : item);
        conflict = null;
        bus.emit("diagram:remote", remoteDiagram);
        bus.emit("diagram:changed", remoteDiagram);
      }
    } else if (remoteDiagram?.id === state.diagram?.id && Number(remoteDiagram.version) === Number(state.diagram.version)) {
      conflict = null;
    }
    state.collaboration = { ...state.collaboration, ...collaborationPayload, conflict, online: true, loading: false, error: "" };
    bus.emit("collaboration:changed", state.collaboration);
  };

  const poll = async () => {
    if (!state.project?.id || !state.diagram?.id || inFlight) return;
    inFlight = true;
    try {
      if (pendingPresence) {
        await api.publishPresence(state.project.id, pendingPresence);
        pendingPresence = null;
      }
      apply(await api.collaborationState(state.project.id, state.diagram.id));
    } catch (error) {
      state.collaboration.online = false;
      state.collaboration.loading = false;
      state.collaboration.error = error.message;
      bus.emit("collaboration:changed", state.collaboration);
      if (!String(error.message).includes("Failed to fetch")) bus.emit("toast", error.message);
    } finally {
      inFlight = false;
    }
  };

  return {
    start() {
      clearInterval(timer);
      lastPayloadSignature = "";
      state.collaboration.loading = true;
      timer = setInterval(poll, pollInterval);
      poll();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    publishPresence(cursor = null, selection = state.selectedElementIds ?? []) {
      if (!state.project?.id || !state.diagram?.id) return;
      pendingPresence = { diagram_id: state.diagram.id, cursor, selection };
    },
    async addComment(input) {
      const result = await api.createComment(state.project.id, input);
      state.collaboration.comments = result.comments ?? [];
      bus.emit("collaboration:changed", state.collaboration);
      return result;
    },
    async updateComment(commentId, input) {
      const result = await api.updateComment(state.project.id, commentId, input);
      state.collaboration.comments = result.comments ?? [];
      bus.emit("collaboration:changed", state.collaboration);
      return result;
    },
    refresh: poll
  };
}
