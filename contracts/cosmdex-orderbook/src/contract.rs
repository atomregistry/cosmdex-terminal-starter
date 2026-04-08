use std::cmp::Ordering;

use cosmwasm_std::{
    entry_point, from_json, to_json_binary, Addr, BankMsg, Binary, Coin, CosmosMsg, Deps, DepsMut,
    Env, MessageInfo, Response, StdResult, Storage, Uint128, Uint256, WasmMsg,
};
use cw2::set_contract_version;
use cw20::{Cw20ExecuteMsg, Cw20ReceiveMsg};

use crate::{
    error::ContractError,
    msg::{
        market_key, AssetInfo, ConfigResponse, Cw20HookMsg, ExecuteMsg, FillResponse, FillsResponse,
        InstantiateMsg, MarketBookResponse, MarketsResponse, OrderResponse, OrderSide, OrderStatus,
        OrdersResponse, QueryMsg,
    },
    state::{
        Config, Fill, Order, CONFIG, FILLS, MARKET_ORDER_IDS, MARKETS, NEXT_FILL_ID, NEXT_ORDER_ID,
        ORDER_FILL_IDS, ORDERS, USER_ORDER_IDS,
    },
};

const CONTRACT_NAME: &str = "cosmdex-orderbook";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_TREASURY_FEE_BPS: u16 = 1000;
const MAX_MATCHES_PER_ORDER: u32 = 50;

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    validate_instantiate_config(&msg)?;

    let admin = match msg.admin {
        Some(a) => Some(deps.api.addr_validate(&a)?),
        None => None,
    };

    let treasury = deps.api.addr_validate(&msg.treasury)?;

    let cfg = Config {
        admin,
        treasury,
        treasury_fee_bps: msg.treasury_fee_bps,
        min_order_size: msg.min_order_size,
        max_matches_per_order: msg.max_matches_per_order,
    };

    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    CONFIG.save(deps.storage, &cfg)?;
    NEXT_ORDER_ID.save(deps.storage, &1u64)?;
    NEXT_FILL_ID.save(deps.storage, &1u64)?;
    MARKETS.save(deps.storage, &Vec::new())?;

    Ok(Response::new()
        .add_attribute("action", "instantiate")
        .add_attribute("contract", CONTRACT_NAME)
        .add_attribute("treasury", cfg.treasury)
        .add_attribute("treasury_fee_bps", cfg.treasury_fee_bps.to_string())
        .add_attribute("min_order_size", cfg.min_order_size)
        .add_attribute("max_matches_per_order", cfg.max_matches_per_order.to_string()))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::CreateOrder {
            side,
            base_asset,
            quote_asset,
            price_num,
            price_denom,
            base_amount,
        } => execute_create_order(
            deps,
            env,
            info,
            side,
            base_asset,
            quote_asset,
            price_num,
            price_denom,
            base_amount,
        ),
        ExecuteMsg::CancelOrder { order_id } => execute_cancel_order(deps, info, order_id),
        ExecuteMsg::FillOrder {
            order_id,
            base_amount,
        } => execute_fill_order(deps, env, info, order_id, base_amount),
        ExecuteMsg::Receive(msg) => execute_receive(deps, env, info, msg),
    }
}

fn execute_receive(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: Cw20ReceiveMsg,
) -> Result<Response, ContractError> {
    let hook: Cw20HookMsg = from_json(&msg.msg)?;
    let sender = deps.api.addr_validate(&msg.sender)?;
    let cw20_sender = info.sender.to_string();

    match hook {
        Cw20HookMsg::CreateOrder {
            side,
            base_asset,
            quote_asset,
            price_num,
            price_denom,
            base_amount,
        } => execute_create_order_cw20(
            deps,
            env,
            sender,
            cw20_sender,
            side,
            base_asset,
            quote_asset,
            price_num,
            price_denom,
            base_amount,
            msg.amount,
        ),
        Cw20HookMsg::FillOrder {
            order_id,
            base_amount,
        } => execute_fill_order_cw20(
            deps,
            env,
            sender,
            cw20_sender,
            order_id,
            base_amount,
            msg.amount,
        ),
    }
}

