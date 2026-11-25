use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CircuitSource, OffChainCircuitSource};
use arcium_macros::circuit_hash;

const COMP_DEF_OFFSET_CHECK_LIQUIDITY: u32 = comp_def_offset("check_liquidity");

declare_id!("EbFG12L4EqbuCqKkhf3hbThgXz43wXAAXr3psBQGPoAz");

#[arcium_program]
pub mod countersign_confidential {
    use super::*;

    pub fn init_check_liquidity_comp_def(ctx: Context<InitCheckLiquidityCompDef>) -> Result<()> {
        init_computation_def(ctx.accounts, Some(CircuitSource::OffChain(OffChainCircuitSource {
            source: "https://countersign.ink/artifacts/confidential-liquidity-v1-0d0268ae.arcis".to_string(),
            hash: circuit_hash!("check_liquidity"),
        })))?;
        Ok(())
    }

    pub fn check_liquidity(
        ctx: Context<CheckLiquidity>,
        computation_offset: u64,
        ciphertexts: [[u8; 32]; 3],
        pub_key: [u8; 32],
        nonce: u128,
        price_cents: u64,
        market_digest: [u8; 32],
    ) -> Result<()> {
        require!(price_cents > 0 && price_cents <= 10_000_000, ErrorCode::MarketInput);
        require!(market_digest != [0; 32], ErrorCode::MarketInput);
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_u64(ciphertexts[0])
            .encrypted_u64(ciphertexts[1])
            .encrypted_u64(ciphertexts[2])
            .plaintext_u64(price_cents)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![CheckLiquidityCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "check_liquidity")]
    pub fn check_liquidity_callback(
        ctx: Context<CheckLiquidityCallback>,
        output: SignedComputationOutputs<CheckLiquidityOutput>,
    ) -> Result<()> {
        let CheckLiquidityOutput { field_0: encrypted } = output
            .verify_output(&ctx.accounts.cluster_account, &ctx.accounts.computation_account)
            .map_err(|_| ErrorCode::AbortedComputation)?;

        emit!(LiquidityComputed {
            computation: ctx.accounts.computation_account.key(),
            ciphertext: encrypted.ciphertexts[0],
            nonce: encrypted.nonce.to_le_bytes(),
        });
        Ok(())
    }
}

#[queue_computation_accounts("check_liquidity", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CheckLiquidity<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init_if_needed, space = 9, payer = payer, seeds = [&SIGN_PDA_SEED], bump, address = derive_sign_pda!())]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account))]
    /// CHECK: Validated by Arcium.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account))]
    /// CHECK: Validated by Arcium.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account))]
    /// CHECK: This is the computation PDA created by Arcium.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHECK_LIQUIDITY))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("check_liquidity")]
#[derive(Accounts)]
pub struct CheckLiquidityCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHECK_LIQUIDITY))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: The callback macro and `verify_output` bind the computation to the signed response.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = ::arcium_anchor::solana_instructions_sysvar::ID)]
    /// CHECK: Required by the Arcium callback macro.
    pub instructions_sysvar: UncheckedAccount<'info>,
}

#[init_computation_definition_accounts("check_liquidity", payer)]
#[derive(Accounts)]
pub struct InitCheckLiquidityCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: Created by Arcium.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: The MXE lookup table is validated by Arcium.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: Fixed address of the lookup table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct LiquidityComputed {
    pub computation: Pubkey,
    pub ciphertext: [u8; 32],
    pub nonce: [u8; 16],
}

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("Invalid public market input")]
    MarketInput,
}
