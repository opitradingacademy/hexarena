// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Minimal mintable ERC-20 for tests only. Stands in for
///         USDC/USDT/USDm (6-18 decimals depending on asset; tests use the
///         default 18 since decimals don't affect settlement logic).
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Stable", "mUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
