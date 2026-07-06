// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArenaSettlement} from "../src/ArenaSettlement.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Covers arena-settlement spec requirements owned by this contract:
///      Settlement Idempotency Per Match, Operator-Only Settlement Access,
///      Admin Pause and Withdraw. House Rake / Non-Negative Balance are
///      ledger (apps/server) requirements, not asserted here.
contract ArenaSettlementTest is Test {
    ArenaSettlement internal arena;
    MockERC20 internal token;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal winner = makeAddr("winner");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant FLOAT = 1_000 ether;

    function setUp() public {
        token = new MockERC20();
        arena = new ArenaSettlement(IERC20(address(token)), operator, owner);

        // Pre-fund the prize float (design.md D1: pre-funded, not
        // pulled from external treasury on settle).
        token.mint(owner, FLOAT);
        vm.startPrank(owner);
        token.approve(address(arena), FLOAT);
        arena.fund(FLOAT);
        vm.stopPrank();
    }

    /// @dev Scenario: "First settlement succeeds".
    function test_settle_firstTime_succeeds() public {
        bytes32 matchId = keccak256("match-1");
        uint256 amount = 16 ether; // e.g. $0.16 payout per spec example

        vm.prank(operator);
        arena.settle(matchId, winner, amount);

        assertTrue(arena.settled(matchId));
        assertEq(token.balanceOf(winner), amount);
        assertEq(token.balanceOf(address(arena)), FLOAT - amount);
    }

    /// @dev Scenario: "Duplicate settlement attempt rejected".
    function test_settle_duplicateMatchId_reverts() public {
        bytes32 matchId = keccak256("match-2");
        uint256 amount = 5 ether;

        vm.prank(operator);
        arena.settle(matchId, winner, amount);

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(ArenaSettlement.AlreadySettled.selector, matchId));
        arena.settle(matchId, winner, amount);

        // No second payout disbursed.
        assertEq(token.balanceOf(winner), amount);
    }

    /// @dev Scenario: "Non-operator call rejected".
    function test_settle_calledByNonOperator_reverts() public {
        bytes32 matchId = keccak256("match-3");

        vm.prank(stranger);
        vm.expectRevert(ArenaSettlement.NotOperator.selector);
        arena.settle(matchId, winner, 1 ether);
    }

    /// @dev Owner is also not implicitly the operator — settle() must
    ///      still be gated strictly on the `operator` address.
    function test_settle_calledByOwner_revertsUnlessAlsoOperator() public {
        bytes32 matchId = keccak256("match-3b");

        vm.prank(owner);
        vm.expectRevert(ArenaSettlement.NotOperator.selector);
        arena.settle(matchId, winner, 1 ether);
    }

    /// @dev Scenario: "Paused settlement blocked".
    function test_settle_whilePaused_reverts() public {
        bytes32 matchId = keccak256("match-4");

        vm.prank(owner);
        arena.pause();

        vm.prank(operator);
        vm.expectRevert();
        arena.settle(matchId, winner, 1 ether);
    }

    function test_settle_afterUnpause_succeedsAgain() public {
        bytes32 matchId = keccak256("match-5");

        vm.prank(owner);
        arena.pause();
        vm.prank(owner);
        arena.unpause();

        vm.prank(operator);
        arena.settle(matchId, winner, 1 ether);

        assertTrue(arena.settled(matchId));
    }

    /// @dev "Admin Pause and Withdraw" — fund/withdraw are owner-only.
    function test_fund_byNonOwner_stillSucceeds_anyoneCanTopUpFloat() public {
        // fund() is intentionally open to any funder (e.g. a treasury
        // relayer) — only settle()/withdraw() are privileged. Documented
        // in NatSpec on `fund`.
        token.mint(stranger, 10 ether);
        vm.startPrank(stranger);
        token.approve(address(arena), 10 ether);
        arena.fund(10 ether);
        vm.stopPrank();

        assertEq(token.balanceOf(address(arena)), FLOAT + 10 ether);
    }

    function test_withdraw_byOwner_succeeds() public {
        vm.prank(owner);
        arena.withdraw(owner, 100 ether);

        assertEq(token.balanceOf(owner), 100 ether);
        assertEq(token.balanceOf(address(arena)), FLOAT - 100 ether);
    }

    function test_withdraw_byNonOwner_reverts() public {
        vm.prank(stranger);
        vm.expectRevert();
        arena.withdraw(stranger, 1 ether);
    }

    function test_withdraw_moreThanAvailable_reverts() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(ArenaSettlement.InsufficientFloat.selector, FLOAT + 1, FLOAT)
        );
        arena.withdraw(owner, FLOAT + 1);
    }

    function test_setOperator_byOwner_rotatesOperator() public {
        address newOperator = makeAddr("newOperator");
        vm.prank(owner);
        arena.setOperator(newOperator);

        bytes32 matchId = keccak256("match-6");

        // Old operator no longer authorized.
        vm.prank(operator);
        vm.expectRevert(ArenaSettlement.NotOperator.selector);
        arena.settle(matchId, winner, 1 ether);

        // New operator authorized.
        vm.prank(newOperator);
        arena.settle(matchId, winner, 1 ether);
        assertTrue(arena.settled(matchId));
    }

    function test_setOperator_byNonOwner_reverts() public {
        vm.prank(stranger);
        vm.expectRevert();
        arena.setOperator(stranger);
    }

    // ---------------------------------------------------------------------
    // withdrawUser (operator-driven user cash-out, PR0 of the cash-out change).
    // Idempotency is the central invariant — every test asserts against a
    // unique withdrawalId unless it is specifically testing the duplicate-revert
    // case. `settled[]` and `withdrawn[]` must remain independent mappings;
    // see `test_withdrawUser_doesNotInterfereWithSettle` below.
    // ---------------------------------------------------------------------

    /// @dev Scenario: "First user withdrawal succeeds".
    function test_withdrawUser_firstTime_succeeds() public {
        bytes32 withdrawalId = keccak256("withdrawal-1");
        uint256 amount = 1 ether;
        uint256 arenaBalanceBefore = token.balanceOf(address(arena));

        vm.expectEmit(true, true, false, true, address(arena));
        emit ArenaSettlement.UserWithdrawn(withdrawalId, winner, amount);

        vm.prank(operator);
        arena.withdrawUser(withdrawalId, winner, amount);

        assertTrue(arena.withdrawn(withdrawalId));
        assertEq(token.balanceOf(winner), amount);
        assertEq(token.balanceOf(address(arena)), arenaBalanceBefore - amount);
    }

    /// @dev Scenario: "Duplicate withdrawalId rejected, no double payout".
    function test_withdrawUser_duplicateWithdrawalId_reverts() public {
        bytes32 withdrawalId = keccak256("withdrawal-dup");
        uint256 amount = 7 ether;

        vm.prank(operator);
        arena.withdrawUser(withdrawalId, winner, amount);

        // Second call reverts with the specific idempotency error.
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(ArenaSettlement.AlreadyWithdrawn.selector, withdrawalId)
        );
        arena.withdrawUser(withdrawalId, winner, amount);

        // User credited exactly once.
        assertEq(token.balanceOf(winner), amount);
    }

    /// @dev Scenario: "Non-operator caller rejected".
    function test_withdrawUser_calledByNonOperator_reverts() public {
        bytes32 withdrawalId = keccak256("withdrawal-stranger");

        vm.prank(stranger);
        vm.expectRevert(ArenaSettlement.NotOperator.selector);
        arena.withdrawUser(withdrawalId, winner, 1 ether);

        assertFalse(arena.withdrawn(withdrawalId));
    }

    /// @dev Scenario: "Paused contract blocks user withdrawals too". Mirrors
    ///      the `settle_whilePaused_reverts` invariant — `whenNotPaused` is
    ///      applied uniformly to every operator-driven payout path.
    function test_withdrawUser_whilePaused_reverts() public {
        bytes32 withdrawalId = keccak256("withdrawal-paused");

        vm.prank(owner);
        arena.pause();

        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        arena.withdrawUser(withdrawalId, winner, 1 ether);

        assertFalse(arena.withdrawn(withdrawalId));
    }

    /// @dev Scenario: "Zero `to` address rejected". The contract would
    ///      otherwise burn tokens to address(0) — unrecoverable.
    function test_withdrawUser_zeroAddress_reverts() public {
        bytes32 withdrawalId = keccak256("withdrawal-zero-addr");

        vm.prank(operator);
        vm.expectRevert(ArenaSettlement.ZeroAddress.selector);
        arena.withdrawUser(withdrawalId, address(0), 1 ether);

        assertFalse(arena.withdrawn(withdrawalId));
    }

    /// @dev Scenario: "Zero amount rejected". A zero-amount success would
    ///      still consume the withdrawalId (idempotency slot) for no reason,
    ///      so we reject it explicitly.
    function test_withdrawUser_zeroAmount_reverts() public {
        bytes32 withdrawalId = keccak256("withdrawal-zero-amt");

        vm.prank(operator);
        vm.expectRevert(ArenaSettlement.ZeroAmount.selector);
        arena.withdrawUser(withdrawalId, winner, 0);

        assertFalse(arena.withdrawn(withdrawalId));
    }

    /// @dev Scenario: "Withdrawal larger than available float rejected".
    ///      Mirrors the same check on the owner-only `withdraw`.
    function test_withdrawUser_moreThanFloat_reverts() public {
        bytes32 withdrawalId = keccak256("withdrawal-too-big");

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArenaSettlement.InsufficientFloat.selector, FLOAT + 1 ether, FLOAT
            )
        );
        arena.withdrawUser(withdrawalId, winner, FLOAT + 1 ether);

        assertFalse(arena.withdrawn(withdrawalId));
    }

    /// @dev Scenario: "Settled vs withdrawn mappings are independent".
    ///      Critical for ops: the backend relies on a single `withdrawalId`
    ///      namespace that does NOT collide with `matchId` — even if a
    ///      user constructs an `amount` that matches a settle-payout and
    ///      hashes the same bytes, the two paths must not interfere. This
    ///      test pins both code paths in the same scenario.
    function test_withdrawUser_doesNotInterfereWithSettle() public {
        bytes32 matchId = keccak256("match-cashout-coexist");
        bytes32 withdrawalId = keccak256("withdrawal-cashout-coexist");
        uint256 settleAmount = 4 ether;
        uint256 withdrawAmount = 3 ether;

        // Settle first.
        vm.prank(operator);
        arena.settle(matchId, winner, settleAmount);

        assertTrue(arena.settled(matchId));
        assertFalse(arena.withdrawn(withdrawalId));

        // Withdraw next — must not be blocked by the prior settle.
        vm.prank(operator);
        arena.withdrawUser(withdrawalId, winner, withdrawAmount);

        assertTrue(arena.withdrawn(withdrawalId));
        assertEq(token.balanceOf(winner), settleAmount + withdrawAmount);
        assertEq(token.balanceOf(address(arena)), FLOAT - settleAmount - withdrawAmount);
    }

    /// @dev Scenario: "Zero withdrawalId is allowed (single-use slot)".
    ///      Documents the deliberate decision NOT to validate
    ///      `withdrawalId != bytes32(0)` — the empty key is a valid,
    ///      single-use idempotency slot, identical in treatment to how
    ///      `settle` does not validate `matchId != bytes32(0)`. Adding the
    ///      check would be gas-for-nothing.
    function test_withdrawUser_zeroWithdrawalId_allowed_singleUse() public {
        vm.prank(operator);
        arena.withdrawUser(bytes32(0), winner, 1 ether);

        assertTrue(arena.withdrawn(bytes32(0)));
        assertEq(token.balanceOf(winner), 1 ether);

        // Re-using the zero key reverts — proving it IS single-use.
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(ArenaSettlement.AlreadyWithdrawn.selector, bytes32(0))
        );
        arena.withdrawUser(bytes32(0), winner, 1 ether);
    }
}
