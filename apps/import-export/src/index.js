import { registerMfe } from "/packages/ui/src/moduleRegistry.js";
import { exporters, importers, toSvg } from "./exporters.js";

function download(blob, filename) {
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

function filename(value) { return String(value || "diagram").replace(/[\\/:*?"<>|]+/g, "-"); }

async function pngBlob(diagram, scale = 2) {
  const svg = toSvg(diagram); const image = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    const canvas = document.createElement("canvas"); canvas.width = image.width * scale; canvas.height = image.height * scale;
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  } finally { URL.revokeObjectURL(url); }
}

registerMfe("import-export", (element, { state, setDiagram }) => {
  let open = false; let status = "";
  async function runExport(format) {
    const base = filename(state.diagram?.name); status = `Creating ${format.toUpperCase()}…`; render();
    try {
      if (format === "png") download(await pngBlob(state.diagram), `${base}.png`);
      else {
        const exporter = exporters.get(format); const contents = exporter.serialize(state.diagram, { project: state.project });
        download(new Blob([contents], { type: exporter.mime }), `${base}.${exporter.extension}`);
      }
      status = `${format.toUpperCase()} ready`;
    } catch (error) { status = error.message; }
    render();
  }

  async function importFile(file) {
    const extension = file.name.split(".").pop().toLowerCase(); const importer = importers.get(extension);
    if (!importer) { status = `No importer for .${extension}`; render(); return; }
    try {
      const diagram = await importer.parse(await file.text());
      if (!Array.isArray(diagram.elements) || !Array.isArray(diagram.relationships)) throw new Error("The file does not contain a valid diagram.");
      setDiagram({ ...state.diagram, ...diagram, id: state.diagram.id, project_id: state.diagram.project_id, tenant_id: state.diagram.tenant_id });
      status = `Imported ${file.name}`;
    } catch (error) { status = `Import failed: ${error.message}`; }
    render();
  }

  function render() {
    element.innerHTML = `<button id="export-toggle" class="export-button" aria-haspopup="menu" aria-expanded="${open}">Import / Export <span aria-hidden="true">⌄</span></button>
      ${open ? `<div class="export-menu" role="menu">
        <label class="export-import"><span class="export-format">IMPORT</span><span>JSON diagram</span><input data-import type="file" accept=".json,application/json" hidden></label>
        ${[["svg", "SVG", "Editable vector"], ["png", "PNG", "2× raster image"], ["pdf", "PDF", "Vector document"], ["plantuml", "PUML", "PlantUML source"], ["json", "JSON", "Lossless project data"], ["csv", "CSV", "Requirements table"], ["xlsx", "XLSX", "Excel requirements"]].map(([id, label, detail]) => `<button data-export="${id}" role="menuitem"><span class="export-format">${label}</span><span>${detail}</span></button>`).join("")}
        ${status ? `<output class="export-status">${status}</output>` : ""}
      </div>` : ""}`;
    element.querySelector("#export-toggle").addEventListener("click", (event) => { event.stopPropagation(); open = !open; render(); });
    element.querySelectorAll("[data-export]").forEach((button) => button.addEventListener("click", () => runExport(button.dataset.export)));
    element.querySelector("[data-import]")?.addEventListener("change", (event) => event.target.files[0] && importFile(event.target.files[0]));
  }
  document.addEventListener("pointerdown", (event) => { if (open && !element.contains(event.target)) { open = false; render(); } }, true);
  render();
});
