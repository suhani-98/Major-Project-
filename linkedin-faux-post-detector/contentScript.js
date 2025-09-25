// contentScript.js

const BTN_LABEL = "Scan";
const WRONG_LABEL = "Wrong?";
const FLAG_ATTR = "data-lfpd-injected"; // custom attribute to avoid re-inject

const log = (...a) => console.log("[LFPD]", ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Hash for caching key
async function sha256Hex(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Extract only visible text + links from the post CONTENT (not from injected bar)
function extractPostData(article) {
  // Prefer content blocks; fallback to the whole article
  const content =
    article.querySelector('[data-test-reusable-feed-message]') ||            // new feed message
    article.querySelector('.feed-shared-update-v2__commentary') ||           // legacy
    article.querySelector('[data-test-id="feed-container"]') ||              // alt
    article;

  // Exclude our own injected UI during extraction
  const cloned = content.cloneNode(true);
  cloned.querySelectorAll(".lfpd-bar,.lfpd-dialog").forEach(el => el.remove());

  const text = (cloned.innerText || cloned.textContent || "").trim();

  const hrefs = Array.from(article.querySelectorAll("a[href]"))
    .filter(a => !a.closest(".lfpd-bar,.lfpd-dialog")) // ignore our UI links
    .map(a => a.getAttribute("href"))
    .filter(Boolean);

  return { text, hrefs, hashInput: text + "\n" + hrefs.join("\n") };
}

// Build and inject the UI row
function injectUi(article) {
  if (!article || article.getAttribute(FLAG_ATTR) === "1") return;
  article.setAttribute(FLAG_ATTR, "1");

  const bar = document.createElement("div");
  bar.className = "lfpd-bar";

  const btn = document.createElement("button");
  btn.className = "lfpd-btn";
  btn.textContent = BTN_LABEL;

  const chip = document.createElement("span");
  chip.className = "lfpd-chip lfpd-chip-idle";
  chip.textContent = "—";

  const wrong = document.createElement("button");
  wrong.className = "lfpd-wrong";
  wrong.textContent = WRONG_LABEL;
  wrong.style.display = "none";

  bar.appendChild(btn);
  bar.appendChild(chip);
  bar.appendChild(wrong);

  // Pick a good insertion point; fallback to article end
  const insertionPoint =
    article.querySelector('[data-test-id*="social-actions"]') ||   // new UI actions row
    article.querySelector('[data-test-reusable-feed-action]') ||
    article.querySelector('[data-urn]') ||
    article;

  insertionPoint.appendChild(bar);

  // Click handler
  btn.addEventListener("click", async () => {
    try {
      btn.disabled = true;
      btn.textContent = "Scanning…";
      chip.className = "lfpd-chip lfpd-chip-loading";
      chip.textContent = "…";
      wrong.style.display = "none";

      const { text, hashInput } = extractPostData(article);
      if (!text || text.length < 5) {
        chip.className = "lfpd-chip lfpd-chip-warn";
        chip.textContent = "No text";
        btn.disabled = false;
        btn.textContent = BTN_LABEL;
        return;
      }
      const hash = await sha256Hex(hashInput);

      chrome.runtime.sendMessage({ type: "predict", payload: { text, hash } }, (resp) => {
        if (!resp || !resp.ok) {
          chip.className = "lfpd-chip lfpd-chip-error";
          chip.textContent = "Error";
          console.error("[LFPD] predict error:", resp?.error);
          btn.disabled = false;
          btn.textContent = BTN_LABEL;
          return;
        }
        const { result } = resp;
        renderResult(chip, result);
        wrong.style.display = "inline-block";
        wrong.onclick = () => openFeedbackDialog(article, result, text);
        btn.disabled = false;
        btn.textContent = BTN_LABEL;
      });
    } catch (e) {
      console.error("[LFPD] scan failed:", e);
      chip.className = "lfpd-chip lfpd-chip-error";
      chip.textContent = "Error";
      btn.disabled = false;
      btn.textContent = BTN_LABEL;
    }
  });
}

// Render Fake/Real chip
function renderResult(chip, result) {
  const label = result?.label ?? result?.result?.label ?? "";
  const probFake = result?.prob_fake ?? result?.result?.prob_fake ?? 0;
  const conf = Math.round((label === "fake" ? probFake : 1 - probFake) * 100);

  if (label === "fake") {
    chip.className = "lfpd-chip lfpd-chip-fake";
    chip.textContent = `Fake • ${conf}%`;
  } else if (label === "real") {
    chip.className = "lfpd-chip lfpd-chip-real";
    chip.textContent = `Real • ${conf}%`;
  } else {
    chip.className = "lfpd-chip lfpd-chip-warn";
    chip.textContent = "Unknown";
  }
}

// Lightweight feedback dialog
function openFeedbackDialog(article, result, text) {
  const prev = article.querySelector(".lfpd-dialog");
  if (prev) prev.remove();

  const dlg = document.createElement("div");
  dlg.className = "lfpd-dialog";
  dlg.innerHTML = `
    <div class="lfpd-dialog-card">
      <div class="lfpd-dialog-title">Was this prediction wrong?</div>
      <div class="lfpd-dialog-buttons">
        <button class="lfpd-fb-real">Correct is REAL</button>
        <button class="lfpd-fb-fake">Correct is FAKE</button>
      </div>
      <button class="lfpd-dialog-close">×</button>
    </div>
  `;

  dlg.querySelector(".lfpd-dialog-close").onclick = () => dlg.remove();
  dlg.querySelector(".lfpd-fb-real").onclick = () => { sendFeedback(result, "real", text); dlg.remove(); };
  dlg.querySelector(".lfpd-fb-fake").onclick = () => { sendFeedback(result, "fake", text); dlg.remove(); };

  article.appendChild(dlg);
}

function sendFeedback(result, userLabel, text) {
  const payload = {
    text,
    our_label: result.label,
    user_label: userLabel,
    prob_fake: result.prob_fake ?? 0,
    model_version: result.model_version || "v1",
    signals: (result.top_signals || [])
  };
  chrome.runtime.sendMessage({ type: "feedback", payload }, (resp) => {
    log("feedback resp:", resp);
  });
}

// Find LinkedIn posts (robust-ish set of selectors)
function getAllPosts(root = document) {
  const roleArticles = Array.from(root.querySelectorAll('article[role="article"]'));
  const dataUrn = Array.from(root.querySelectorAll('div[data-urn*="urn:li:activity"]'));
  const legacy = Array.from(root.querySelectorAll('div.feed-shared-update-v2, div.feed-shared-update-v3'));
  const set = new Set([...roleArticles, ...dataUrn, ...legacy]);
  return Array.from(set).filter(Boolean);
}

// Observe feed for infinite scroll content
function observeFeed() {
  const process = () => {
    const posts = getAllPosts();
    log("found posts:", posts.length);
    posts.forEach(p => injectUi(p));
  };

  process(); // initial batch

  const obs = new MutationObserver((muts) => {
    // inject for newly added subtrees
    for (const m of muts) {
      for (const n of m.addedNodes || []) {
        if (n.nodeType !== 1) continue;
        const posts = getAllPosts(n);
        if (posts.length) {
          log("injecting new posts:", posts.length);
          posts.forEach(p => injectUi(p));
        }
      }
    }
  });

  obs.observe(document.body, { childList: true, subtree: true });
}

(async function init() {
  log("content script init");
  // Wait for body & initial feed DOM
  for (let i = 0; i < 50 && !document.body; i++) await sleep(100);
  observeFeed();
})();
