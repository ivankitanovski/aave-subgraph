# Aave Subgraph

This subgraph ingests and processes events from the Aave protocol and aTokens, providing real-time updates on user balances and snapshots at specific blocks.

## Overview

This subgraph tracks the following events:
- Borrow
- Repay
- Supply
- Withdraw
- LiquidationCall
- ReserveDataUpdated
- Transfer events for aUSDC, aUSDT, and aWETH

## Token Addresses

The following tokens are tracked:
- WETH: `0x82af49447d8a07e3bd95bd0d56f35241523fbab1`
- USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- USDT: `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`

The aTokens are:
- aWETH: `0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8`
- aUSDC: `0x625E7708f30cA75bfd92586e17077590C60eb4cD`
- aUSDT: `0x6ab707Aca953eDAeFBc4fD23bA73294241490620`
