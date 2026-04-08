(function () {
    const cfg = window.COSMOSDEX_CONFIG || {};

    const state = {
        connected: false,
        walletType: null,
        address: "",
        label: "",
        initialized: false
    };

    function getEnvConfig() {
        return cfg?.env || {};
    }

    function getNetworkConfig() {
        return cfg?.network || {};
    }

    function getStorageKey() {
        const chainId = getNetworkConfig().chainId || "unknown-chain";
        return `cosmdex_wallet_session_${chainId}`;
    }

    function shortenAddress(address) {
        if (!address || address.length < 16) return address || "";
        return `${address.slice(0, 10)}...${address.slice(-6)}`;
    }

    function getAllWalletButtons() {
        return Array.from(document.querySelectorAll("#walletBtn"));
    }

    function getWalletState() {
        return {
            connected: state.connected,
            walletType: state.walletType,
            address: state.address,
            label: state.label
        };
    }

    function emitWalletChanged() {
        document.dispatchEvent(
            new CustomEvent("cosmdex:wallet-changed", {
                detail: getWalletState()
            })
        );
    }

    function updateWalletButtons() {
        const buttons = getAllWalletButtons();
        const label = state.connected
            ? `Connected: ${shortenAddress(state.address)}`
            : "Connect Wallet";

        buttons.forEach((btn) => {
            btn.textContent = label;
            btn.dataset.walletConnected = state.connected ? "true" : "false";
            btn.dataset.walletType = state.walletType || "";
            btn.title = state.connected
                ? `${state.label || "Wallet"} connected`
                : "Connect your wallet";
        });
    }

    function saveSession() {
        try {
            const payload = {
                connected: state.connected,
                walletType: state.walletType,
                address: state.address,
                label: state.label
            };
            localStorage.setItem(getStorageKey(), JSON.stringify(payload));
        } catch (_err) {
            // ignore storage failures
        }
    }

    function clearSession() {
        try {
            localStorage.removeItem(getStorageKey());
        } catch (_err) {
            // ignore storage failures
        }
    }

    function restoreSession() {
        try {
            const raw = localStorage.getItem(getStorageKey());
            if (!raw) return false;

            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.connected || !parsed.address) return false;

            state.connected = true;
            state.walletType = parsed.walletType || "restored";
            state.address = parsed.address || "";
            state.label = parsed.label || "Wallet";
            return true;
        } catch (_err) {
            return false;
        }
    }

    function setWalletState(nextState) {
        state.connected = !!nextState.connected;
        state.walletType = nextState.walletType || null;
        state.address = nextState.address || "";
        state.label = nextState.label || "";

        updateWalletButtons();

        if (state.connected) {
            saveSession();
        } else {
            clearSession();
        }

        emitWalletChanged();
    }

    function generateMockAddress() {
        const prefix = getNetworkConfig().addressPrefix || "cosmos";
        return `${prefix}1mocktrader000000000000000000000000abcd`;
    }

    async function connectMockWallet() {
        setWalletState({
            connected: true,
            walletType: "mock",
            address: generateMockAddress(),
            label: "Mock Wallet"
        });

        return getWalletState();
    }

    async function connectKeplrWallet() {
        if (!window.keplr) {
            throw new Error("Keplr is not installed in this browser.");
        }

        const chainId = getNetworkConfig().chainId;
        if (!chainId) {
            throw new Error("Missing chainId in config.");
        }

        await window.keplr.enable(chainId);

        const offlineSigner = window.keplr.getOfflineSigner(chainId);
        const accounts = await offlineSigner.getAccounts();

        if (!accounts || !accounts.length || !accounts[0].address) {
            throw new Error("Keplr returned no accounts.");
        }

        setWalletState({
            connected: true,
            walletType: "keplr",
            address: accounts[0].address,
            label: "Keplr"
        });

        return getWalletState();
    }

    async function connectLeapWallet() {
        if (!window.leap) {
            throw new Error("Leap is not installed in this browser.");
        }

        const chainId = getNetworkConfig().chainId;
        if (!chainId) {
            throw new Error("Missing chainId in config.");
        }

        await window.leap.enable(chainId);

        const offlineSigner = window.leap.getOfflineSigner(chainId);
        const accounts = await offlineSigner.getAccounts();

        if (!accounts || !accounts.length || !accounts[0].address) {
            throw new Error("Leap returned no accounts.");
        }

        setWalletState({
            connected: true,
            walletType: "leap",
            address: accounts[0].address,
            label: "Leap"
        });

        return getWalletState();
    }

    async function connectWallet(preferredWalletType) {
        const env = getEnvConfig();
        const walletType = preferredWalletType || "auto";

        if (env.useMockWallet === true) {
            return connectMockWallet();
        }

        if (walletType === "keplr") {
            return connectKeplrWallet();
        }

        if (walletType === "leap") {
            return connectLeapWallet();
        }

        if (window.keplr) {
            return connectKeplrWallet();
        }

        if (window.leap) {
            return connectLeapWallet();
        }

        throw new Error("No supported wallet found. Install Keplr or Leap, or enable mock wallet mode.");
    }

    function disconnectWallet() {
        setWalletState({
            connected: false,
            walletType: null,
            address: "",
            label: ""
        });
    }

    function isWalletConnected() {
        return state.connected;
    }

    function getWalletAddress() {
        return state.address || "";
    }

    function getWalletLabel() {
        return state.label || "";
    }

    function getWalletType() {
        return state.walletType || "";
    }

    async function getOfflineSigner() {
        const chainId = getNetworkConfig().chainId;
        if (!chainId) {
            throw new Error("Missing chainId in config.");
        }

        if (!state.connected) {
            throw new Error("Wallet is not connected.");
        }

        if (state.walletType === "keplr" && window.keplr) {
            return window.keplr.getOfflineSigner(chainId);
        }

        if (state.walletType === "leap" && window.leap) {
            return window.leap.getOfflineSigner(chainId);
        }

        if (state.walletType === "mock") {
            return null;
        }

        throw new Error("No supported signer available for the connected wallet.");
    }

    function bindWalletButtons() {
        const buttons = getAllWalletButtons();

        buttons.forEach((btn) => {
            if (btn.dataset.walletBound === "true") return;

            btn.dataset.walletBound = "true";

            btn.addEventListener("click", async () => {
                try {
                    if (state.connected) {
                        const shouldDisconnect = window.confirm(
                            `Disconnect ${state.label || "wallet"}?\n\n${state.address}`
                        );

                        if (shouldDisconnect) {
                            disconnectWallet();
                        }
                        return;
                    }

                    await connectWallet();
                } catch (err) {
                    console.error(err);
                    alert(err.message || "Wallet connection failed.");
                }
            });
        });
    }

    function refreshWalletUI() {
        updateWalletButtons();
        bindWalletButtons();
        emitWalletChanged();
    }

    function initWallet() {
        if (!state.initialized) {
            restoreSession();
            state.initialized = true;
        }

        refreshWalletUI();
    }

    window.CosmosDexWallet = {
        initWallet,
        refreshWalletUI,
        connectWallet,
        disconnectWallet,
        getWalletState,
        getWalletAddress,
        getWalletLabel,
        getWalletType,
        getOfflineSigner,
        isWalletConnected
    };

    window.addEventListener("DOMContentLoaded", initWallet);
})();
