import { registerMfe } from "/packages/ui/src/moduleRegistry.js";
import { exporters, importers, toSvg } from "./exporters.js";
import { MAX_IMPORT_BYTES } from "./projectFormat.js";

let activeTransfer = "";

function claimTransfer(type) {
  if (activeTransfer) return false;
  activeTransfer = type;
  return true;
}

function releaseTransfer(type) {
  if (activeTransfer === type) activeTransfer = "";
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Firefox and Safari may still be reading the object URL after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readFileText(file) {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("The selected file could not be read."));
    reader.readAsText(file);
  });
}

function filename(value) {
  return String(value || "diagram").replace(/[\/:*?"<>|]+/g, "-");
}

function rebaseImportedDiagram(diagram) {
  const copy = structuredClone(diagram);
  const ids = [
    ...(copy.elements ?? []).map((item) => item.id),
    ...(copy.relationships ?? []).map((item) => item.id)
  ];
  const replacements = new Map(ids.map((oldId) => [oldId, `import_${crypto.randomUUID()}`]));
  const replaceReferences = (value) => {
    if (typeof value === "string") return replacements.get(value) ?? value;
    if (Array.isArray(value)) return value.map(replaceReferences);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceReferences(item)]));
    }
    return value;
  };
  const rebased = replaceReferences(copy);
  rebased.elements = (rebased.elements ?? []).map(({ model_element_id: _modelElementId, ...item }) => item);
  rebased.relationships = (rebased.relationships ?? []).map(({ model_relationship_id: _modelRelationshipId, ...item }) => item);
  return rebased;
}

