use cosmwasm_std::{Addr, Uint128};
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::msg::{AssetInfo, OrderSide, OrderStatus};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
pub struct Config {
    pub admin: Option<Addr>,
    pub treasury: Addr,
    pub treasury_fee_bps: u16,
    pub min_order_size: Uint128,
    pub max_matches_per_order: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
pub struct Order {
    pub id: u64,
    pub owner: Addr,
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
pub struct Fill {
    pub id: u64,
    pub order_id: u64,
    pub maker: Addr,
    pub taker: Addr,
    pub base_amount: Uint128,
    pub quote_amount: Uint128,
    pub timestamp: u64,
}

pub const CONFIG: Item<Config> = Item::new("config");

pub const NEXT_ORDER_ID: Item<u64> = Item::new("next_order_id");
pub const NEXT_FILL_ID: Item<u64> = Item::new("next_fill_id");

pub const ORDERS: Map<u64, Order> = Map::new("orders");
pub const FILLS: Map<u64, Fill> = Map::new("fills");

pub const USER_ORDER_IDS: Map<&Addr, Vec<u64>> = Map::new("user_order_ids");
pub const MARKET_ORDER_IDS: Map<&str, Vec<u64>> = Map::new("market_order_ids");
pub const ORDER_FILL_IDS: Map<u64, Vec<u64>> = Map::new("order_fill_ids");

pub const MARKETS: Item<Vec<String>> = Item::new("markets");