use cosmwasm_std::{OverflowError, StdError};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("{0}")]
    Overflow(#[from] OverflowError),

    #[error("unauthorized")]
    Unauthorized,

    #[error("invalid price")]
    InvalidPrice,

    #[error("invalid market")]
    InvalidMarket,

    #[error("duplicate asset pair is not allowed")]
    DuplicateAssets,

    #[error("unsupported asset")]
    UnsupportedAsset,

    #[error("invalid funds sent")]
    InvalidFunds,

    #[error("empty amount")]
    EmptyAmount,

    #[error("order not found")]
    OrderNotFound,

    #[error("fill amount exceeds remaining order size")]
    FillTooLarge,

    #[error("order is not open")]
    OrderNotOpen,

    #[error("insufficient escrow")]
    InsufficientEscrow,

    #[error("cw20 sender does not match expected token contract")]
    InvalidCw20Sender,

    #[error("invalid treasury fee bps")]
    InvalidFeeBps,

    #[error("minimum order size must be greater than zero")]
    InvalidMinimumOrderSize,

    #[error("base amount is below the configured minimum order size")]
    OrderBelowMinimum,

    #[error("invalid max matches per order")]
    InvalidMatchLimit,
}