/* =========================================================================
 * PHASE 5 — Logique du popup
 * Flux : popup -> content script (extraction) -> API cloud -> rendu.
 * ========================================================================= */

(() => {
  "use strict";

  /* ------------------------------------------------------------- config */
  // API de production : conteneur Docker sur GitHub Codespaces (port 7860 public).
  // En developpement local : "http://localhost:8000".
  const API_BASE = "https://reimagined-space-umbrella-v66j497xvjrwfw4pp-7860.app.github.dev";
  const BATCH_SIZE = 100;
  const TIMEOUT_MS = 20000;

  const LABELS = { "-1": "négatif", "0": "neutre", "1": "positif" };
  const CLASS_OF = { "-1": "neg", "0": "neu", "1": "pos" };

  /* --------------------------------------------------------------- état */
  let state = { predictions: [], statistics: null, video: null, filter: "all", timing: null };

  const $ = (id) => document.getElementById(id);

  /* -------------------------------------------------------------- thème */
  function applyTheme(theme) {
    document.body.dataset.theme = theme;
    chrome.storage.local.set({ theme });
  }
  chrome.storage.local.get(["theme"], (r) => applyTheme(r.theme || "light"));
  $("theme-toggle").addEventListener("click", () =>
    applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark")
  );

  /* --------------------------------------------------------- appels API */
  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkHealth() {
    const el = $("api-status");
    try {
      const res = await fetchWithTimeout(`${API_BASE}/health`);
      const data = await res.json();
      const ok = res.ok && data.model_loaded;
      el.innerHTML = `<span class="dot ${ok ? "dot--ok" : "dot--ko"}"></span>${
        ok ? `API en ligne · v${data.model_version}` : "API dégradée"
      }`;
      return ok;
    } catch {
      el.innerHTML = `<span class="dot dot--ko"></span>API injoignable`;
      return false;
    }
  }

  async function predictBatch(comments) {
    const res = await fetchWithTimeout(`${API_BASE}/predict_batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comments }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  /* ---------------------------------------------- extraction + analyse */
  async function sendToContentScript(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });
  }

  async function analyze() {
    showState("loading");
    $("analyze").disabled = true;
    const t0 = performance.now();

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !/youtube\.com\/watch/.test(tab.url || "")) {
        throw new Error("Ouvrez d'abord une vidéo YouTube (page /watch).");
      }

      // Le content script peut ne pas être injecté si la page était déjà
      // ouverte avant l'installation : on l'injecte à la demande.
      try {
        await sendToContentScript(tab.id, { action: "ping" });
      } catch {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["js/content.js"],
        });
      }

      $("loading-text").textContent = "Extraction des commentaires…";
      const limit = parseInt($("limit").value, 10);
      const extraction = await sendToContentScript(tab.id, {
        action: "extractComments",
        limit,
      });
      if (!extraction || !extraction.ok) {
        throw new Error(extraction?.error || "Extraction impossible.");
      }
      const comments = extraction.comments || [];
      if (comments.length === 0) {
        throw new Error(
          "Aucun commentaire trouvé. Les commentaires sont peut-être désactivés, " +
            "ou la page n'a pas fini de charger."
        );
      }

      // Découpage en lots : évite un payload géant et permet un affichage
      // progressif de la progression.
      const texts = comments.map((c) => c.text);
      const predictions = [];
      let totalMs = 0;
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const chunk = texts.slice(i, i + BATCH_SIZE);
        $("loading-text").textContent =
          `Analyse ${Math.min(i + chunk.length, texts.length)}/${texts.length} commentaires…`;
        const data = await predictBatch(chunk);
        totalMs += data.processing_time_ms;
        data.predictions.forEach((p) =>
          predictions.push({ ...p, index: i + p.index, author: comments[i + p.index]?.author || "" })
        );
      }

      state = {
        predictions,
        statistics: aggregate(predictions),
        video: extraction.video,
        filter: "all",
        timing: {
          api_ms: Math.round(totalMs),
          total_ms: Math.round(performance.now() - t0),
          n: predictions.length,
        },
      };
      render();
      showState("results");
    } catch (err) {
      $("error-text").textContent = err.message || String(err);
      showState("error");
    } finally {
      $("analyze").disabled = false;
    }
  }

  /** Recalcule les statistiques globales sur l'ensemble des lots. */
  function aggregate(predictions) {
    const total = predictions.length;
    const count = (s) => predictions.filter((p) => p.sentiment === s).length;
    const pos = count(1), neu = count(0), neg = count(-1);
    const pct = (n) => (total ? +((100 * n) / total).toFixed(1) : 0);
    const score = total
      ? +(predictions.reduce((s, p) => s + p.sentiment, 0) / total).toFixed(3)
      : 0;
    const dominant = [["positif", pos], ["neutre", neu], ["négatif", neg]]
      .sort((a, b) => b[1] - a[1])[0][0];
    const conf = total
      ? +(predictions.reduce((s, p) => s + p.confidence, 0) / total).toFixed(3)
      : 0;
    return {
      total, positif: pos, neutre: neu, negatif: neg,
      pourcentage_positif: pct(pos), pourcentage_neutre: pct(neu),
      pourcentage_negatif: pct(neg),
      score_global: score, sentiment_dominant: dominant, confiance_moyenne: conf,
    };
  }

  /* ------------------------------------------------------------- rendu */
  function showState(name) {
    ["loading", "error", "results"].forEach((s) =>
      $(s).classList.toggle("hidden", s !== name)
    );
  }

  function render() {
    const s = state.statistics;

    $("video-title").textContent = state.video?.title || "";
    $("video-channel").textContent = state.video?.channel || "";

    $("score-global").textContent = (s.score_global > 0 ? "+" : "") + s.score_global.toFixed(2);
    $("score-global").style.color =
      s.score_global > 0.15 ? "var(--pos)" : s.score_global < -0.15 ? "var(--neg)" : "var(--neu)";
    $("score-label").textContent =
      `Sentiment dominant : ${s.sentiment_dominant}`;

    $("pct-pos").textContent = `${s.pourcentage_positif}%`;
    $("pct-neu").textContent = `${s.pourcentage_neutre}%`;
    $("pct-neg").textContent = `${s.pourcentage_negatif}%`;
    $("n-pos").textContent = `${s.positif} comm.`;
    $("n-neu").textContent = `${s.neutre} comm.`;
    $("n-neg").textContent = `${s.negatif} comm.`;

    $("bar-pos").style.width = `${s.pourcentage_positif}%`;
    $("bar-neu").style.width = `${s.pourcentage_neutre}%`;
    $("bar-neg").style.width = `${s.pourcentage_negatif}%`;

    drawDonut(s);
    renderList();

    $("timing").textContent =
      `${state.timing.n} comm. · API ${state.timing.api_ms} ms · total ${state.timing.total_ms} ms`;
  }

  /** Graphique en anneau dessiné au canvas (aucune librairie externe). */
  function drawDonut(s) {
    const canvas = $("donut");
    const ctx = canvas.getContext("2d");
    const dark = document.body.dataset.theme === "dark";
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cx = 80, cy = 75, r = 55, inner = 34;
    const segments = [
      { v: s.positif, c: "#2a9d8f", name: "Positif" },
      { v: s.neutre, c: "#8d99ae", name: "Neutre" },
      { v: s.negatif, c: "#d1495b", name: "Négatif" },
    ];
    const total = s.total || 1;
    let start = -Math.PI / 2;

    segments.forEach((seg) => {
      if (seg.v === 0) return;
      const angle = (seg.v / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = seg.c;
      ctx.fill();
      start += angle;
    });

    // trou central
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    ctx.fillStyle = dark ? "#e8edf3" : "#16202c";
    ctx.font = "600 15px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(String(s.total), cx, cy + 1);
    ctx.font = "10px system-ui";
    ctx.fillStyle = dark ? "#9aa5b4" : "#697586";
    ctx.fillText("comm.", cx, cy + 14);

    // légende
    ctx.textAlign = "left";
    segments.forEach((seg, i) => {
      const y = 44 + i * 24;
      ctx.fillStyle = seg.c;
      ctx.fillRect(176, y - 8, 10, 10);
      ctx.fillStyle = dark ? "#e8edf3" : "#16202c";
      ctx.font = "11px system-ui";
      ctx.fillText(
        `${seg.name} — ${seg.v} (${((100 * seg.v) / total).toFixed(1)}%)`,
        192, y
      );
    });
  }

  function renderList() {
    const list = $("comment-list");
    const items =
      state.filter === "all"
        ? state.predictions
        : state.predictions.filter((p) => String(p.sentiment) === state.filter);

    list.innerHTML = "";
    if (items.length === 0) {
      list.innerHTML = `<li class="comment"><p class="comment-text">Aucun commentaire dans cette catégorie.</p></li>`;
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((p) => {
      const li = document.createElement("li");
      li.className = `comment comment--${CLASS_OF[String(p.sentiment)]}`;
      const head = document.createElement("div");
      head.className = "comment-head";
      const label = document.createElement("span");
      label.className = "comment-label";
      label.textContent = LABELS[String(p.sentiment)];
      const conf = document.createElement("span");
      conf.className = "comment-conf";
      conf.textContent = `${(p.confidence * 100).toFixed(0)}% de confiance`;
      head.append(label, conf);
      const text = document.createElement("p");
      text.className = "comment-text";
      text.textContent = p.text;        // textContent = pas d'injection HTML
      li.append(head, text);
      frag.appendChild(li);
    });
    list.appendChild(frag);
  }

  /* ------------------------------------------------------------ filtres */
  $("filters").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    document.querySelectorAll(".chip").forEach((c) => c.classList.remove("chip--active"));
    btn.classList.add("chip--active");
    state.filter = btn.dataset.filter;
    renderList();
  });

  /* ------------------------------------------------- copier / exporter */
  $("copy").addEventListener("click", async () => {
    const s = state.statistics;
    const txt =
      `Analyse de sentiment — ${state.video?.title || "vidéo YouTube"}\n` +
      `${s.total} commentaires analysés\n` +
      `Positif : ${s.positif} (${s.pourcentage_positif}%)\n` +
      `Neutre  : ${s.neutre} (${s.pourcentage_neutre}%)\n` +
      `Négatif : ${s.negatif} (${s.pourcentage_negatif}%)\n` +
      `Score global : ${s.score_global} — dominante : ${s.sentiment_dominant}\n` +
      `Confiance moyenne : ${(s.confiance_moyenne * 100).toFixed(1)}%\n` +
      `URL : ${state.video?.url || ""}`;
    await navigator.clipboard.writeText(txt);
    $("copy").textContent = "Copié !";
    setTimeout(() => ($("copy").textContent = "Copier le résumé"), 1500);
  });

  $("export").addEventListener("click", () => {
    const payload = {
      video: state.video,
      statistics: state.statistics,
      predictions: state.predictions,
      timing: state.timing,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sentiment_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  /* ------------------------------------------------------------- init */
  $("analyze").addEventListener("click", analyze);
  $("retry").addEventListener("click", analyze);
  checkHealth();
})();
