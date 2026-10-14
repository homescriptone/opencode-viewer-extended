(function () {
  "use strict";

  const STORAGE_KEY = "ocv.plugins.disabled";

  const plugins = new Map();
  const partRenderers = new Map();
  const exportFormats = [];
  const sessionActions = [];
  const bulkActions = [];

  let hostImpl = {};
  let readyResolve = null;
  const readyPromise = new Promise((resolve) => {
    readyResolve = resolve;
  });

  function readDisabled() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  }

  const disabled = readDisabled();

  function persistDisabled() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...disabled]));
    } catch {
      /* storage unavailable */
    }
  }

  function makeApi(id) {
    const cleanups = [];

    const track = (arr, item) => {
      const remove = () => {
        const index = arr.indexOf(item);
        if (index >= 0) arr.splice(index, 1);
      };
      cleanups.push(remove);
      return remove;
    };

    return {
      id,
      get host() {
        return hostImpl;
      },
      registerPartRenderer(type, renderer) {
        const key = String(type ?? "").toLowerCase();
        partRenderers.set(key, renderer);
        const remove = () => {
          if (partRenderers.get(key) === renderer) partRenderers.delete(key);
        };
        cleanups.push(remove);
        return remove;
      },
      registerExportFormat(format) {
        if (!format || typeof format.build !== "function") return () => {};
        exportFormats.push(format);
        return track(exportFormats, format);
      },
      registerSessionAction(action) {
        if (!action || typeof action.handler !== "function") return () => {};
        sessionActions.push(action);
        return track(sessionActions, action);
      },
      registerBulkAction(action) {
        if (!action || typeof action.handler !== "function") return () => {};
        bulkActions.push(action);
        return track(bulkActions, action);
      },
      _cleanups: cleanups,
    };
  }

  function define(def) {
    if (!def || typeof def.id !== "string" || typeof def.setup !== "function") {
      console.warn("[OCV] define() ignored: needs { id, name?, setup }", def);
      return;
    }
    plugins.set(def.id, { def, enabled: false, cleanups: [], api: null });
  }

  function enable(id) {
    const entry = plugins.get(id);
    if (!entry || entry.enabled) return;
    const api = makeApi(id);
    entry.api = api;
    entry.enabled = true;
    try {
      const extra = entry.def.setup(api);
      if (Array.isArray(extra)) api._cleanups.push(...extra);
    } catch (error) {
      console.error(`[OCV] plugin "${id}" setup failed:`, error);
    }
    entry.cleanups = api._cleanups;
  }

  function disable(id) {
    const entry = plugins.get(id);
    if (!entry || !entry.enabled) return;
    for (const cleanup of entry.cleanups) {
      try {
        cleanup();
      } catch (error) {
        console.error(`[OCV] plugin "${id}" cleanup failed:`, error);
      }
    }
    entry.cleanups = [];
    try {
      entry.def.teardown?.(entry.api);
    } catch (error) {
      console.error(`[OCV] plugin "${id}" teardown failed:`, error);
    }
    entry.enabled = false;
    entry.api = null;
  }

  function setEnabled(id, value) {
    if (value) {
      disabled.delete(id);
      enable(id);
    } else {
      disabled.add(id);
      disable(id);
    }
    persistDisabled();
    hostImpl.onPluginsChanged?.();
  }

  function listPlugins() {
    return [...plugins.values()].map((entry) => ({
      id: entry.def.id,
      name: entry.def.name || entry.def.id,
      description: entry.def.description || "",
      enabled: entry.enabled,
    }));
  }

  function activateAll() {
    for (const [id] of plugins) {
      if (!disabled.has(id)) enable(id);
    }
  }

  // Minimal ZIP writer (store method, no compression) so plugins can bundle
  // multiple JSON files into one download without any dependency.
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function createZip(entries) {
    const encoder = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(String(entry.name));
      const dataBytes = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
      const crc = crc32(dataBytes);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, dataBytes.length, true);
      lv.setUint32(22, dataBytes.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      chunks.push(local, dataBytes);

      const record = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(record.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, dataBytes.length, true);
      cv.setUint32(24, dataBytes.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      record.set(nameBytes, 46);
      central.push(record);

      offset += local.length + dataBytes.length;
    }

    let centralSize = 0;
    for (const record of central) centralSize += record.length;

    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob([...chunks, ...central, end], { type: "application/zip" });
  }

  window.OCV = {
    version: "2",
    define,
    setEnabled,
    isEnabled: (id) => Boolean(plugins.get(id)?.enabled),
    list: listPlugins,
    ready: () => readyPromise,
    get host() {
      return hostImpl;
    },
    getPartRenderer: (type) => partRenderers.get(String(type ?? "").toLowerCase()) || null,
    listExportFormats: () => exportFormats.slice(),
    listSessionActions: () => sessionActions.slice(),
    listBulkActions: () => bulkActions.slice(),
    helpers: { createZip },
    _registerHost(impl) {
      hostImpl = impl;
    },
    _activateAll: activateAll,
    _markReady: () => readyResolve(),
  };
})();
