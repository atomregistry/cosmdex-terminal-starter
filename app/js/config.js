window.COSMOSDEX_CONFIG = {
    appName: "Cosmos DEX Terminal",

    env: {
        mode: "local",
        useMockWallet: true,
        useMockExecution: false,
        useMockData: false,
        debug: true
    },

    network: {
        name: "Cosmos Hub",
        chainId: "cosmoshub-4",
        rpc: "https://rpc.cosmos.network",
        rest: "https://rest.cosmoshub-main.ccvalidators.com:443",
        addressPrefix: "cosmos",
        explorerTxBase: "https://www.mintscan.io/cosmos/tx/",
        explorerAddressBase: "https://www.mintscan.io/cosmos/address/"
    },

    contracts: {
        orderbook: "cosmos1rz23v86qlhlswjlnr2s0wedlcnr3n6tfeamv8ca8te6j835c2zkqh6l85k",
        pair: "",
        router: "",
        factory: "",
        lpToken: ""
    },

    metadata: {
        enabled: true,
        requiredForNonNativeAssets: true,
        sources: [
            "/.well-known/cosmos.toml",
            "/cosmos.toml"
        ],
        minimumTrustScoreVerified: 80,
        minimumTrustScoreKnown: 55
    },

    execution: {
        enabled: true,
        requireWalletConnection: true,
        requireMetadataForNonNativeAssets: true,
        blockExecutionWhenPairPlaceholder: true,
        blockExecutionWhenAssetPlaceholder: true,
        allowMockExecutionFallback: false,
        defaultGasLimit: 350000,
        defaultFeeAmount: "5000",
        defaultFeeDenom: "uatom",
        broadcastMode: "sync"
    },

    orderbook: {
        enabled: true,
        defaultBaseAssetId: "atom",
        defaultQuoteAssetId: "arm",
        defaultOrderSide: "sell",
        maxQueryLimit: 50,
        autoLoadMarketsOnTradePage: true,
        autoLoadUserOrdersOnTradePage: true
    },

    assets: [
        {
            id: "atom",
            label: "ATOM",
            symbol: "ATOM",
            type: "native",
            denom: "uatom",
            decimals: 6,
            description: "Cosmos Hub native staking and gas asset"
        },
        {
            id: "arm",
            label: "ARM",
            symbol: "ARM",
            type: "native",
            denom: "factory/cosmos1mn2ekfxs8zc40hdjt44edfaht0pdgquluzrs2j/arm",
            decimals: 6,
            description: "Atom Registry Mint token on Cosmos Hub via tokenfactory"
        }
    ],

    ui: {
        defaultSellAssetId: "atom",
        defaultBuyAssetId: "arm",
        defaultFeeBps: 30,
        defaultSlippageBps: 100,
        maxSlippageBps: 5000,
        amountDecimalPlaces: 6,
        autoLoadPairOnTradePage: false
    }
};