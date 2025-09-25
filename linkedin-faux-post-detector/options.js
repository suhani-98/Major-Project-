function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["cfg"], ({ cfg }) => {
      const merged = {
        apiBaseUrl: "http://localhost:8000",
        threshold: 0.50,
        apiKey: "",
        ...(cfg || {})
      };
      resolve(merged);
    });
  });
}

function setConfig(cfg) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ cfg }, () => resolve(cfg));
  });
}

async function init() {
  const cfg = await getConfig();
  document.getElementById("apiBaseUrl").value = cfg.apiBaseUrl;
  document.getElementById("threshold").value = cfg.threshold;
  document.getElementById("apiKey").value = cfg.apiKey;
}

document.getElementById("saveBtn").addEventListener("click", async () => {
  const apiBaseUrl = document.getElementById("apiBaseUrl").value.trim();
  const threshold = parseFloat(document.getElementById("threshold").value);
  const apiKey = document.getElementById("apiKey").value.trim();

  if (!apiBaseUrl) return showStatus("Please enter API Base URL", true);
  if (isNaN(threshold) || threshold < 0 || threshold > 1) return showStatus("Invalid threshold", true);

  await setConfig({ apiBaseUrl, threshold, apiKey });
  showStatus("Saved ", false);
});

document.getElementById("testBtn").addEventListener("click", async () => {
  const cfg = await getConfig();
  try {
    const resp = await fetch(cfg.apiBaseUrl.replace(/\/+$/, "") + "/health");
    if (!resp.ok) throw new Error(resp.statusText);
    const js = await resp.json();
    showStatus(`OK: ${JSON.stringify(js)}`, false);
  } catch (e) {
    showStatus("Failed: " + e.message, true);
  }
});

function showStatus(msg, isErr) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = isErr ? "err" : "ok";
}

init();
