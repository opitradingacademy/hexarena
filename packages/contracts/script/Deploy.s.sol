// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ArenaSettlement} from "../src/ArenaSettlement.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys ArenaSettlement. Parameterized by env vars so the SAME
///         script targets Celo Sepolia testnet first, and Mainnet later
///         (Phase 5, Proof of Ship) — no code changes between environments.
///
/// Required env vars:
///   SETTLEMENT_TOKEN  - ERC-20 address used for stake settlement
///                        (see packages/shared/chain for verified Celo
///                        Mainnet addresses: USDm / USDC / USDT — do NOT
///                        invent addresses here, pass the right one per
///                        network via env).
///   OPERATOR_ADDRESS  - backend signer address authorized to call settle().
///   OWNER_ADDRESS     - admin address (pause/withdraw/setOperator).
///   PRIVATE_KEY       - deployer key (broadcaster), NOT committed anywhere.
///
/// Usage (testnet dry-run/documentation only — NOT executed in this
/// session, no on-chain transaction was sent):
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url celo_sepolia \
///     --broadcast --verify -vvvv
///
/// Mainnet deploy (Phase 5, Proof of Ship — requires real funds/keys not
/// available in this environment) uses the identical script with
/// `--rpc-url celo_mainnet` and Mainnet-verified addresses.
contract Deploy is Script {
    function run() external returns (ArenaSettlement arena) {
        address token = vm.envAddress("SETTLEMENT_TOKEN");
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        address owner = vm.envAddress("OWNER_ADDRESS");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        arena = new ArenaSettlement(IERC20(token), operator, owner);
        vm.stopBroadcast();

        console.log("ArenaSettlement deployed at:", address(arena));
        console.log("token:", token);
        console.log("operator:", operator);
        console.log("owner:", owner);
    }
}
