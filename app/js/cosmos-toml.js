(function () {
  const cfg = window.COSMOSDEX_CONFIG || {};
  const state = {
    loaded: false,
    source: "",
    raw: "",
    parsed: null,
    normalized: null,
    validation: null,
    trust: null
  };

  function getMetadataConfig() {
    return cfg?.metadata || {};
  }

  function getSources() {
    const sources = getMetadataConfig().sources;
    return Array.isArray(sources) && sources.length ? sources : ["/.well-known/cosmos.toml", "/cosmos.toml"];
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
    return res.text();
  }

  function normalize(parsed) {
    return {
      version: parsed.VERSION || "",
      network: parsed.NETWORK || "cosmos",
      projectName: parsed.PROJECT_NAME || "",
      projectUrl: parsed.PROJECT_URL || "",
      description: parsed.DESCRIPTION || "",
      icon: parsed.ICON || "",
      org: parsed.ORG || {},
      verification: parsed.VERIFICATION || {},
      chains: Array.isArray(parsed.CHAINS) ? parsed.CHAINS : [],
      apps: Array.isArray(parsed.APPS) ? parsed.APPS : [],
      assets: Array.isArray(parsed.ASSETS) ? parsed.ASSETS : [],
      markets: Array.isArray(parsed.MARKETS) ? parsed.MARKETS : []
    };
  }

  function validateUrl(url) {
    return typeof url === "string" && /^https:\/\//.test(url);
  }

  function validate(normalized) {
    const errors = [];
    const warnings = [];

    if (!normalized.version) errors.push("Missing VERSION");
    if (!normalized.projectName) errors.push("Missing PROJECT_NAME");
    if (!normalized.projectUrl) errors.push("Missing PROJECT_URL");
    if (normalized.projectUrl && !validateUrl(normalized.projectUrl)) warnings.push("PROJECT_URL should use https://");

    normalized.assets.forEach((asset, index) => {
      const prefix = `ASSETS[${index}]`;
      if (!asset.TYPE) errors.push(`${prefix}: missing TYPE`);
      if (!asset.CHAIN_ID) errors.push(`${prefix}: missing CHAIN_ID`);
      if (!asset.SYMBOL) errors.push(`${prefix}: missing SYMBOL`);
      if (!asset.NAME) errors.push(`${prefix}: missing NAME`);
      if (asset.DECIMALS === undefined) errors.push(`${prefix}: missing DECIMALS`);
      if ((asset.TYPE === "native" || asset.TYPE === "ibc") && !asset.DENOM) {
        errors.push(`${prefix}: native/ibc asset missing DENOM`);
      }
      if (asset.TYPE === "cw20" && !asset.CONTRACT_ADDRESS) {
        errors.push(`${prefix}: cw20 asset missing CONTRACT_ADDRESS`);
      }
      if (asset.LOGO && !validateUrl(asset.LOGO)) {
        warnings.push(`${prefix}: LOGO should use https://`);
      }
    });

    const seen = new Set();
    normalized.assets.forEach((asset, index) => {
      const id = `${asset.CHAIN_ID || "?"}:${asset.TYPE || "?"}:${asset.CONTRACT_ADDRESS || asset.DENOM || asset.SYMBOL || index}`;
      if (seen.has(id)) warnings.push(`Duplicate asset declaration: ${id}`);
      seen.add(id);
    });

    return { valid: errors.length === 0, errors, warnings };
  }

  function scoreTrust(normalized, validation) {
    let score = 0;
    const reasons = [];
    const caution = [];

    if (validation.valid) { score += 25; reasons.push("Valid cosmos.toml structure"); }
    else { caution.push("Metadata file has structural errors"); }

    if (normalized.projectUrl && validateUrl(normalized.projectUrl)) { score += 10; reasons.push("Project URL uses HTTPS"); }
    if (normalized.org && normalized.org.URL && validateUrl(normalized.org.URL)) { score += 10; reasons.push("Organization URL declared"); }
    if (normalized.verification && normalized.verification.DOMAIN_VERIFIED === true) { score += 10; reasons.push("Domain verification claimed"); }
    if (Array.isArray(normalized.assets) && normalized.assets.length) { score += 10; reasons.push("Assets declared"); }
    if (Array.isArray(normalized.chains) && normalized.chains.length) { score += 10; reasons.push("Chains declared"); }
    if (normalized.verification && Array.isArray(normalized.verification.AUDIT_URLS) && normalized.verification.AUDIT_URLS.length) {
      score += 10; reasons.push("Audit links declared");
    }
    if (validation.warnings.length === 0) { score += 5; reasons.push("No metadata warnings"); }

    const extraScrutiny = normalized.assets.filter((asset) => asset.REQUIRES_EXTRA_SCRUTINY === true);
    if (extraScrutiny.length) {
      score -= Math.min(extraScrutiny.length * 5, 20);
      caution.push(`${extraScrutiny.length} asset(s) marked as requiring extra scrutiny`);
    }

    score = Math.max(0, Math.min(100, score));

    const metadata = getMetadataConfig();
    let tier = "unverified";
    if (score >= Number(metadata.minimumTrustScoreVerified || 80)) tier = "verified";
    else if (score >= Number(metadata.minimumTrustScoreKnown || 55)) tier = "known";
    else if (score >= 30) tier = "caution";
    else tier = "unverified";

    return { score, tier, reasons, caution };
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function trustLabel(trust) {
    if (!trust) return "Unknown";
    if (trust.tier === "verified") return `Verified (${trust.score})`;
    if (trust.tier === "known") return `Known (${trust.score})`;
    if (trust.tier === "caution") return `Caution (${trust.score})`;
    return `Unverified (${trust.score})`;
  }

  function renderMetadata() {
    const normalized = state.normalized;
    const validation = state.validation;
    const trust = state.trust;

    const statusEl = document.getElementById("metadataStatus");
    if (statusEl) {
      statusEl.textContent = state.loaded
        ? `Loaded from ${state.source}`
        : "No cosmos.toml metadata loaded";
    }

    const trustEl = document.getElementById("metadataTrustBadge");
    if (trustEl) {
      trustEl.textContent = trustLabel(trust);
      trustEl.className = `trust-badge ${trust ? trust.tier : "unknown"}`;
    }

    const projectEl = document.getElementById("metadataProject");
    if (projectEl) {
      if (normalized) {
        projectEl.innerHTML = `<strong>${escapeHtml(normalized.projectName || "Unknown Project")}</strong><br><span class="muted">${escapeHtml(normalized.description || "No description")}</span>`;
      } else {
        projectEl.textContent = "-";
      }
    }

    const summaryEl = document.getElementById("metadataSummary");
    if (summaryEl) {
      if (normalized && validation && trust) {
        summaryEl.innerHTML = `
          <ul class="meta-list compact">
            <li><span>Source</span><strong>${escapeHtml(state.source)}</strong></li>
            <li><span>Version</span><strong>${escapeHtml(normalized.version || "-")}</strong></li>
            <li><span>Assets</span><strong>${normalized.assets.length}</strong></li>
            <li><span>Chains</span><strong>${normalized.chains.length}</strong></li>
            <li><span>Trust Tier</span><strong>${escapeHtml(trust.tier)}</strong></li>
          </ul>
        `;
      } else {
        summaryEl.textContent = "No metadata summary available yet.";
      }
    }

    const issuesEl = document.getElementById("metadataIssues");
    if (issuesEl) {
      if (validation) {
        const rows = [];
        validation.errors.forEach((item) => rows.push(`<li class="issue error">${escapeHtml(item)}</li>`));
        validation.warnings.forEach((item) => rows.push(`<li class="issue warning">${escapeHtml(item)}</li>`));
        if (trust) trust.caution.forEach((item) => rows.push(`<li class="issue warning">${escapeHtml(item)}</li>`));
        issuesEl.innerHTML = rows.length ? `<ul class="issue-list">${rows.join("")}</ul>` : "No validation issues.";
      } else {
        issuesEl.textContent = "No validation issues loaded.";
      }
    }

    const assetsEl = document.getElementById("metadataAssets");
    if (assetsEl) {
      if (normalized && normalized.assets.length) {
        assetsEl.innerHTML = normalized.assets.map((asset) => {
          const ident = asset.TYPE === "cw20" ? asset.CONTRACT_ADDRESS : asset.DENOM;
          const scrutiny = asset.REQUIRES_EXTRA_SCRUTINY === true ? '<span class="pill caution">extra scrutiny</span>' : '';
          const status = asset.STATUS ? `<span class="pill">${escapeHtml(asset.STATUS)}</span>` : '';
          return `
            <div class="asset-row">
              <div>
                <strong>${escapeHtml(asset.SYMBOL || "?")}</strong>
                <div class="muted small">${escapeHtml(asset.NAME || "Unnamed asset")}</div>
                <div class="muted tiny">${escapeHtml(ident || "No identifier")}</div>
              </div>
              <div class="asset-tags">${status}${scrutiny}</div>
            </div>
          `;
        }).join('');
      } else {
        assetsEl.textContent = "No asset metadata loaded.";
      }
    }

    const rawEl = document.getElementById("metadataRaw");
    if (rawEl) {
      rawEl.textContent = state.raw || "-";
    }
  }

  async function loadCosmosToml() {
    if (getMetadataConfig().enabled === false) {
      renderMetadata();
      return null;
    }

    const parser = window.CosmosTomlParser;
    if (!parser || typeof parser.parse !== "function") {
      throw new Error("CosmosTomlParser is not available.");
    }

    let lastError = null;

    for (const source of getSources()) {
      try {
        const raw = await fetchText(source);
        const parsed = parser.parse(raw);
        const normalized = normalize(parsed);
        const validation = validate(normalized);
        const trust = scoreTrust(normalized, validation);
        state.loaded = true;
        state.source = source;
        state.raw = raw;
        state.parsed = parsed;
        state.normalized = normalized;
        state.validation = validation;
        state.trust = trust;
        renderMetadata();
        document.dispatchEvent(new CustomEvent("cosmdex:metadata-loaded", {
          detail: { source, normalized, validation, trust }
        }));
        return { source, normalized, validation, trust };
      } catch (err) {
        lastError = err;
      }
    }

    state.loaded = false;
    state.source = "";
    state.raw = "";
    state.parsed = null;
    state.normalized = null;
    state.validation = lastError ? { valid: false, errors: [lastError.message], warnings: [] } : null;
    state.trust = lastError ? { score: 0, tier: "unverified", reasons: [], caution: [lastError.message] } : null;
    renderMetadata();
    if (lastError) throw lastError;
    return null;
  }

  function getMetadataState() {
    return { ...state };
  }

  function init() {
    loadCosmosToml().catch((err) => console.error("cosmos.toml load failed:", err));
  }

  window.CosmosTomlSystem = {
    init,
    loadCosmosToml,
    getMetadataState
  };

  window.addEventListener("DOMContentLoaded", init);
})();