#[allow(clippy::too_many_arguments)]
fn execute_create_order(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    side: OrderSide,
    base_asset: AssetInfo,
    quote_asset: AssetInfo,
    price_num: Uint128,
    price_denom: Uint128,
    base_amount: Uint128,
) -> Result<Response, ContractError> {
    let cfg = CONFIG.load(deps.storage)?;

    validate_market(&base_asset, &quote_asset)?;
    validate_price(price_num, price_denom)?;
    validate_min_order_size(base_amount, cfg.min_order_size)?;

    let escrow_required =
        required_escrow_amount(&side, base_amount, price_num, price_denom, cfg.treasury_fee_bps)?;

    match side {
        OrderSide::Sell => validate_native_deposit(&info, &base_asset, escrow_required)?,
        OrderSide::Buy => validate_native_deposit(&info, &quote_asset, escrow_required)?,
    }

    process_new_order(
        deps,
        env,
        info.sender,
        side,
        base_asset,
        quote_asset,
        price_num,
        price_denom,
        base_amount,
        escrow_required,
    )
}

#[allow(clippy::too_many_arguments)]
fn execute_create_order_cw20(
    deps: DepsMut,
    env: Env,
    owner: Addr,
    cw20_sender: String,
    side: OrderSide,
    base_asset: AssetInfo,
    quote_asset: AssetInfo,
    price_num: Uint128,
    price_denom: Uint128,
    base_amount: Uint128,
    received_amount: Uint128,
) -> Result<Response, ContractError> {
    let cfg = CONFIG.load(deps.storage)?;

    validate_market(&base_asset, &quote_asset)?;
    validate_price(price_num, price_denom)?;
    validate_min_order_size(base_amount, cfg.min_order_size)?;

    let escrow_required =
        required_escrow_amount(&side, base_amount, price_num, price_denom, cfg.treasury_fee_bps)?;

    match side {
        OrderSide::Sell => {
            validate_cw20_deposit(&base_asset, &cw20_sender, escrow_required, received_amount)?
        }
        OrderSide::Buy => {
            validate_cw20_deposit(&quote_asset, &cw20_sender, escrow_required, received_amount)?
        }
    }

    process_new_order(
        deps,
        env,
        owner,
        side,
        base_asset,
        quote_asset,
        price_num,
        price_denom,
        base_amount,
        escrow_required,
    )
}

#[allow(clippy::too_many_arguments)]
fn process_new_order(
    deps: DepsMut,
    env: Env,
    owner: Addr,
    side: OrderSide,
    base_asset: AssetInfo,
    quote_asset: AssetInfo,
    price_num: Uint128,
    price_denom: Uint128,
    base_amount: Uint128,
    escrow_available: Uint128,
) -> Result<Response, ContractError> {
    let cfg = CONFIG.load(deps.storage)?;
    let market = market_key(&base_asset, &quote_asset);

    let mut remaining_base = base_amount;
    let mut remaining_escrow = escrow_available;
    let mut msgs: Vec<CosmosMsg> = Vec::new();
    let mut matched_count: u32 = 0;

    let matches = find_matchable_orders(
        deps.as_ref(),
        &market,
        &side,
        price_num,
        price_denom,
        cfg.max_matches_per_order,
    )?;

    for maker_order in matches {
        if remaining_base.is_zero() {
            break;
        }

        let fill_base = remaining_base.min(maker_order.remaining_base_amount);
        let (_, _, total_quote) =
            quote_and_fee(fill_base, maker_order.price_num, maker_order.price_denom, cfg.treasury_fee_bps)?;

        match side {
            OrderSide::Buy => {
                if remaining_escrow < total_quote {
                    return Err(ContractError::InsufficientEscrow);
                }
                remaining_escrow = remaining_escrow.checked_sub(total_quote)?;
            }
            OrderSide::Sell => {
                if remaining_escrow < fill_base {
                    return Err(ContractError::InsufficientEscrow);
                }
                remaining_escrow = remaining_escrow.checked_sub(fill_base)?;
            }
        }

        let (updated_order, settlement_msgs, fill) =
            settle_maker_fill(deps.storage, &cfg, &env, maker_order, owner.clone(), fill_base)?;

        ORDERS.save(deps.storage, updated_order.id, &updated_order)?;
        let fill_id = create_fill_record(deps.storage, fill)?;
        msgs.extend(settlement_msgs);

        matched_count += 1;
        remaining_base = remaining_base.checked_sub(fill_base)?;

        msgs.shrink_to_fit();

        let _ = fill_id;
    }

    let mut response = Response::new()
        .add_messages(msgs)
        .add_attribute("action", "create_order")
        .add_attribute("owner", owner.clone())
        .add_attribute("market_key", market.clone())
        .add_attribute("side", format!("{:?}", side).to_lowercase())
        .add_attribute("original_base_amount", base_amount)
        .add_attribute("matched_count", matched_count.to_string())
        .add_attribute("remaining_base_amount", remaining_base);

    if remaining_base.is_zero() {
        if !remaining_escrow.is_zero() {
            let refund_asset = escrow_asset_for_side(&side, &base_asset, &quote_asset);
            let refund_msg = payout_msg(&refund_asset, remaining_escrow, &owner)?;
            response = response
                .add_message(refund_msg)
                .add_attribute("refunded_amount", remaining_escrow);
        }

        return Ok(response.add_attribute("resting_order_created", "false"));
    }

    let order = create_order_record(
        deps,
        env,
        owner,
        side,
        base_asset,
        quote_asset,
        price_num,
        price_denom,
        remaining_base,
        remaining_escrow,
    )?;

    Ok(response
        .add_attribute("resting_order_created", "true")
        .add_attribute("order_id", order.id.to_string())
        .add_attribute("escrowed_amount", order.escrowed_amount))
}