async function pngBlob(diagram, scale = 2) {
  const svg = toSvg(diagram);
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("The PNG image could not be created."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.width * scale;
    canvas.height = image.height * scale;
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The PNG image could not be created.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function statusMarkup(status, className) {
  if (!status.message) return "";
  const role = status.kind === "error" ? "alert" : "status";
  return `<output class="${className} ${status.kind}" role="${role}">${escapeHtml(status.message)}</output>`;
}

registerMfe("project-export", (element, { state, bus }) => {
  let open = false;
  let busy = false;
  let status = { kind: "", message: "" };

  async function runExport(format) {
    if (busy) return;
    if (!claimTransfer("export")) {
      status = { kind: "error", message: "Another import or export is already in progress." };
      render();
      return;
    }
    const exporter = exporters.get(format);
    if (format !== "png" && !exporter) {
      status = { kind: "error", message: `Unsupported export format: ${format}.` };
      releaseTransfer("export");
      render();
      return;
    }

    busy = true;
    status = { kind: "progress", message: `Creating ${format.toUpperCase()}…` };
    render();
    try {
      const base = filename(state.project?.name ?? state.diagram?.name);
      if (format === "png") {
        download(await pngBlob(state.diagram), `${base}.png`);
      } else {
        const contents = exporter.serialize(state.diagram, {
          project: state.project,
          diagrams: state.diagrams,
          modelRepository: state.modelRepository,
          canvasViewport: state.canvasViewport
        });
        download(new Blob([contents], { type: exporter.mime }), `${base}.${exporter.extension}`);
      }
      status = { kind: "success", message: `${format.toUpperCase()} export ready.` };
    } catch (error) {
      status = { kind: "error", message: `Export failed: ${error.message}` };
    } finally {
      busy = false;
      releaseTransfer("export");
      render();
    }
  }

  function closeMenu({ restoreFocus = false } = {}) {
    open = false;
    render();
    if (restoreFocus) element.querySelector("#export-toggle")?.focus();
  }

  function render() {
    element.innerHTML = `
      <button id="export-toggle" class="export-button" type="button" aria-haspopup="menu" aria-expanded="${open}">Export <span aria-hidden="true">⌄</span></button>
      ${open ? `<div class="export-menu" role="menu" aria-label="Export options">
        <div class="export-menu-help"><strong>Download your work</strong><span>JSON is the durable Model Studio project file.</span></div>
        ${[["json", "JSON", "Restorable project"], ["svg", "SVG", "Editable vector"], ["png", "PNG", "2× raster image"], ["pdf", "PDF", "Vector document"], ["plantuml", "PUML", "PlantUML source"], ["csv", "CSV", "Requirements table"], ["xlsx", "XLSX", "Excel requirements"]].map(([id, label, detail]) => `<button data-export="${id}" type="button" role="menuitem" ${busy ? "disabled" : ""}><span class="export-format">${label}</span><span>${detail}</span></button>`).join("")}
        ${statusMarkup(status, "export-status")}
      </div>` : ""}`;

    element.querySelector("#export-toggle").addEventListener("click", (event) => {
      event.stopPropagation();
      const opening = !open;
      if (opening) bus.emit("ui:menu-open", "export");
      open = opening;
      render();
      if (opening) element.querySelector("[data-export]")?.focus();
    });
    element.querySelectorAll("[data-export]").forEach((button) => button.addEventListener("click", () => runExport(button.dataset.export)));
  }

  const closeOnOutsidePointer = (event) => {
    if (open && !element.contains(event.target)) closeMenu();
  };
  const closeOnEscape = (event) => {
    if (open && event.key === "Escape") {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
    }
  };
  const stopMenuSync = bus.on("ui:menu-open", (menu) => {
    if (open && menu !== "export") closeMenu();
  });
  document.addEventListener("pointerdown", closeOnOutsidePointer, true);
  document.addEventListener("keydown", closeOnEscape);
  render();
  return () => {
    document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    document.removeEventListener("keydown", closeOnEscape);
    stopMenuSync();
  };
});

registerMfe("project-import", (element, { state, bus, setDiagram, saveCurrentDiagram }) => {
  let busy = false;
  let status = { kind: "", message: "" };

  async function importFile(file) {
    if (busy) return;
    if (!claimTransfer("import")) {
      status = { kind: "error", message: "Another import or export is already in progress." };
      render();
      return;
    }
    busy = true;
    status = { kind: "progress", message: `Checking ${file.name}…` };
    render();
    let importApplied = false;

    try {
      const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
      const importer = importers.get(extension);
      if (!importer) throw new Error(extension ? `Files ending in .${extension} are not supported.` : "The selected file has no supported extension.");
      if (file.size > MAX_IMPORT_BYTES) throw new Error("The selected file is larger than 10 MB.");
      if (file.size === 0) throw new Error("The selected file is empty.");

      // Parsing and validation finish before either the diagram or viewport is changed.
      const imported = await importer.parse(await readFileText(file));
      const previousViewport = structuredClone(state.canvasViewport);
      const previousDiagram = state.diagram;
      const previousHistory = [...state.history];
      const previousFuture = [...state.future];
      const previousElementSelection = [...state.selectedElementIds];
      const previousRelationshipSelection = state.selectedRelationshipId;
      const previousSelectedTool = structuredClone(state.selectedTool);
      const localIdentity = { id: state.diagram.id, project_id: state.diagram.project_id, tenant_id: state.diagram.tenant_id };
      try {
        const foreignProject = !imported.diagram.project_id || imported.diagram.project_id !== localIdentity.project_id;
        const importedDiagram = foreignProject ? rebaseImportedDiagram(imported.diagram) : imported.diagram;
        if (imported.viewport) state.canvasViewport = imported.viewport;
        state.selectedElementIds = [];
        state.selectedRelationshipId = null;
        state.selectedTool = { type: "select", kind: null, label: "" };
        setDiagram({ ...importedDiagram, ...localIdentity });
        importApplied = true;
        // Import is a durability boundary: do not report success while the
        // normal debounced auto-save can still be cancelled by a page reload.
        const saved = await saveCurrentDiagram?.({ diagram: state.diagram });
        if (saveCurrentDiagram && !saved) throw new Error("The imported diagram could not be saved.");
      } catch (error) {
        if (!importApplied) {
          state.diagram = previousDiagram;
          state.canvasViewport = previousViewport;
          state.history = previousHistory;
          state.future = previousFuture;
          state.selectedElementIds = previousElementSelection;
          state.selectedRelationshipId = previousRelationshipSelection;
          state.selectedTool = previousSelectedTool;
          bus.emit("diagram:changed", previousDiagram);
        }
        throw error;
      }
      status = { kind: "success", message: `Imported ${file.name}: ${imported.diagram.elements.length} elements and ${imported.diagram.relationships.length} relationships.` };
    } catch (error) {
      status = importApplied
        ? { kind: "error", message: `Imported locally, but saving failed: ${error.message} Keep this page open and export a backup before refreshing.` }
        : { kind: "error", message: `Import failed: ${error.message}` };
    } finally {
      busy = false;
      releaseTransfer("import");
      render();
    }
  }

  function render() {
    element.innerHTML = `<div class="project-import-control">
      <div><strong>Import</strong><span>Restore a Model Studio JSON project</span></div>
      <button id="choose-import" type="button" ${busy ? "disabled" : ""}>${busy ? "Checking…" : "Import"}</button>
      <input id="import-file" type="file" accept=".json,application/json" hidden>
    </div>${statusMarkup(status, "import-status")}`;
    const input = element.querySelector("#import-file");
    element.querySelector("#choose-import").addEventListener("click", () => input.click());
    input.addEventListener("change", (event) => {
      const [file] = event.target.files;
      event.target.value = "";
      if (file) importFile(file);
    });
  }

  render();
});
