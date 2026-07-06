// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ArenaSettlement} from "../src/ArenaSettlement.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys ArenaSettlement v2 (PR0 of the cash-out feature).
///         Constructor signature is identical to the v1 deploy script
///         (`script/Deploy.s.sol`) — the only change between v1 and v2
///         is the new public `withdrawUser(bytes32,address,uint256)` entry
///         point + its `withdrawn` mapping and `UserWithdrawn` event.
///
///         We use a separate script (not a parameter on `Deploy.s.sol`)
///         because (a) the broadcast artifacts under
///         `packages/contracts/broadcast/` are keyed by script path, and
///         keeping v1 and v2 artifacts separate avoids overwriting the
///         Mainnet-deploy artifact from PR5; (b) it documents intent — a
///         reader of `broadcast/DeployArenaSettlementV2.s.sol/...` knows
///         this is the cash-out redeploy, not a fresh deploy to a new chain.
///
/// Required env vars (identical to `Deploy.s.sol`):
///   SETTLEMENT_TOKEN  - ERC-20 address used for stake settlement
///                        (Celo Mainnet USDT:
///                        0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e).
///   OPERATOR_ADDRESS  - backend signer address authorized to call settle()
///                        AND the new withdrawUser(). MUST equal the
///                        OPERATOR_PRIVATE_KEY-derived address currently
///                        set on Railway — the redeploy MUST NOT rotate
///                        the operator (it stays the same backend key),
///                        otherwise in-flight Arena cashouts would be
///                        signed by the wrong key.
///   OWNER_ADDRESS     - admin address (pause/withdraw/setOperator).
///                        MUST equal the current owner (the MetaMask key
///                        the user already controls).
///   PRIVATE_KEY       - deployer key (broadcaster). This is a one-off
///                        deployer; the resulting contract owner is
///                        `OWNER_ADDRESS`, not the deployer.
///
/// Usage (Mainnet redeploy — manual, after this PR is reviewed):
///   forge script script/DeployArenaSettlementV2.s.sol:DeployArenaSettlementV2 \
///     --rpc-url celo_mainnet \
///     --broadcast --verify -vvvv
///
/// IMPORTANT: do NOT execute this script from a CI sub-agent. The deploy
/// is a Mainnet operation that mints a NEW contract address; PR1 of this
/// change must update `packages/shared/chain/index.ts`'s
/// `ARENA_SETTLEMENT_ADDRESS[42220]` to the new address returned here
/// before the server can resume settle/withdrawUser traffic.
contract DeployArenaSettlementV2 is Script {
    function run() external returns (ArenaSettlement arena) {
        address token = vm.envAddress("SETTLEMENT_TOKEN");
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        address owner = vm.envAddress("OWNER_ADDRESS");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        arena = new ArenaSettlement(IERC20(token), operator, owner);
        vm.stopBroadcast();

        // Mirror the existing Deploy.s.sol output so anyone grepping the
        // broadcast log can see the full constructor config at a glance.
        console.log("ArenaSettlement (v2 / cash-out) deployed at:", address(arena));
        console.log("token:", token);
        console.log("operator:", operator);
        console.log("owner:", owner);
        console.log("");
        console.log("NEXT STEP: update packages/shared/chain/index.ts:");
        console.log("  ARENA_SETTLEMENT_ADDRESS[42220] =", address(arena));
    }
}