fn execute_cancel_order(
    deps: DepsMut,
    info: MessageInfo,
    order_id: u64,
) -> Result<Response, ContractError> {
    let mut order = ORDERS
        .may_load(deps.storage, order_id)?
        .ok_or(ContractError::OrderNotFound)?;

    if order.owner != info.sender {
        return Err(ContractError::Unauthorized);
    }

    if !matches!(order.status, OrderStatus::Open | OrderStatus::PartiallyFilled) {
        return Err(ContractError::OrderNotOpen);
    }

    let refund_asset = escrow_asset_for_order(&order);
    let refund_amount = order.escrowed_amount;

    order.status = OrderStatus::Cancelled;
    order.updated_at = order.created_at.max(order.updated_at);
    order.escrowed_amount = Uint128::zero();

    ORDERS.save(deps.storage, order_id, &order)?;

    let refund_msg = payout_msg(&refund_asset, refund_amount, &info.sender)?;

    Ok(Response::new()
        .add_message(refund_msg)
        .add_attribute("action", "cancel_order")
        .add_attribute("order_id", order_id.to_string())
        .add_attribute("owner", info.sender)
        .add_attribute("refund_amount", refund_amount))
}

fn execute_fill_order(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    order_id: u64,
    base_amount: Uint128,
) -> Result<Response, ContractError> {
    let cfg = CONFIG.load(deps.storage)?;

    ensure_nonzero(base_amount)?;
    validate_min_order_size(base_amount, cfg.min_order_size)?;

    let maker_order = ORDERS
        .may_load(deps.storage, order_id)?
        .ok_or(ContractError::OrderNotFound)?;

    if !matches!(maker_order.status, OrderStatus::Open | OrderStatus::PartiallyFilled) {
        return Err(ContractError::OrderNotOpen);
    }

    if base_amount > maker_order.remaining_base_amount {
        return Err(ContractError::FillTooLarge);
    }

    let (_, _, total_quote) = quote_and_fee(
        base_amount,
        maker_order.price_num,
        maker_order.price_denom,
        cfg.treasury_fee_bps,
    )?;

    match maker_order.side {
        OrderSide::Sell => validate_native_deposit(&info, &maker_order.quote_asset, total_quote)?,
        OrderSide::Buy => validate_native_deposit(&info, &maker_order.base_asset, base_amount)?,
    }

    finalize_manual_fill(deps, env, maker_order, info.sender, base_amount)
}

fn execute_fill_order_cw20(
    deps: DepsMut,
    env: Env,
    taker: Addr,
    cw20_sender: String,
    order_id: u64,
    base_amount: Uint128,
    received_amount: Uint128,
) -> Result<Response, ContractError> {
    let cfg = CONFIG.load(deps.storage)?;

    ensure_nonzero(base_amount)?;
    validate_min_order_size(base_amount, cfg.min_order_size)?;

    let maker_order = ORDERS
        .may_load(deps.storage, order_id)?
        .ok_or(ContractError::OrderNotFound)?;

    if !matches!(maker_order.status, OrderStatus::Open | OrderStatus::PartiallyFilled) {
        return Err(ContractError::OrderNotOpen);
    }

    if base_amount > maker_order.remaining_base_amount {
        return Err(ContractError::FillTooLarge);
    }

    let (_, _, total_quote) = quote_and_fee(
        base_amount,
        maker_order.price_num,
        maker_order.price_denom,
        cfg.treasury_fee_bps,
    )?;

    match maker_order.side {
        OrderSide::Sell => {
            validate_cw20_deposit(&maker_order.quote_asset, &cw20_sender, total_quote, received_amount)?
        }
        OrderSide::Buy => {
            validate_cw20_deposit(&maker_order.base_asset, &cw20_sender, base_amount, received_amount)?
        }
    }

    finalize_manual_fill(deps, env, maker_order, taker, base_amount)
}

