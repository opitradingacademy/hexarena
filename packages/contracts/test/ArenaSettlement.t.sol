// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArenaSettlement} from "../src/ArenaSettlement.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
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
}
