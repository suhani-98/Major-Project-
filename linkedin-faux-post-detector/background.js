// background.js (MV3 service worker)

const DEFAULT_CONFIG = {
  apiBaseUrl: "http://localhost:8000",
  threshold: 0.50,
  apiKey: "" // optional if your server needs it
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["cfg"], ({ cfg }) => {
      resolve({ ...DEFAULT_CONFIG, ...(cfg || {}) });
    });
  });
}

async function setConfig(partial) {
  const current = await getConfig();
  const merged = { ...current, ...partial };
  return new Promise((resolve) => {
    chrome.storage.local.set({ cfg: merged }, () => resolve(merged));
  });
}

async function getCache(hash) {
  return new Promise((resolve) => {
    chrome.storage.local.get([`cache:${hash}`], (obj) => {
      const item = obj[`cache:${hash}`];
      if (!item) return resolve(null);
      if (Date.now() - item.ts > CACHE_TTL_MS) return resolve(null);
      resolve(item.data);
    });
  });
}

async function setCache(hash, data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [`cache:${hash}`]: { ts: Date.now(), data } }, () => resolve());
  });
}

// Initialize defaults on install
chrome.runtime.onInstalled.addListener(async () => {
  await setConfig({});
  console.log("[LFPD] Installed. Default config set.");
});

// Message router
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "getConfig") {
        const cfg = await getConfig();
        sendResponse({ ok: true, cfg });
      }

      else if (msg?.type === "setConfig") {
        const cfg = await setConfig(msg.payload || {});
        sendResponse({ ok: true, cfg });
      }

      else if (msg?.type === "predict") {
        const { text, hash } = msg.payload || {};
        if (!text) return sendResponse({ ok: false, error: "No text" });

        // cache check
        const cached = hash ? await getCache(hash) : null;
        if (cached) {
          return sendResponse({ ok: true, fromCache: true, ...cached });
        }

        const cfg = await getConfig();
        const url = `${cfg.apiBaseUrl.replace(/\/+$/, "")}/predict`;
        const body = { text, threshold: cfg.threshold };
        const headers = { "Content-Type": "application/json" };
        if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;

        const resp = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        });

        if (!resp.ok) {
          const t = await resp.text().catch(() => "");
          throw new Error(`Predict failed ${resp.status}: ${t}`);
        }

        const data = await resp.json();
        const result = { result: data, cfg };
        if (hash) await setCache(hash, result);
        sendResponse({ ok: true, ...result });
      }

      else if (msg?.type === "feedback") {
        const { text, our_label, user_label, prob_fake, model_version, signals } = msg.payload || {};
        const cfg = await getConfig();
        const url = `${cfg.apiBaseUrl.replace(/\/+$/, "")}/feedback`;
        const headers = { "Content-Type": "application/json" };
        if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;

        // graceful if /feedback not implemented on server
        try {
          const resp = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              text, our_label, user_label, prob_fake, model_version, signals,
              context: { ts: Date.now() }
            })
          });
          const out = resp.ok ? await resp.json() : { status: "queued_local" };
          sendResponse({ ok: true, data: out });
        } catch (e) {
          console.warn("[LFPD] Feedback send failed, ignoring.", e);
          sendResponse({ ok: false, error: String(e) });
        }
      }

      else {
        sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (err) {
      console.error("[LFPD] background error:", err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  // Keep the sendResponse channel open for async
  return true;
});