fn finalize_manual_fill(
    deps: DepsMut,
    env: Env,
    maker_order: Order,
    taker: Addr,
    base_amount: Uint128,
) -> Result<Response, ContractError> {
    let cfg = CONFIG.load(deps.storage)?;
    let (updated_order, msgs, fill) = settle_maker_fill(deps.storage, &cfg, &env, maker_order, taker.clone(), base_amount)?;
    let fill_id = create_fill_record(deps.storage, fill)?;
    ORDERS.save(deps.storage, updated_order.id, &updated_order)?;

    Ok(Response::new()
        .add_messages(msgs)
        .add_attribute("action", "fill_order")
        .add_attribute("order_id", updated_order.id.to_string())
        .add_attribute("fill_id", fill_id.to_string())
        .add_attribute("taker", taker)
        .add_attribute("status", format!("{:?}", updated_order.status).to_lowercase()))
}

fn settle_maker_fill(
    storage: &mut dyn Storage,
    cfg: &Config,
    env: &Env,
    mut maker_order: Order,
    taker: Addr,
    base_amount: Uint128,
) -> Result<(Order, Vec<CosmosMsg>, Fill), ContractError> {
    if maker_order.owner == taker {
        return Err(ContractError::Unauthorized);
    }

    if base_amount > maker_order.remaining_base_amount {
        return Err(ContractError::FillTooLarge);
    }

    let (quote_amount, fee_amount_value, total_quote) = quote_and_fee(
        base_amount,
        maker_order.price_num,
        maker_order.price_denom,
        cfg.treasury_fee_bps,
    )?;

    let mut msgs: Vec<CosmosMsg> = Vec::new();

    match maker_order.side {
        OrderSide::Sell => {
            if maker_order.escrowed_amount < base_amount {
                return Err(ContractError::InsufficientEscrow);
            }

            msgs.push(payout_msg(&maker_order.base_asset, base_amount, &taker)?);
            msgs.push(payout_msg(&maker_order.quote_asset, quote_amount, &maker_order.owner)?);

            if !fee_amount_value.is_zero() {
                msgs.push(payout_msg(
                    &maker_order.quote_asset,
                    fee_amount_value,
                    &cfg.treasury,
                )?);
            }

            maker_order.escrowed_amount = maker_order.escrowed_amount.checked_sub(base_amount)?;
        }
        OrderSide::Buy => {
            if maker_order.escrowed_amount < total_quote {
                return Err(ContractError::InsufficientEscrow);
            }

            msgs.push(payout_msg(&maker_order.base_asset, base_amount, &maker_order.owner)?);
            msgs.push(payout_msg(&maker_order.quote_asset, quote_amount, &taker)?);

            if !fee_amount_value.is_zero() {
                msgs.push(payout_msg(
                    &maker_order.quote_asset,
                    fee_amount_value,
                    &cfg.treasury,
                )?);
            }

            maker_order.escrowed_amount = maker_order.escrowed_amount.checked_sub(total_quote)?;
        }
    }

    maker_order.remaining_base_amount = maker_order.remaining_base_amount.checked_sub(base_amount)?;
    maker_order.updated_at = env.block.time.seconds();
    maker_order.status = if maker_order.remaining_base_amount.is_zero() {
        OrderStatus::Filled
    } else {
        OrderStatus::PartiallyFilled
    };

    let fill = Fill {
        id: 0,
        order_id: maker_order.id,
        maker: maker_order.owner.clone(),
        taker,
        base_amount,
        quote_amount,
        timestamp: env.block.time.seconds(),
    };

    let _ = storage;

    Ok((maker_order, msgs, fill))
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_json_binary(&query_config(deps)?),
        QueryMsg::MarketBook {
            base_asset,
            quote_asset,
            limit,
        } => to_json_binary(&query_market_book(deps, base_asset, quote_asset, limit)?),
        QueryMsg::Markets { start_after, limit } => {
            to_json_binary(&query_markets(deps, start_after, limit)?)
        }
        QueryMsg::Order { order_id } => to_json_binary(&query_order(deps, order_id)?),
        QueryMsg::OrdersByUser {
            address,
            start_after,
            limit,
        } => to_json_binary(&query_orders_by_user(deps, address, start_after, limit)?),
        QueryMsg::OrdersByMarket {
            base_asset,
            quote_asset,
            side,
            start_after,
            limit,
        } => to_json_binary(&query_orders_by_market(
            deps,
            base_asset,
            quote_asset,
            side,
            start_after,
            limit,
        )?),
        QueryMsg::FillsByOrder {
            order_id,
            start_after,
            limit,
        } => to_json_binary(&query_fills_by_order(deps, order_id, start_after, limit)?),
    }
}

fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    let cfg = CONFIG.load(deps.storage)?;
    let next_order_id = NEXT_ORDER_ID.load(deps.storage)?;
    let next_fill_id = NEXT_FILL_ID.load(deps.storage)?;

    Ok(ConfigResponse {
        admin: cfg.admin.map(|a| a.to_string()),
        treasury: cfg.treasury.to_string(),
        treasury_fee_bps: cfg.treasury_fee_bps,
        min_order_size: cfg.min_order_size,
        max_matches_per_order: cfg.max_matches_per_order,
        next_order_id,
        next_fill_id,
    })
}

fn query_order(deps: Deps, order_id: u64) -> StdResult<OrderResponse> {
    let order = ORDERS
        .may_load(deps.storage, order_id)?
        .ok_or_else(|| cosmwasm_std::StdError::generic_err("order not found"))?;
    Ok(order_to_response(order))
}

fn query_orders_by_user(
    deps: Deps,
    address: String,
    start_after: Option<u64>,
    limit: Option<u32>,
) -> StdResult<OrdersResponse> {
    let addr = deps.api.addr_validate(&address)?;
    let ids = USER_ORDER_IDS
        .may_load(deps.storage, &addr)?
        .unwrap_or_default();

    let orders = ids_to_orders(deps, ids, start_after, limit, None)?;
    Ok(OrdersResponse { orders })
}

fn query_orders_by_market(
    deps: Deps,
    base_asset: AssetInfo,
    quote_asset: AssetInfo,
    side: Option<OrderSide>,
    start_after: Option<u64>,
    limit: Option<u32>,
) -> StdResult<OrdersResponse> {
    let key = market_key(&base_asset, &quote_asset);
    let ids = MARKET_ORDER_IDS
        .may_load(deps.storage, key.as_str())?
        .unwrap_or_default();

    let orders = ids_to_orders(deps, ids, start_after, limit, side)?;
    Ok(OrdersResponse { orders })
}

fn query_market_book(
    deps: Deps,
    base_asset: AssetInfo,
    quote_asset: AssetInfo,
    limit: Option<u32>,
) -> StdResult<MarketBookResponse> {
    let key = market_key(&base_asset, &quote_asset);
    let ids = MARKET_ORDER_IDS
        .may_load(deps.storage, key.as_str())?
        .unwrap_or_default();

    let mut buys: Vec<OrderResponse> = Vec::new();
    let mut sells: Vec<OrderResponse> = Vec::new();
    let take = limit.unwrap_or(50).min(200) as usize;

    for id in ids {
        if let Some(order) = ORDERS.may_load(deps.storage, id)? {
            if !matches!(order.status, OrderStatus::Open | OrderStatus::PartiallyFilled) {
                continue;
            }

            let response = order_to_response(order.clone());
            match order.side {
                OrderSide::Buy => buys.push(response),
                OrderSide::Sell => sells.push(response),
            }
        }
    }

    buys.sort_by(|a, b| {
        compare_price(
            b.price_num,
            b.price_denom,
            a.price_num,
            a.price_denom,
        )
        .then_with(|| a.id.cmp(&b.id))
    });

    sells.sort_by(|a, b| {
        compare_price(
            a.price_num,
            a.price_denom,
            b.price_num,
            b.price_denom,
        )
        .then_with(|| a.id.cmp(&b.id))
    });

    buys.truncate(take);
    sells.truncate(take);

    Ok(MarketBookResponse {
        market_key: key,
        base_asset,
        quote_asset,
        buy_orders: buys,
        sell_orders: sells,
    })
}

fn query_markets(
    deps: Deps,
    start_after: Option<String>,
    limit: Option<u32>,
) -> StdResult<MarketsResponse> {
    let markets = MARKETS.load(deps.storage)?;
    let take = limit.unwrap_or(100).min(500) as usize;

    let filtered: Vec<String> = match start_after {
        Some(start) => markets.into_iter().filter(|m| m > &start).take(take).collect(),
        None => markets.into_iter().take(take).collect(),
    };

    Ok(MarketsResponse { markets: filtered })
}

