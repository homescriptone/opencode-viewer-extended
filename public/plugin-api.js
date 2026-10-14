(function () {
  "use strict";

  const partRenderers = new Map();
  const exportFormats = [];
  const sessionActions = [];

  function registerPartRenderer(type, renderer) {
    if (typeof type !== "string" || typeof renderer !== "function") return;
    partRenderers.set(type.toLowerCase(), renderer);
  }

  function getPartRenderer(type) {
    return partRenderers.get(String(type ?? "").toLowerCase()) || null;
  }

  function registerExportFormat(format) {
    if (!format || typeof format.build !== "function") return;
    exportFormats.push(format);
  }

  function listExportFormats() {
    return exportFormats.slice();
  }

  function registerSessionAction(action) {
    if (!action || typeof action.handler !== "function") return;
    sessionActions.push(action);
  }

  function listSessionActions() {
    return sessionActions.slice();
  }

  window.OCV = {
    version: "1",
    registerPartRenderer,
    getPartRenderer,
    registerExportFormat,
    listExportFormats,
    registerSessionAction,
    listSessionActions,
    helpers: {},
  };
})();
