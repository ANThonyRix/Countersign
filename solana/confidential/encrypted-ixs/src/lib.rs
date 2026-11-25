use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub struct Position {
        sol_milli: u64,
        reserve_cents: u64,
        redemption_cents: u64,
    }

    /// Returns 0 for review, 1 for covered and 2 for out-of-range inputs.
    #[instruction]
    pub fn check_liquidity(position: Enc<Shared, Position>, price_cents: u64) -> Enc<Shared, u8> {
        let amounts = position.to_arcis();
        let valid = (amounts.sol_milli <= 1_000_000_000)
            & (amounts.reserve_cents <= 1_000_000_000)
            & (amounts.redemption_cents <= 1_000_000_000)
            & (amounts.redemption_cents > 0)
            & (price_cents > 0)
            & (price_cents <= 10_000_000);

        // Multiply through by 5,000 to apply the 20% haircut without rounding a cent.
        let assets = amounts.reserve_cents * 5_000 + amounts.sol_milli * price_cents * 4;
        let required = amounts.redemption_cents * 5_000;
        let verdict = if valid {
            if assets >= required { 1u8 } else { 0u8 }
        } else {
            2u8
        };
        position.owner.from_arcis(verdict)
    }
}
