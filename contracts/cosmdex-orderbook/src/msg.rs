use cosmwasm_std::Uint128;
use cw20::Cw20ReceiveMsg;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AssetInfo {
    NativeToken { denom: String },
    Token { contract_addr: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
pub struct Asset {
    pub info: AssetInfo,
    pub amount: Uint128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum OrderStatus {
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
pub struct InstantiateMsg {
    pub admin: Option<String>,
    pub treasury: String,
    pub treasury_fee_bps: u16,
    pub min_order_size: Uint128,
    pub max_matches_per_order: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    CreateOrder {
        side: OrderSide,
        base_asset: AssetInfo,
        quote_asset: AssetInfo,
        price_num: Uint128,
        price_denom: Uint128,
        base_amount: Uint128,
    },
    CancelOrder {
        order_id: u64,
    },
    FillOrder {
        order_id: u64,
        base_amount: Uint128,
    },
    Receive(Cw20ReceiveMsg),
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Cw20HookMsg {
    CreateOrder {
        side: OrderSide,
        base_asset: AssetInfo,
        quote_asset: AssetInfo,
        price_num: Uint128,
        price_denom: Uint128,
        base_amount: Uint128,
    },
    FillOrder {
        order_id: u64,
        base_amount: Uint128,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    Config {},
    MarketBook {
        base_asset: AssetInfo,
        quote_asset: AssetInfo,
        limit: Option<u32>,
    },
    Markets {
        start_after: Option<String>,
        limit: Option<u32>,
    },
    Order {
        order_id: u64,
    },
    OrdersByUser {
        address: String,
        start_after: Option<u64>,
        limit: Option<u32>,
    },
    OrdersByMarket {
        base_asset: AssetInfo,
        quote_asset: AssetInfo,
        side: Option<OrderSide>,
        start_after: Option<u64>,
        limit: Option<u32>,
    },
    FillsByOrder {
        order_id: u64,
        start_after: Option<u64>,
        limit: Option<u32>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
pub struct ConfigResponse {
    pub admin: Option<String>,
    pub treasury: String,
    pub treasury_fee_bps: u16,
    pub min_order_size: Uint128,
    pub max_matches_per_order: u32,
    pub next_order_id: u64,
    pub next_fill_id: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
pub struct OrderResponse {
    pub id: u64,
    pub owner: String,
    pub market_key: String,
    pub side: OrderSide,
    pub base_asset: AssetInfo,
    pub quote_asset: AssetInfo,
    pub price_num: Uint128,
    pub price_denom: Uint128,
    pub original_base_amount: Uint128,
    pub remaining_base_amount: Uint128,
    pub escrowed_amount: Uint128,
    pub status: OrderStatus,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
pub struct FillResponse {
    pub id: u64,
    pub order_id: u64,
    pub maker: String,
    pub taker: String,
    pub base_amount: Uint128,
    pub quote_amount: Uint128,
    pub timestamp: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
pub struct MarketBookResponse {
    pub market_key: String,
    pub base_asset: AssetInfo,
    pub quote_asset: AssetInfo,
    pub buy_orders: Vec<OrderResponse>,
    pub sell_orders: Vec<OrderResponse>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
pub struct MarketsResponse {
    pub markets: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
pub struct OrdersResponse {
    pub orders: Vec<OrderResponse>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
pub struct FillsResponse {
    pub fills: Vec<FillResponse>,
}

impl AssetInfo {
    pub fn as_key(&self) -> String {
        match self {
            AssetInfo::NativeToken { denom } => format!("native:{denom}"),
            AssetInfo::Token { contract_addr } => format!("cw20:{contract_addr}"),
        }
    }
}

pub fn market_key(base_asset: &AssetInfo, quote_asset: &AssetInfo) -> String {
    format!("{}__{}", base_asset.as_key(), quote_asset.as_key())
}