fn query_fills_by_order(
    deps: Deps,
    order_id: u64,
    start_after: Option<u64>,
    limit: Option<u32>,
) -> StdResult<FillsResponse> {
    let ids = ORDER_FILL_IDS
        .may_load(deps.storage, order_id)?
        .unwrap_or_default();

    let mut fills: Vec<FillResponse> = Vec::new();
    let take = limit.unwrap_or(50).min(200) as usize;

    for fill_id in ids {
        if let Some(start_after) = start_after {
            if fill_id <= start_after {
                continue;
            }
        }

        if let Some(fill) = FILLS.may_load(deps.storage, fill_id)? {
            fills.push(fill_to_response(fill));
            if fills.len() >= take {
                break;
            }
        }
    }

    Ok(FillsResponse { fills })
}

#[allow(clippy::too_many_arguments)]
fn create_order_record(
    deps: DepsMut,
    env: Env,
    owner: Addr,
    side: OrderSide,
    base_asset: AssetInfo,
    quote_asset: AssetInfo,
    price_num: Uint128,
    price_denom: Uint128,
    base_amount: Uint128,
    escrowed_amount: Uint128,
) -> Result<Order, ContractError> {
    let order_id = NEXT_ORDER_ID.load(deps.storage)?;
    NEXT_ORDER_ID.save(deps.storage, &(order_id + 1))?;

    let key = market_key(&base_asset, &quote_asset);
    ensure_market_registered(deps.storage, &key)?;

    let timestamp = env.block.time.seconds();

    let order = Order {
        id: order_id,
        owner: owner.clone(),
        market_key: key.clone(),
        side,
        base_asset,
        quote_asset,
        price_num,
        price_denom,
        original_base_amount: base_amount,
        remaining_base_amount: base_amount,
        escrowed_amount,
        status: OrderStatus::Open,
        created_at: timestamp,
        updated_at: timestamp,
    };

    ORDERS.save(deps.storage, order_id, &order)?;
    append_user_order_id(deps.storage, &owner, order_id)?;
    append_market_order_id(deps.storage, key.as_str(), order_id)?;

    Ok(order)
}

fn create_fill_record(
    storage: &mut dyn Storage,
    mut fill: Fill,
) -> Result<u64, ContractError> {
    let fill_id = NEXT_FILL_ID.load(storage)?;
    NEXT_FILL_ID.save(storage, &(fill_id + 1))?;

    fill.id = fill_id;

    FILLS.save(storage, fill_id, &fill)?;
    append_order_fill_id(storage, fill.order_id, fill_id)?;

    Ok(fill_id)
}

fn find_matchable_orders(
    deps: Deps,
    market: &str,
    incoming_side: &OrderSide,
    incoming_price_num: Uint128,
    incoming_price_denom: Uint128,
    limit: u32,
) -> StdResult<Vec<Order>> {
    let ids = MARKET_ORDER_IDS
        .may_load(deps.storage, market)?
        .unwrap_or_default();

    let opposite_side = match incoming_side {
        OrderSide::Buy => OrderSide::Sell,
        OrderSide::Sell => OrderSide::Buy,
    };

    let mut out: Vec<Order> = Vec::new();

    for id in ids {
        if let Some(order) = ORDERS.may_load(deps.storage, id)? {
            if order.side != opposite_side {
                continue;
            }

            if !matches!(order.status, OrderStatus::Open | OrderStatus::PartiallyFilled) {
                continue;
            }

            if !price_crosses(
                incoming_side,
                incoming_price_num,
                incoming_price_denom,
                order.price_num,
                order.price_denom,
            ) {
                continue;
            }

            out.push(order);
        }
    }

    out.sort_by(|a, b| match incoming_side {
        OrderSide::Buy => compare_price(a.price_num, a.price_denom, b.price_num, b.price_denom)
            .then_with(|| a.id.cmp(&b.id)),
        OrderSide::Sell => compare_price(b.price_num, b.price_denom, a.price_num, a.price_denom)
            .then_with(|| a.id.cmp(&b.id)),
    });

    out.truncate(limit as usize);
    Ok(out)
}

fn ids_to_orders(
    deps: Deps,
    ids: Vec<u64>,
    start_after: Option<u64>,
    limit: Option<u32>,
    side: Option<OrderSide>,
) -> StdResult<Vec<OrderResponse>> {
    let take = limit.unwrap_or(50).min(200) as usize;
    let mut out: Vec<OrderResponse> = Vec::new();

    for id in ids {
        if let Some(start_after) = start_after {
            if id <= start_after {
                continue;
            }
        }

        if let Some(order) = ORDERS.may_load(deps.storage, id)? {
            if let Some(side_filter) = side.clone() {
                if order.side != side_filter {
                    continue;
                }
            }

            out.push(order_to_response(order));

            if out.len() >= take {
                break;
            }
        }
    }

    Ok(out)
}

