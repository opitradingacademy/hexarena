// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ArenaSettlement
/// @notice Pays out Arena match winners from a backend-managed, pre-funded
///         prize float. This contract NEVER pulls from an external treasury —
///         see design.md D1 "ArenaSettlement funding & access control":
///         (a) pre-funded prize float, backend settle() releases  [CHOSEN]
///         (b) contract pulls from external treasury on settle   [REJECTED]
///
/// @dev Settlement currency: configurable ERC-20 set once at construction
///      (immutable `token`). MiniPay defaults to USDm for CIP-64 fee
///      abstraction on the *client* side, but that is independent of which
///      asset actually custodies match stakes on-chain. We deliberately do
///      NOT hardcode a token address here — the deploy script supplies it as
///      a constructor argument (USDm / USDC / USDT addresses live in
///      packages/shared/chain, verified — never invented in this repo).
///      Rationale for leaving it configurable rather than picking USDC or
///      USDm outright: the backend ledger (apps/server) already computes the
///      exact `amount` to disburse in whatever unit the deposits were made
///      in; pinning the settlement token to match deposits avoids an
///      on-chain swap/bridge step for MVP. Recommended default for the
///      Mainnet deploy is USDC (bridged stable value, widest external
///      liquidity), but operators may redeploy with USDm/USDT without
///      touching this contract's logic.
///
/// @dev Rake: the 20% house rake (arena-settlement spec "House Rake on
///      Payout") is computed OFF-CHAIN by the backend ledger
///      (apps/server/ledger/ledger.ts, HOUSE_RAKE = 0.2) BEFORE calling
///      settle(). This contract receives only the final winner `amount` and
///      does not recompute or verify the rake. Rationale: the rake math
///      depends on ledger state (both players' stakes, draw vs decisive)
///      that is cheaper and simpler to keep in the existing off-chain
///      source-of-truth (design.md D2) than to duplicate on-chain; doing so
///      also avoids a second, divergent rake implementation to keep in sync.
///      Tradeoff accepted: winners cannot independently verify the rake
///      percentage purely from chain data — only that the exact `amount`
///      the backend committed to was, in fact, paid. If per-payout on-chain
///      rake transparency becomes a requirement, `settle` can be extended to
///      accept `(matchId, winner, totalPool)` and compute
///      `amount = totalPool * 80 / 100` here instead.
///
/// @dev Access control: `settle()` is `onlyOperator` — a SINGLE backend
///      signer for MVP (documented operator-trust risk in design.md D1: the
///      operator can settle arbitrarily; v2 should move to a multisig or
///      timelock-controlled operator). Admin functions (`fund`, `withdraw`,
///      `pause`, `unpause`, `setOperator`) are `onlyOwner`.
///
/// @dev Idempotency: `settled[matchId]` is set to `true` BEFORE the token
///      transfer (checks-effects-interactions), combined with
///      `nonReentrant`, so a reentrant or duplicate `settle()` call for the
///      same `matchId` always reverts and no double-payout is possible.
contract ArenaSettlement is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice ERC-20 token used to fund and pay out Arena match prizes.
    IERC20 public immutable token;

    /// @notice Single backend signer authorized to call settle().
    address public operator;

    /// @notice matchId => already settled. Prevents double-payout.
    mapping(bytes32 => bool) public settled;

    event OperatorUpdated(address indexed previousOperator, address indexed newOperator);
    event Funded(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event Settled(bytes32 indexed matchId, address indexed winner, uint256 amount);

    error NotOperator();
    error AlreadySettled(bytes32 matchId);
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientFloat(uint256 requested, uint256 available);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @param token_ ERC-20 used for stake settlement (see token NatSpec above).
    /// @param operator_ initial backend operator address.
    /// @param owner_ initial contract owner (should be a secured admin key,
    ///        NOT the same key as `operator_`).
    constructor(IERC20 token_, address operator_, address owner_) Ownable(owner_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        if (operator_ == address(0)) revert ZeroAddress();
        token = token_;
        operator = operator_;
        emit OperatorUpdated(address(0), operator_);
    }

    /// @notice Rotate the backend operator signer. Owner-only escape hatch
    ///         if the operator key is rotated or compromised.
    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        emit OperatorUpdated(operator, newOperator);
        operator = newOperator;
    }

    /// @notice Top up the prize float. Caller must have approved this
    ///         contract for `amount` beforehand. Anyone may fund (e.g. an
    ///         owner-controlled treasury wallet), but only the owner-set
    ///         operator can ever release funds via settle().
    function fund(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    /// @notice Owner-only escape hatch to withdraw undistributed float funds,
    ///         e.g. to rebalance or in an emergency. See design.md D1.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 available = token.balanceOf(address(this));
        if (amount > available) revert InsufficientFloat(amount, available);
        token.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Pay `amount` of `token` to `winner` for `matchId`. Callable
    ///         once per matchId, only by the operator, only while unpaused.
    /// @dev `amount` is the FINAL post-rake payout computed off-chain by the
    ///      backend ledger — see rake NatSpec above.
    function settle(bytes32 matchId, address winner, uint256 amount)
        external
        onlyOperator
        whenNotPaused
        nonReentrant
    {
        if (winner == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (settled[matchId]) revert AlreadySettled(matchId);

        // Effects before interaction (checks-effects-interactions).
        settled[matchId] = true;

        token.safeTransfer(winner, amount);

        emit Settled(matchId, winner, amount);
    }

    /// @notice Owner-only pause. Blocks settle() while active.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Owner-only unpause.
    function unpause() external onlyOwner {
        _unpause();
    }
}
