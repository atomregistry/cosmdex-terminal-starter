(function () {
    const cfg = window.COSMOSDEX_CONFIG || {};

    const state = {
        orderbookLoaded: false,
        orderbookConfig: null,
        markets: [],
        marketBook: null,
        userOrders: [],
        lastOrderPreview: null,

        assetRegistry: [],
        assetRegistryByKey: new Map(),
        loadedSources: []
    };

    function isPlaceholder(value) {
        return !value || String(value).includes("REPLACE_WITH");
    }

    function getOrderbookAddress() {
        return cfg?.contracts?.orderbook || "";
    }

    function getRestBase() {
        return (cfg?.network?.rest || "").replace(/\/+$/, "");
    }

    function getAssets() {
        return Array.isArray(cfg.assets) ? cfg.assets : [];
    }

    function getUiConfig() {
        return cfg?.ui || {};
    }

    function getExecutionConfig() {
        return cfg?.execution || {};
    }

    function getMetadataConfig() {
        return cfg?.metadata || {};
    }

    function getOrderbookConfig() {
        return cfg?.orderbook || {};
    }

    function getExplorerTxUrl(txHash) {
        const base = cfg?.network?.explorerTxBase || "";
        if (!base || !txHash) return "";
        return `${base}${txHash}`;
    }

    function assetToValue(asset) {
        if (!asset) return "";
        if (asset.type === "native") return `native:${asset.denom}`;
        if (asset.type === "cw20") return `cw20:${asset.contract}`;
        return "";
    }

    function assetToInfo(asset) {
        if (!asset) return null;
        if (asset.type === "native") return { native_token: { denom: asset.denom } };
        if (asset.type === "cw20") return { token: { contract_addr: asset.contract } };
        return null;
    }

    function parseAssetValue(value) {
        if (!value || typeof value !== "string") return null;

        const idx = value.indexOf(":");
        if (idx === -1) return null;

        const kind = value.slice(0, idx);
        const raw = value.slice(idx + 1);

        if (!kind || !raw) return null;
        if (kind === "native") return { type: "native", denom: raw };
        if (kind === "cw20") return { type: "cw20", contract: raw };

        return null;
    }

    function assetKey(asset) {
        if (!asset) return "";
        if (asset.type === "native") return `native:${asset.denom}`;
        if (asset.type === "cw20") return `cw20:${asset.contract}`;
        return "";
    }

    function marketKeyForAssets(baseAsset, quoteAsset) {
        if (!baseAsset || !quoteAsset) return "";
        return `${assetKey(baseAsset)}__${assetKey(quoteAsset)}`;
    }

    function normalizeDomain(input) {
        const raw = String(input || "").trim().toLowerCase();
        if (!raw) return "";
        return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    }

    function inferNativeLabelFromDenom(denom) {
        if (!denom) return "ASSET";
        if (denom === "uatom") return "ATOM";
        if (denom.startsWith("factory/")) {
            const parts = denom.split("/");
            return (parts[2] || "TOKEN").toUpperCase();
        }
        if (denom.startsWith("ibc/")) {
            return `IBC-${denom.slice(4, 10).toUpperCase()}`;
        }
        return denom.toUpperCase();
    }

    function cloneAsset(asset) {
        return JSON.parse(JSON.stringify(asset));
    }

    function addAssetToRegistry(asset, source = "config") {
        if (!asset) return null;

        const normalized = cloneAsset(asset);
        normalized.source = normalized.source || source;
        normalized.trust = normalized.trust || "unknown";

        const key = assetKey(normalized);
        if (!key) return null;

        if (!state.assetRegistryByKey.has(key)) {
            state.assetRegistry.push(normalized);
            state.assetRegistryByKey.set(key, normalized);
            return normalized;
        }

        const existing = state.assetRegistryByKey.get(key);
        Object.assign(existing, normalized);
        return existing;
    }

    function seedAssetRegistry() {
        state.assetRegistry = [];
        state.assetRegistryByKey = new Map();
        state.loadedSources = [];

        getAssets().forEach((asset) => {
            addAssetToRegistry(asset, "config");
        });

        renderLoadedAssetsTable();
        updateLoadedAssetCount();
    }

    function getRegistryAssets() {
        return Array.isArray(state.assetRegistry) ? state.assetRegistry : [];
    }

    function findAssetByValue(value) {
        const parsed = parseAssetValue(value);
        if (!parsed) return null;

        return getRegistryAssets().find((asset) => {
            if (parsed.type === "native") {
                return asset.type === "native" && asset.denom === parsed.denom;
            }
            return asset.type === "cw20" && asset.contract === parsed.contract;
        }) || null;
    }

    function findAssetById(id) {
        if (!id) return null;
        return getRegistryAssets().find((asset) => asset.id === id) || null;
    }

    function findAssetBySymbol(symbol) {
        const target = String(symbol || "").trim().toUpperCase();
        if (!target) return [];
        return getRegistryAssets().filter((asset) => String(asset.symbol || asset.label || "").toUpperCase() === target);
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function setHTML(id, value) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = value;
    }

    function setStatus(message, isError = false) {
        const el = document.getElementById("tradeStatus");
        if (!el) return;
        el.textContent = message;
        el.style.color = isError ? "#ff6b6b" : "";
    }

    function clearTradeOutputs() {
        setText("quoteOut", "-");
        setText("quoteFee", "-");
        setText("quotePair", "-");
        setText("simResponseView", "-");
        setText("bestBidView", "-");
        setText("bestAskView", "-");
        setText("spreadView", "-");
        setText("orderAmountView", "-");
        setText("settlementAssetView", "-");
    }

    function formatJson(value) {
        try {
            return JSON.stringify(value, null, 2);
        } catch (_err) {
            return String(value);
        }
    }

    function formatAmount(raw, decimals) {
        const n = Number(raw || 0);
        const d = Number(decimals || 6);
        if (!Number.isFinite(n)) return "-";
        return (n / Math.pow(10, d)).toFixed(Math.min(d, 6));
    }

    function parseInputToBaseUnits(input, decimals) {
        const value = String(input || "").trim();
        if (!value) return "0";
        if (!/^\d*\.?\d*$/.test(value)) return "0";

        const parts = value.split(".");
        const whole = parts[0] || "0";
        const frac = (parts[1] || "").slice(0, decimals).padEnd(decimals, "0");
        const combined = `${whole}${frac}`.replace(/^0+(?=\d)/, "");

        return combined || "0";
    }

    function priceToRatio(priceInput, quoteDecimals) {
        const value = String(priceInput || "").trim();
        if (!value || !/^\d*\.?\d*$/.test(value)) {
            return { price_num: "1", price_denom: "1" };
        }

        const decimals = Number.isFinite(Number(quoteDecimals)) ? Number(quoteDecimals) : 6;
        const num = parseInputToBaseUnits(value, decimals);
        const denom = String(Math.pow(10, decimals));
        return {
            price_num: num === "0" ? "1" : num,
            price_denom: denom
        };
    }

    function comparePriceObjects(buyOrder, sellOrder) {
        const bid = Number(buyOrder?.price_num || 0) / Number(buyOrder?.price_denom || 1);
        const ask = Number(sellOrder?.price_num || 0) / Number(sellOrder?.price_denom || 1);
        if (!Number.isFinite(bid) || !Number.isFinite(ask)) return "-";
        return Math.max(ask - bid, 0).toFixed(6);
    }

    function assetsMatch(a, b) {
        if (!a || !b) return false;
        if (a.type !== b.type) return false;
        if (a.type === "native") return a.denom === b.denom;
        if (a.type === "cw20") return a.contract === b.contract;
        return false;
    }

    function isNativeAsset(asset) {
        return !!asset && asset.type === "native";
    }

    function isNonNativeAsset(asset) {
        return !!asset && asset.type !== "native";
    }

    function isAssetPlaceholder(asset) {
        if (!asset) return true;
        if (asset.type === "native") return isPlaceholder(asset.denom);
        if (asset.type === "cw20") return isPlaceholder(asset.contract);
        return true;
    }

    function getPrimarySellAsset() {
        const orderbook = getOrderbookConfig();
        const ui = getUiConfig();
        return (
            findAssetById(orderbook.defaultBaseAssetId) ||
            findAssetById(ui.defaultSellAssetId) ||
            getRegistryAssets()[0] ||
            null
        );
    }

    function getPrimaryBuyAsset() {
        const orderbook = getOrderbookConfig();
        const ui = getUiConfig();
        return (
            findAssetById(orderbook.defaultQuoteAssetId) ||
            findAssetById(ui.defaultBuyAssetId) ||
            getRegistryAssets()[1] ||
            getRegistryAssets()[0] ||
            null
        );
    }

    function getPrimaryPairLabel() {
        const sell = getPrimarySellAsset();
        const buy = getPrimaryBuyAsset();
        if (!sell || !buy) return "-";
        return `${sell.label} / ${buy.label}`;
    }

    function updateLoadedAssetCount() {
        setText("loadedAssetCount", String(getRegistryAssets().length));
    }

    function populateAssetSelectors(preserveCurrent = false) {
        const sell = document.getElementById("sellAsset");
        const buy = document.getElementById("buyAsset");
        if (!sell || !buy) return;

        const previousSell = preserveCurrent ? sell.value : "";
        const previousBuy = preserveCurrent ? buy.value : "";

        const assets = getRegistryAssets();
        const optionsHtml = assets
            .map((asset) => `<option value="${assetToValue(asset)}">${asset.label}</option>`)
            .join("");

        setHTML("sellAsset", optionsHtml);
        setHTML("buyAsset", optionsHtml);

        const defaultSellAsset = getPrimarySellAsset();
        const defaultBuyAsset = getPrimaryBuyAsset();

        const previousSellAsset = findAssetByValue(previousSell);
        const previousBuyAsset = findAssetByValue(previousBuy);

        if (preserveCurrent && previousSellAsset) {
            sell.value = previousSell;
        } else if (defaultSellAsset) {
            sell.value = assetToValue(defaultSellAsset);
        } else if (assets.length > 0) {
            sell.selectedIndex = 0;
        }

        if (preserveCurrent && previousBuyAsset) {
            buy.value = previousBuy;
        } else if (defaultBuyAsset) {
            buy.value = assetToValue(defaultBuyAsset);
        } else if (assets.length > 1) {
            buy.selectedIndex = 1;
        } else if (assets.length > 0) {
            buy.selectedIndex = 0;
        }
    }

    function renderLoadedAssetsTable() {
        const tbody = document.getElementById("loadedAssetsTableBody");
        if (!tbody) return;

        const assets = getRegistryAssets();
        if (!assets.length) {
            tbody.innerHTML = `<tr><td colspan="4">No loaded assets yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = assets.map((asset) => {
            const identifier = asset.type === "native" ? asset.denom : asset.contract;
            return `
                <tr>
                    <td>${asset.symbol || asset.label || "-"}</td>
                    <td>${asset.type}</td>
                    <td>${identifier || "-"}</td>
                    <td>${asset.source || "-"}</td>
                </tr>
            `;
        }).join("");
    }

    function renderBidsAsks() {
        const bidsBody = document.getElementById("bidsTableBody");
        const asksBody = document.getElementById("asksTableBody");

        if (bidsBody) {
            const bids = Array.isArray(state.marketBook?.buy_orders) ? state.marketBook.buy_orders : [];
            bidsBody.innerHTML = bids.length
                ? bids.map((row) => `
                    <tr data-order-id="${row.id}">
                        <td>${row.price_num}/${row.price_denom}</td>
                        <td>${row.original_base_amount}</td>
                        <td>${row.remaining_base_amount}</td>
                    </tr>
                `).join("")
                : `<tr><td colspan="3">No bids loaded.</td></tr>`;
        }

        if (asksBody) {
            const asks = Array.isArray(state.marketBook?.sell_orders) ? state.marketBook.sell_orders : [];
            asksBody.innerHTML = asks.length
                ? asks.map((row) => `
                    <tr data-order-id="${row.id}">
                        <td>${row.price_num}/${row.price_denom}</td>
                        <td>${row.original_base_amount}</td>
                        <td>${row.remaining_base_amount}</td>
                    </tr>
                `).join("")
                : `<tr><td colspan="3">No asks loaded.</td></tr>`;
        }
    }

    function renderOpenOrders() {
        const tbody = document.getElementById("openOrdersTableBody");
        if (!tbody) return;

        const orders = Array.isArray(state.userOrders) ? state.userOrders : [];
        tbody.innerHTML = orders.length
            ? orders.map((row) => `
                <tr data-order-id="${row.id}">
                    <td>${row.side}</td>
                    <td>${row.market_key || "-"}</td>
                    <td>${row.remaining_base_amount || "-"}</td>
                    <td>${row.status || "-"}</td>
                </tr>
            `).join("")
            : `<tr><td colspan="4">No open orders loaded.</td></tr>`;
    }

    async function smartQuery(contractAddress, queryMsg) {
        const rest = getRestBase();

        if (!rest) throw new Error("REST endpoint missing in config.js");
        if (!contractAddress || isPlaceholder(contractAddress)) {
            throw new Error("Contract address is missing or still a placeholder in config.js");
        }

        const encoded = btoa(JSON.stringify(queryMsg));
        const url = `${rest}/cosmwasm/wasm/v1/contract/${contractAddress}/smart/${encoded}`;

        const res = await fetch(url);
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Smart query failed (${res.status}): ${text}`);
        }

        const json = await res.json();
        return json.data;
    }

    async function queryOrderbookConfig(orderbookAddress) {
        return smartQuery(orderbookAddress, { config: {} });
    }

    async function queryOrderbookMarkets(orderbookAddress, limit) {
        return smartQuery(orderbookAddress, {
            markets: {
                start_after: null,
                limit: limit || getOrderbookConfig().maxQueryLimit || 20
            }
        });
    }

    async function queryMarketBook(orderbookAddress, baseAsset, quoteAsset, limit) {
        return smartQuery(orderbookAddress, {
            market_book: {
                base_asset: assetToInfo(baseAsset),
                quote_asset: assetToInfo(quoteAsset),
                limit: limit || getOrderbookConfig().maxQueryLimit || 20
            }
        });
    }

    async function queryOrdersByUser(orderbookAddress, address, limit) {
        return smartQuery(orderbookAddress, {
            orders_by_user: {
                address,
                start_after: null,
                limit: limit || getOrderbookConfig().maxQueryLimit || 20
            }
        });
    }

    function updateCommonPageFields() {
        const pairLabel = getPrimaryPairLabel();
        const orderbookAddress = getOrderbookAddress();
        const assets = getRegistryAssets();

        setText("homeMarketPair", pairLabel);
        setText("marketsPrimaryPair", pairLabel);
        setText("dashboardPrimaryPair", pairLabel);
        setText("liquidityPrimaryPair", pairLabel);
        setText("activityPrimaryPair", pairLabel);

        setText("marketsPrimaryAddress", isPlaceholder(orderbookAddress) ? "Not set" : orderbookAddress);
        setText("dashboardTrackedAssets", String(assets.length));
    }

    function getMetadataTrustLabel() {
        const badge = document.getElementById("metadataTrustBadge");
        return badge ? badge.textContent.trim() : "Unknown";
    }

    function getMetadataAssetCount() {
        const assetRows = document.querySelectorAll("#metadataAssets .asset-row");
        if (assetRows && assetRows.length) return assetRows.length;
        return getRegistryAssets().length;
    }

    function getMetadataIssueTexts() {
        return Array.from(document.querySelectorAll("#metadataIssues .issue, #metadataIssues li"))
            .map((el) => el.textContent.trim())
            .filter(Boolean);
    }

    function updateMetadataDrivenFields() {
        const trustLabel = getMetadataTrustLabel();
        const assetCount = getMetadataAssetCount();

        setText("dashboardTrustMode", trustLabel);
        setText("activityTrustMode", trustLabel);
        setText("dashboardTrackedAssets", String(assetCount));
    }

    function getWalletStateSafe() {
        if (
            window.CosmosDexWallet &&
            typeof window.CosmosDexWallet.getWalletState === "function"
        ) {
            try {
                return window.CosmosDexWallet.getWalletState();
            } catch (_err) {
                return { connected: false, address: "", label: "", walletType: "" };
            }
        }

        return { connected: false, address: "", label: "", walletType: "" };
    }

    function updateWalletFields() {
        const wallet = getWalletStateSafe();
        const walletText = wallet.connected
            ? `${wallet.label || "Wallet"} connected`
            : "Awaiting wallet";

        setText("dashboardWalletStatus", walletText);
        setText("liquidityWalletStatus", walletText);
        setText("activityWalletStatus", walletText);

        if (wallet.connected) {
            setText("dashboardPortfolioValue", "Orderbook active");
            setText("liquidityLpState", "Orderbook mode");
        } else {
            setText("dashboardPortfolioValue", "-");
            setText("liquidityLpState", "Not loaded");
        }
    }

    function updateOrderbookDrivenFields() {
        const orderbookAddress = getOrderbookAddress();
        const hasRealOrderbook = !isPlaceholder(orderbookAddress);
        const pairLabel = getPrimaryPairLabel();

        const marketState = hasRealOrderbook
            ? (state.orderbookLoaded ? "Orderbook loaded" : "Loading orderbook")
            : "Awaiting live orderbook config";

        setText("homeMarketLiquidity", state.marketBook ? "Book loaded" : "Not loaded");
        setText("marketsPrimaryStatus", marketState);
        setText("dashboardMarketState", marketState);
        setText("liquidityPoolState", marketState);
        setText("activityMarketState", marketState);

        setText("liquidityPrimaryPair", pairLabel);
        setText("activityPrimaryPair", pairLabel);

        if (state.marketBook) {
            const buyCount = Array.isArray(state.marketBook.buy_orders) ? state.marketBook.buy_orders.length : 0;
            const sellCount = Array.isArray(state.marketBook.sell_orders) ? state.marketBook.sell_orders.length : 0;
            setText("homeMarketLiquidity", `${buyCount} bids / ${sellCount} asks`);
        }
    }

    function updateTradeCharts() {
        if (!window.CosmosDexCharts) return;

        if (document.getElementById("tradePriceChart")) {
            window.CosmosDexCharts.updateChart("tradePriceChart", {
                type: "line",
                title: getPrimaryPairLabel(),
                subtitle: "Orderbook View",
                emptyMessage: "No market chart data available.",
                series: window.CosmosDexCharts.generateSeries(18, 0.95, 1.75, 4)
            });
        }

        if (document.getElementById("tradeLiquidityChart")) {
            const buyDepth = Array.isArray(state.marketBook?.buy_orders)
                ? state.marketBook.buy_orders.length
                : 0;
            const sellDepth = Array.isArray(state.marketBook?.sell_orders)
                ? state.marketBook.sell_orders.length
                : 0;

            const series = buyDepth || sellDepth
                ? [
                    { x: 0, y: buyDepth || 1, label: "Bids" },
                    { x: 1, y: sellDepth || 1, label: "Asks" }
                ]
                : window.CosmosDexCharts.generateSeries(2, 1, 3, 0);

            window.CosmosDexCharts.updateChart("tradeLiquidityChart", {
                type: "bar",
                title: "Book Depth",
                subtitle: "Bid / Ask Count",
                emptyMessage: "No orderbook depth data available.",
                series
            });
        }
    }

    function setExecutionPreview(preview) {
        state.lastOrderPreview = preview;
        const target = document.getElementById("executionPreviewView");
        if (target) {
            target.textContent = preview ? formatJson(preview) : "-";
        }
    }

    function setExecutionResult(result) {
        const target = document.getElementById("executionResultView");
        if (target) {
            target.textContent = result ? formatJson(result) : "-";
        }

        const linkEl = document.getElementById("executionResultLink");
        if (linkEl) {
            if (result && result.txHash) {
                const url = getExplorerTxUrl(result.txHash);
                if (url) {
                    linkEl.innerHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer">View transaction</a>`;
                } else {
                    linkEl.textContent = result.txHash;
                }
            } else {
                linkEl.textContent = "";
            }
        }
    }

    function renderMarketBookToPanels() {
        setText("pairConfigView", state.orderbookConfig ? formatJson(state.orderbookConfig) : "-");
        setText("poolView", state.marketBook ? formatJson(state.marketBook) : "-");
        setText("simResponseView", formatJson({
            markets: state.markets,
            user_orders: state.userOrders
        }));

        const bestBid = state.marketBook?.buy_orders?.[0] || null;
        const bestAsk = state.marketBook?.sell_orders?.[0] || null;

        setText("bestBidView", bestBid ? `${bestBid.price_num}/${bestBid.price_denom}` : "-");
        setText("bestAskView", bestAsk ? `${bestAsk.price_num}/${bestAsk.price_denom}` : "-");
        setText("spreadView", bestBid && bestAsk ? comparePriceObjects(bestBid, bestAsk) : "-");
        setText("quoteOut", bestBid && bestAsk ? `bid ${bestBid.price_num}/${bestBid.price_denom} | ask ${bestAsk.price_num}/${bestAsk.price_denom}` : "-");
        setText("quotePair", getPrimaryPairLabel());

        if (bestBid || bestAsk) {
            setText(
                "homeMarketLast",
                `bid ${bestBid ? bestBid.price_num : "-"} / ask ${bestAsk ? bestAsk.price_num : "-"}`
            );
        }

        renderBidsAsks();
        renderOpenOrders();
    }

    async function loadOrderbookContext() {
        const orderbookAddress = getOrderbookAddress();
        const baseAsset = findAssetByValue(document.getElementById("sellAsset")?.value) || getPrimarySellAsset();
        const quoteAsset = findAssetByValue(document.getElementById("buyAsset")?.value) || getPrimaryBuyAsset();

        setText("configDump", formatJson(cfg));
        setText("pairAddressView", orderbookAddress || "-");

        if (isPlaceholder(orderbookAddress)) {
            state.orderbookLoaded = false;
            state.orderbookConfig = null;
            state.markets = [];
            state.marketBook = null;
            state.userOrders = [];

            setText("pairConfigView", "-");
            setText("poolView", "-");
            setText("simResponseView", "-");
            renderBidsAsks();
            renderOpenOrders();
            setStatus("Set a real orderbook contract address in app/js/config.js before live querying.");
            updateOrderbookDrivenFields();
            return;
        }

        try {
            setStatus("Loading orderbook config, markets, and current book...");

            const wallet = getWalletStateSafe();
            const queries = [
                queryOrderbookConfig(orderbookAddress),
                queryOrderbookMarkets(orderbookAddress, getOrderbookConfig().maxQueryLimit || 20),
                queryMarketBook(orderbookAddress, baseAsset, quoteAsset, getOrderbookConfig().maxQueryLimit || 20)
            ];

            if (wallet.connected && getOrderbookConfig().autoLoadUserOrdersOnTradePage !== false) {
                queries.push(queryOrdersByUser(orderbookAddress, wallet.address, getOrderbookConfig().maxQueryLimit || 20));
            }

            const results = await Promise.all(queries);

            state.orderbookConfig = results[0] || null;
            state.markets = results[1]?.markets || [];
            state.marketBook = results[2] || null;
            state.userOrders = results[3]?.orders || [];
            state.orderbookLoaded = true;

            renderMarketBookToPanels();
            updateOrderbookDrivenFields();
            updateTradeCharts();
            setStatus("Orderbook context loaded.");
        } catch (err) {
            console.error(err);

            state.orderbookLoaded = false;
            state.orderbookConfig = null;
            state.markets = [];
            state.marketBook = null;
            state.userOrders = [];

            setText("pairConfigView", "-");
            setText("poolView", "-");
            setText("simResponseView", "-");
            renderBidsAsks();
            renderOpenOrders();
            setStatus(err.message || "Failed loading orderbook context.", true);
            updateOrderbookDrivenFields();
        }
    }

    function validateTradeSelection(baseAsset, quoteAsset, baseAmount) {
        if (!baseAsset || !quoteAsset) throw new Error("Invalid asset selection.");
        if (assetsMatch(baseAsset, quoteAsset)) {
            throw new Error("Base and quote assets must be different.");
        }
        if (!baseAmount || baseAmount === "0") {
            throw new Error("Enter an amount greater than zero.");
        }
    }

    function buildOrderPreview(baseAsset, quoteAsset, baseAmount) {
        const orderbookAddress = getOrderbookAddress();
        const execution = getExecutionConfig();
        const wallet = getWalletStateSafe();
        const orderSideEl = document.getElementById("orderSide");
        const priceInputEl = document.getElementById("limitPriceInput");

        const side = orderSideEl?.value || getOrderbookConfig().defaultOrderSide || "sell";
        const baseUnits = String(baseAmount);
        const ratio = priceToRatio(priceInputEl?.value, quoteAsset?.decimals || 6);

        const preview = {
            mode: cfg?.env?.mode || "unknown",
            walletType: wallet.walletType || "",
            walletAddress: wallet.address || "",
            orderbookAddress,
            side,
            marketKey: marketKeyForAssets(baseAsset, quoteAsset),
            baseAsset: assetToInfo(baseAsset),
            quoteAsset: assetToInfo(quoteAsset),
            baseAmount: baseUnits,
            price_num: ratio.price_num,
            price_denom: ratio.price_denom,
            fee: {
                amount: execution.defaultFeeAmount,
                denom: execution.defaultFeeDenom,
                gasLimit: execution.defaultGasLimit
            }
        };

        if (side === "sell") {
            if (isNativeAsset(baseAsset)) {
                preview.executePath = "orderbook-create-sell-native";
                preview.msg = {
                    create_order: {
                        side: "sell",
                        base_asset: assetToInfo(baseAsset),
                        quote_asset: assetToInfo(quoteAsset),
                        price_num: ratio.price_num,
                        price_denom: ratio.price_denom,
                        base_amount: baseUnits
                    }
                };
                preview.funds = [
                    {
                        denom: baseAsset.denom,
                        amount: baseUnits
                    }
                ];
            } else {
                preview.executePath = "cw20-send-hook-create-sell";
                preview.msg = {
                    send: {
                        contract: orderbookAddress,
                        amount: baseUnits,
                        msg: btoa(JSON.stringify({
                            create_order: {
                                side: "sell",
                                base_asset: assetToInfo(baseAsset),
                                quote_asset: assetToInfo(quoteAsset),
                                price_num: ratio.price_num,
                                price_denom: ratio.price_denom,
                                base_amount: baseUnits
                            }
                        }))
                    }
                };
                preview.funds = [];
                preview.cw20Contract = baseAsset.contract;
            }
        } else {
            preview.executePath = "orderbook-create-buy";
            preview.msg = {
                create_order: {
                    side: "buy",
                    base_asset: assetToInfo(baseAsset),
                    quote_asset: assetToInfo(quoteAsset),
                    price_num: ratio.price_num,
                    price_denom: ratio.price_denom,
                    base_amount: baseUnits
                }
            };

            if (isNativeAsset(quoteAsset)) {
                preview.funds = [
                    {
                        denom: quoteAsset.denom,
                        amount: baseUnits
                    }
                ];
            } else {
                preview.cw20Contract = quoteAsset.contract;
                preview.funds = [];
            }
        }

        return preview;
    }

    async function handleOrderPreview() {
        const sellEl = document.getElementById("sellAsset");
        const buyEl = document.getElementById("buyAsset");
        const amountEl = document.getElementById("sellAmount");
        const priceEl = document.getElementById("limitPriceInput");
        const orderSideEl = document.getElementById("orderSide");

        const baseAsset = findAssetByValue(sellEl?.value);
        const quoteAsset = findAssetByValue(buyEl?.value);
        const baseAmount = parseInputToBaseUnits(amountEl?.value, baseAsset?.decimals || 6);

        validateTradeSelection(baseAsset, quoteAsset, baseAmount);

        const preview = buildOrderPreview(baseAsset, quoteAsset, baseAmount);
        setExecutionPreview(preview);

        setText("quoteOut", amountEl?.value || "-");
        setText("quoteFee", orderSideEl?.value || "book");
        setText("quotePair", `${baseAsset.label}/${quoteAsset.label}`);
        setText("orderAmountView", amountEl?.value || "-");
        setText("settlementAssetView", quoteAsset?.label || "-");

        setText("simResponseView", formatJson({
            preview_type: "create_order",
            market_key: preview.marketKey,
            side: preview.side,
            price_num: preview.price_num,
            price_denom: preview.price_denom,
            base_amount: preview.baseAmount,
            input_price: priceEl?.value || ""
        }));

        setStatus("Order preview generated.");
        return preview;
    }

    function requireWalletForExecution() {
        const execution = getExecutionConfig();
        const wallet = getWalletStateSafe();

        if (execution.requireWalletConnection !== false && !wallet.connected) {
            throw new Error("Connect a wallet before creating orders.");
        }

        return wallet;
    }

    function validateExecutionAssets(baseAsset, quoteAsset) {
        const execution = getExecutionConfig();

        if (execution.blockExecutionWhenAssetPlaceholder !== false) {
            if (isAssetPlaceholder(baseAsset) || isAssetPlaceholder(quoteAsset)) {
                throw new Error("Execution is blocked because one or more asset identifiers are still placeholders.");
            }
        }
    }

    function validateExecutionOrderbook() {
        const orderbookAddress = getOrderbookAddress();
        if (isPlaceholder(orderbookAddress)) {
            throw new Error("Execution is blocked because the orderbook contract address is still missing.");
        }
        return orderbookAddress;
    }

    function validateMetadataExecutionPolicy(baseAsset, quoteAsset) {
        const execution = getExecutionConfig();
        const metadata = getMetadataConfig();

        if (execution.requireMetadataForNonNativeAssets === false) return;
        if (metadata.enabled === false) return;

        const hasNonNativeAsset = isNonNativeAsset(baseAsset) || isNonNativeAsset(quoteAsset);
        if (!hasNonNativeAsset) return;

        const trustLabel = getMetadataTrustLabel().toLowerCase();
        const issues = getMetadataIssueTexts().join(" ").toLowerCase();

        if (!trustLabel || trustLabel === "unknown") {
            throw new Error("Execution is blocked because metadata trust has not been established for a non-native asset.");
        }

        if (issues.includes("extra scrutiny")) {
            throw new Error("Execution is blocked because the selected non-native asset is marked as requiring extra scrutiny.");
        }
    }

    async function performMockExecution(preview) {
        const execution = getExecutionConfig();
        if (execution.allowMockExecutionFallback !== true) {
            throw new Error("Mock execution fallback is disabled in config.");
        }

        await new Promise((resolve) => window.setTimeout(resolve, 500));

        return {
            ok: true,
            mode: "mock",
            txHash: `MOCKTX${Date.now()}`,
            message: "Mock order creation completed.",
            preview
        };
    }

    async function executeOrderCreateFlow() {
        const execution = getExecutionConfig();

        if (execution.enabled === false) {
            throw new Error("Execution is disabled in config.");
        }

        const sellEl = document.getElementById("sellAsset");
        const buyEl = document.getElementById("buyAsset");
        const amountEl = document.getElementById("sellAmount");

        const baseAsset = findAssetByValue(sellEl?.value);
        const quoteAsset = findAssetByValue(buyEl?.value);
        const baseAmount = parseInputToBaseUnits(amountEl?.value, baseAsset?.decimals || 6);

        validateTradeSelection(baseAsset, quoteAsset, baseAmount);
        requireWalletForExecution();
        validateExecutionOrderbook();
        validateExecutionAssets(baseAsset, quoteAsset);
        validateMetadataExecutionPolicy(baseAsset, quoteAsset);

        setStatus("Preparing order creation...");

        const preview = state.lastOrderPreview || buildOrderPreview(baseAsset, quoteAsset, baseAmount);
        setExecutionPreview(preview);

        if (cfg?.env?.useMockExecution === true || execution.allowMockExecutionFallback === true) {
            setStatus("Running mock order creation...");
            const result = await performMockExecution(preview);
            setExecutionResult(result);
            setStatus("Mock order creation complete.");
            return result;
        }

        const result = {
            ok: false,
            mode: "preview-only",
            message: "Live order signing/broadcast is the next integration step.",
            preview
        };

        setExecutionResult(result);
        setStatus("Order create preview ready. Live signing/broadcast is the next integration step.");
        return result;
    }

    async function handleLoadByDenom() {
        const input = document.getElementById("assetDenomInput");
        const raw = String(input?.value || "").trim();
        if (!raw) throw new Error("Enter a denom first.");

        const existing = getRegistryAssets().find((asset) => asset.type === "native" && asset.denom === raw);
        if (existing) {
            setStatus(`Asset already loaded: ${existing.label}`);
            return existing;
        }

        const inferred = {
            id: inferNativeLabelFromDenom(raw).toLowerCase(),
            label: inferNativeLabelFromDenom(raw),
            symbol: inferNativeLabelFromDenom(raw),
            type: "native",
            denom: raw,
            decimals: 6,
            description: `Manually loaded native asset: ${raw}`,
            source: "manual-denom",
            trust: "unknown"
        };

        addAssetToRegistry(inferred, "manual-denom");
        populateAssetSelectors(true);
        renderLoadedAssetsTable();
        updateLoadedAssetCount();
        setStatus(`Loaded asset by denom: ${raw}`);
        return inferred;
    }

    async function handleLoadBySymbol() {
        const input = document.getElementById("assetSymbolInput");
        const symbol = String(input?.value || "").trim();
        if (!symbol) throw new Error("Enter a symbol first.");

        const matches = findAssetBySymbol(symbol);
        if (!matches.length) {
            throw new Error(`No loaded asset matches symbol: ${symbol}`);
        }

        if (matches.length === 1) {
            const sell = document.getElementById("sellAsset");
            if (sell) sell.value = assetToValue(matches[0]);
            setStatus(`Selected asset by symbol: ${matches[0].label}`);
            await loadOrderbookContext();
            return matches[0];
        }

        setStatus(`Multiple assets found for ${symbol}. Use the asset selectors to choose the correct one.`);
        return matches[0];
    }

    async function handleLoadByDomain() {
        const input = document.getElementById("assetDomainInput");
        const domain = normalizeDomain(input?.value || "");
        if (!domain) throw new Error("Enter a domain first.");

        state.loadedSources.push({
            type: "domain",
            value: domain,
            loadedAt: Date.now()
        });

        setStatus(`Domain import recorded for ${domain}. Live domain asset ingestion is the next integration step.`);
        renderLoadedAssetsTable();
        return domain;
    }

    function bindTradeEvents() {
        const sell = document.getElementById("sellAsset");
        const buy = document.getElementById("buyAsset");
        const amount = document.getElementById("sellAmount");
        const simulateBtn = document.getElementById("simulateBtn");
        const swapBtn = document.getElementById("swapBtn");
        const orderSide = document.getElementById("orderSide");
        const priceInput = document.getElementById("limitPriceInput");
        const flipMarketBtn = document.getElementById("flipMarketBtn");
        const refreshBookBtn = document.getElementById("refreshBookBtn");
        const loadDomainAssetBtn = document.getElementById("loadDomainAssetBtn");
        const loadDenomAssetBtn = document.getElementById("loadDenomAssetBtn");
        const loadSymbolAssetBtn = document.getElementById("loadSymbolAssetBtn");

        if (!sell || !buy || !amount || !simulateBtn || !swapBtn) return;

        const resetQuote = () => {
            clearTradeOutputs();
            setExecutionPreview(null);
            setExecutionResult(null);

            const baseAsset = findAssetByValue(sell.value);
            const quoteAsset = findAssetByValue(buy.value);

            if (baseAsset && quoteAsset && !assetsMatch(baseAsset, quoteAsset)) {
                setText("quotePair", `${baseAsset.label}/${quoteAsset.label}`);
            } else {
                setText("quotePair", "-");
            }
        };

        sell.addEventListener("change", async () => {
            resetQuote();
            await loadOrderbookContext();
        });

        buy.addEventListener("change", async () => {
            resetQuote();
            await loadOrderbookContext();
        });

        amount.addEventListener("input", resetQuote);
        if (orderSide) orderSide.addEventListener("change", resetQuote);
        if (priceInput) priceInput.addEventListener("input", resetQuote);

        simulateBtn.addEventListener("click", async () => {
            try {
                await handleOrderPreview();
            } catch (err) {
                console.error(err);
                clearTradeOutputs();
                setExecutionPreview(null);
                setExecutionResult(null);
                setStatus(err.message || "Order preview failed.", true);
            }
        });

        swapBtn.addEventListener("click", async () => {
            try {
                await executeOrderCreateFlow();
            } catch (err) {
                console.error(err);
                setExecutionResult({
                    ok: false,
                    mode: "blocked",
                    message: err.message || "Order execution failed before signing."
                });
                setStatus(err.message || "Order execution failed.", true);
            }
        });

        if (flipMarketBtn) {
            flipMarketBtn.addEventListener("click", async () => {
                const oldSell = sell.value;
                sell.value = buy.value;
                buy.value = oldSell;
                resetQuote();
                await loadOrderbookContext();
            });
        }

        if (refreshBookBtn) {
            refreshBookBtn.addEventListener("click", async () => {
                try {
                    await loadOrderbookContext();
                } catch (err) {
                    console.error(err);
                    setStatus(err.message || "Refresh failed.", true);
                }
            });
        }

        if (loadDomainAssetBtn) {
            loadDomainAssetBtn.addEventListener("click", async () => {
                try {
                    await handleLoadByDomain();
                } catch (err) {
                    console.error(err);
                    setStatus(err.message || "Domain load failed.", true);
                }
            });
        }

        if (loadDenomAssetBtn) {
            loadDenomAssetBtn.addEventListener("click", async () => {
                try {
                    await handleLoadByDenom();
                } catch (err) {
                    console.error(err);
                    setStatus(err.message || "Denom load failed.", true);
                }
            });
        }

        if (loadSymbolAssetBtn) {
            loadSymbolAssetBtn.addEventListener("click", async () => {
                try {
                    await handleLoadBySymbol();
                } catch (err) {
                    console.error(err);
                    setStatus(err.message || "Symbol lookup failed.", true);
                }
            });
        }

        resetQuote();
    }

    async function initTrade() {
        const sell = document.getElementById("sellAsset");
        const buy = document.getElementById("buyAsset");
        const amount = document.getElementById("sellAmount");
        const simulateBtn = document.getElementById("simulateBtn");
        const swapBtn = document.getElementById("swapBtn");

        if (!sell || !buy || !amount || !simulateBtn || !swapBtn) return;

        seedAssetRegistry();
        populateAssetSelectors();
        bindTradeEvents();

        if (getOrderbookConfig().autoLoadMarketsOnTradePage !== false) {
            await loadOrderbookContext();
        } else {
            setText("configDump", formatJson(cfg));
            setText("pairAddressView", getOrderbookAddress() || "-");
            setStatus("Auto orderbook loading disabled in config.");
        }
    }

    function initSharedPageState() {
        updateCommonPageFields();
        updateMetadataDrivenFields();
        updateWalletFields();
        updateOrderbookDrivenFields();
    }

    function bindGlobalEvents() {
        document.addEventListener("cosmdex:wallet-changed", async () => {
            updateWalletFields();
            if (document.getElementById("sellAsset") && document.getElementById("buyAsset")) {
                await loadOrderbookContext();
            }
        });

        document.addEventListener("cosmdex:metadata-loaded", () => {
            updateMetadataDrivenFields();
        });
    }

    async function init() {
        bindGlobalEvents();
        initSharedPageState();
        await initTrade();
    }

    window.CosmosDexApp = {
        initTrade,
        smartQuery,
        queryOrderbookConfig,
        queryOrderbookMarkets,
        queryMarketBook,
        queryOrdersByUser,
        loadOrderbookContext,
        executeOrderCreateFlow,
        updateWalletFields,
        updateMetadataDrivenFields,
        updateOrderbookDrivenFields,
        handleLoadByDenom,
        handleLoadBySymbol,
        handleLoadByDomain
    };

    window.addEventListener("DOMContentLoaded", () => {
        init().catch((err) => {
            console.error(err);
            setStatus(err.message || "App initialization failed.", true);
        });
    });
})();