fn order_to_response(order: Order) -> OrderResponse {
    OrderResponse {
        id: order.id,
        owner: order.owner.to_string(),
        market_key: order.market_key,
        side: order.side,
        base_asset: order.base_asset,
        quote_asset: order.quote_asset,
        price_num: order.price_num,
        price_denom: order.price_denom,
        original_base_amount: order.original_base_amount,
        remaining_base_amount: order.remaining_base_amount,
        escrowed_amount: order.escrowed_amount,
        status: order.status,
        created_at: order.created_at,
        updated_at: order.updated_at,
    }
}

fn fill_to_response(fill: Fill) -> FillResponse {
    FillResponse {
        id: fill.id,
        order_id: fill.order_id,
        maker: fill.maker.to_string(),
        taker: fill.taker.to_string(),
        base_amount: fill.base_amount,
        quote_amount: fill.quote_amount,
        timestamp: fill.timestamp,
    }
}

fn ensure_market_registered(
    storage: &mut dyn Storage,
    market: &str,
) -> Result<(), ContractError> {
    let mut markets = MARKETS.load(storage)?;
    if !markets.iter().any(|m| m == market) {
        markets.push(market.to_string());
        markets.sort();
        markets.dedup();
        MARKETS.save(storage, &markets)?;
    }
    Ok(())
}

fn append_user_order_id(
    storage: &mut dyn Storage,
    owner: &Addr,
    order_id: u64,
) -> Result<(), ContractError> {
    let mut ids = USER_ORDER_IDS.may_load(storage, owner)?.unwrap_or_default();
    ids.push(order_id);
    USER_ORDER_IDS.save(storage, owner, &ids)?;
    Ok(())
}

fn append_market_order_id(
    storage: &mut dyn Storage,
    market_key: &str,
    order_id: u64,
) -> Result<(), ContractError> {
    let mut ids = MARKET_ORDER_IDS
        .may_load(storage, market_key)?
        .unwrap_or_default();
    ids.push(order_id);
    MARKET_ORDER_IDS.save(storage, market_key, &ids)?;
    Ok(())
}

fn append_order_fill_id(
    storage: &mut dyn Storage,
    order_id: u64,
    fill_id: u64,
) -> Result<(), ContractError> {
    let mut ids = ORDER_FILL_IDS
        .may_load(storage, order_id)?
        .unwrap_or_default();
    ids.push(fill_id);
    ORDER_FILL_IDS.save(storage, order_id, &ids)?;
    Ok(())
}

fn validate_instantiate_config(msg: &InstantiateMsg) -> Result<(), ContractError> {
    if msg.treasury_fee_bps > MAX_TREASURY_FEE_BPS {
        return Err(ContractError::InvalidFeeBps);
    }

    if msg.min_order_size.is_zero() {
        return Err(ContractError::InvalidMinimumOrderSize);
    }

    if msg.max_matches_per_order == 0 || msg.max_matches_per_order > MAX_MATCHES_PER_ORDER {
        return Err(ContractError::InvalidMatchLimit);
    }

    Ok(())
}

fn validate_market(base_asset: &AssetInfo, quote_asset: &AssetInfo) -> Result<(), ContractError> {
    if base_asset == quote_asset {
        return Err(ContractError::DuplicateAssets);
    }
    Ok(())
}

fn validate_price(price_num: Uint128, price_denom: Uint128) -> Result<(), ContractError> {
    if price_num.is_zero() || price_denom.is_zero() {
        return Err(ContractError::InvalidPrice);
    }
    Ok(())
}

fn validate_min_order_size(
    amount: Uint128,
    minimum: Uint128,
) -> Result<(), ContractError> {
    ensure_nonzero(amount)?;
    if amount < minimum {
        return Err(ContractError::OrderBelowMinimum);
    }
    Ok(())
}

fn ensure_nonzero(amount: Uint128) -> Result<(), ContractError> {
    if amount.is_zero() {
        Err(ContractError::EmptyAmount)
    } else {
        Ok(())
    }
}

fn required_escrow_amount(
    side: &OrderSide,
    base_amount: Uint128,
    price_num: Uint128,
    price_denom: Uint128,
    treasury_fee_bps: u16,
) -> Result<Uint128, ContractError> {
    match side {
        OrderSide::Sell => Ok(base_amount),
        OrderSide::Buy => {
            let (_, _, total_quote) =
                quote_and_fee(base_amount, price_num, price_denom, treasury_fee_bps)?;
            Ok(total_quote)
        }
    }
}

fn quote_and_fee(
    base_amount: Uint128,
    price_num: Uint128,
    price_denom: Uint128,
    treasury_fee_bps: u16,
) -> Result<(Uint128, Uint128, Uint128), ContractError> {
    if price_num.is_zero() || price_denom.is_zero() {
        return Err(ContractError::InvalidPrice);
    }

    let quote_amount = base_amount.multiply_ratio(price_num, price_denom);
    let fee_amount_value = if treasury_fee_bps == 0 {
        Uint128::zero()
    } else {
        quote_amount.multiply_ratio(u128::from(treasury_fee_bps), 10_000u128)
    };

    let total_quote = quote_amount.checked_add(fee_amount_value)?;
    Ok((quote_amount, fee_amount_value, total_quote))
}

fn validate_native_deposit(
    info: &MessageInfo,
    expected_asset: &AssetInfo,
    expected_amount: Uint128,
) -> Result<(), ContractError> {
    match expected_asset {
        AssetInfo::NativeToken { denom } => {
            let sent = info
                .funds
                .iter()
                .find(|c| c.denom == *denom)
                .map(|c| c.amount)
                .unwrap_or_default();

            if sent == expected_amount && info.funds.len() == 1 {
                Ok(())
            } else {
                Err(ContractError::InvalidFunds)
            }
        }
        AssetInfo::Token { .. } => Err(ContractError::InvalidFunds),
    }
}

fn validate_cw20_deposit(
    expected_asset: &AssetInfo,
    cw20_sender: &str,
    expected_amount: Uint128,
    received_amount: Uint128,
) -> Result<(), ContractError> {
    match expected_asset {
        AssetInfo::Token { contract_addr } => {
            if contract_addr != cw20_sender {
                return Err(ContractError::InvalidCw20Sender);
            }

            if received_amount != expected_amount {
                return Err(ContractError::InvalidFunds);
            }

            Ok(())
        }
        AssetInfo::NativeToken { .. } => Err(ContractError::InvalidFunds),
    }
}

fn escrow_asset_for_order(order: &Order) -> AssetInfo {
    match order.side {
        OrderSide::Sell => order.base_asset.clone(),
        OrderSide::Buy => order.quote_asset.clone(),
    }
}

fn escrow_asset_for_side(
    side: &OrderSide,
    base_asset: &AssetInfo,
    quote_asset: &AssetInfo,
) -> AssetInfo {
    match side {
        OrderSide::Sell => base_asset.clone(),
        OrderSide::Buy => quote_asset.clone(),
    }
}

fn payout_msg(
    asset_info: &AssetInfo,
    amount: Uint128,
    recipient: &Addr,
) -> Result<CosmosMsg, ContractError> {
    match asset_info {
        AssetInfo::NativeToken { denom } => Ok(BankMsg::Send {
            to_address: recipient.to_string(),
            amount: vec![Coin {
                denom: denom.clone(),
                amount,
            }],
        }
        .into()),
        AssetInfo::Token { contract_addr } => Ok(WasmMsg::Execute {
            contract_addr: contract_addr.clone(),
            msg: to_json_binary(&Cw20ExecuteMsg::Transfer {
                recipient: recipient.to_string(),
                amount,
            })?,
            funds: vec![],
        }
        .into()),
    }
}

fn price_crosses(
    incoming_side: &OrderSide,
    incoming_price_num: Uint128,
    incoming_price_denom: Uint128,
    resting_price_num: Uint128,
    resting_price_denom: Uint128,
) -> bool {
    match incoming_side {
        OrderSide::Buy => {
            compare_price(
                incoming_price_num,
                incoming_price_denom,
                resting_price_num,
                resting_price_denom,
            ) != Ordering::Less
        }
        OrderSide::Sell => {
            compare_price(
                incoming_price_num,
                incoming_price_denom,
                resting_price_num,
                resting_price_denom,
            ) != Ordering::Greater
        }
    }
}

fn compare_price(
    left_num: Uint128,
    left_denom: Uint128,
    right_num: Uint128,
    right_denom: Uint128,
) -> Ordering {
    let left = Uint256::from(left_num).checked_mul(Uint256::from(right_denom)).unwrap();
    let right = Uint256::from(right_num).checked_mul(Uint256::from(left_denom)).unwrap();
    left.cmp(&right)
}