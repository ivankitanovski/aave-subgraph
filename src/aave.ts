import { BigInt, Address, ethereum, log } from "@graphprotocol/graph-ts";
import {
  Borrow as BorrowEvent,
  LiquidationCall as LiquidationCallEvent,
  Repay as RepayEvent,
  Supply as SupplyEvent,
  Withdraw as WithdrawEvent,
  ReserveDataUpdated as ReserveDataUpdatedEvent,
} from "../generated/Aave/Aave";
import { Transfer as aUSDCTransferEvent } from "../generated/aUSDC/aUSDC";
import { Transfer as aUSDTTransferEvent } from "../generated/aUSDT/aUSDT";
import { Transfer as aWETHTransferEvent } from "../generated/aWETH/aWETH";
import { User, Token, Balance, Snapshot } from "../generated/schema";
import { getHourStartTimestamp } from "./utils";

/**************************************************************************/
/* Token addresses */
/**************************************************************************/
const WETH = Address.fromString("0x82af49447d8a07e3bd95bd0d56f35241523fbab1");
const USDC = Address.fromString("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
const USDT = Address.fromString("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9");
// aToken addresses
const aWETH = Address.fromString("0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8");
const aUSDC = Address.fromString("0x625E7708f30cA75bfd92586e17077590C60eb4cD");
const aUSDT = Address.fromString("0x6ab707Aca953eDAeFBc4fD23bA73294241490620");
// zero address
const ZERO = Address.fromString("0x0000000000000000000000000000000000000000");

// utility function to check if a token is tracked
function isTrackedToken(tokenAddress: Address): boolean {
  return tokenAddress == WETH || tokenAddress == USDC || tokenAddress == USDT;
}

/**************************************************************************/
/* Initializer */
/**************************************************************************/
function initializeToken(
  address: Address,
  symbol: string,
  name: string,
  decimals: i32
): void {
  let token = Token.load(address.toHex());
  if (token == null) {
    token = new Token(address.toHex());
    token.symbol = symbol;
    token.name = name;
    token.decimals = decimals;
    token.save();
  }
}

/**************************************************************************/
/* Getter and update functions for entities */
/**************************************************************************/

function getToken(address: Address): Token {
  let token = Token.load(address.toHex());
  return token as Token;
}

/**
 * Get or create a user entity
 */
function getOrCreateUser(id: string): User {
  let user = User.load(id);
  if (!user) {
    user = new User(id);
    user.save();
  }
  return user as User;
}

/**
 * Get or create a user token balance snapshot entity
 */
function getOrCreateBalance(user: User, token: Token): Balance {
  let id = user.id + "-" + token.id;
  let balance = Balance.load(id);
  if (balance == null) {
    balance = new Balance(id);
    balance.user = user.id;
    balance.token = token.id;
    balance.totalSupplied = BigInt.fromI32(0);
    balance.totalBorrowed = BigInt.fromI32(0);
    balance.netSupplied = BigInt.fromI32(0);
    balance.lastUpdated = BigInt.fromI32(0);
    balance.save();
  }
  return balance as Balance;
}

function updateSnapshop(balance: Balance, event: ethereum.Event): void {
  let hour = getHourStartTimestamp(event.block.timestamp);
  let id = balance.id + "-" + hour.toString(); // the id is in the form of "user-token-hour"
  let snapshot = Snapshot.load(id);
  // create a snapshot if it doesn't exist
  if (snapshot == null) {
    snapshot = new Snapshot(id);
    snapshot.user = balance.user;
    snapshot.token = balance.token;
  }
  // update state of the snapshot
  snapshot.totalSupplied = balance.totalSupplied;
  snapshot.totalBorrowed = balance.totalBorrowed;
  snapshot.netSupplied = balance.netSupplied;
  snapshot.timestamp = balance.lastUpdated;
  snapshot.blockNumber = event.block.number;
  // save the snapshot
  snapshot.save();
}

/**************************************************************************/
/* Handler functions for AAVE */
/**************************************************************************/
export function handleBorrow(event: BorrowEvent): void {
  if (!isTrackedToken(event.params.reserve)) {
    return;
  }

  let user = getOrCreateUser(event.params.user.toHex());
  let token = getToken(event.params.reserve);

  // update current state of the user balance
  let balance = getOrCreateBalance(user, token);
  balance.totalBorrowed = balance.totalBorrowed.plus(event.params.amount);
  balance.netSupplied = balance.totalSupplied.minus(balance.totalBorrowed);
  balance.lastUpdated = event.block.timestamp;
  balance.save();

  // update snapshot state of the user balance
  updateSnapshop(balance, event);
}

export function handleRepay(event: RepayEvent): void {
  if (!isTrackedToken(event.params.reserve)) {
    return;
  }

  let user = getOrCreateUser(event.params.user.toHex());
  let token = getToken(event.params.reserve);

  // update current state of the user balance
  let balance = getOrCreateBalance(user, token);
  balance.totalBorrowed = balance.totalBorrowed.minus(event.params.amount);
  balance.netSupplied = balance.totalSupplied.minus(balance.totalBorrowed);
  balance.lastUpdated = event.block.timestamp;
  balance.save();

  // update snapshot state of the user balance
  updateSnapshop(balance, event);
}

export function handleSupply(event: SupplyEvent): void {
  if (!isTrackedToken(event.params.reserve)) {
    return;
  }

  let user = getOrCreateUser(event.params.user.toHex());
  let token = getToken(event.params.reserve);

  // update current state of the user balance
  let balance = getOrCreateBalance(user, token);
  balance.totalSupplied = balance.totalSupplied.plus(event.params.amount);
  balance.netSupplied = balance.totalSupplied.minus(balance.totalBorrowed);
  balance.lastUpdated = event.block.timestamp;
  balance.save();

  // update snapshot state of the user balance
  updateSnapshop(balance, event);
}

export function handleWithdraw(event: WithdrawEvent): void {
  if (!isTrackedToken(event.params.reserve)) {
    return;
  }

  let user = getOrCreateUser(event.params.user.toHex());
  let token = getToken(event.params.reserve);

  // update current state of the user balance
  let balance = getOrCreateBalance(user, token);
  balance.totalSupplied = balance.totalSupplied.minus(event.params.amount);
  balance.netSupplied = balance.totalSupplied.minus(balance.totalBorrowed);
  balance.lastUpdated = event.block.timestamp;
  balance.save();

  // update snapshot state of the user balance
  updateSnapshop(balance, event);
}

export function handleLiquidationCall(event: LiquidationCallEvent): void {
  // we only check liquidation calls where the collateral and debt assets are tracked
  // maybe we should also consider other possible cases
  if (
    !isTrackedToken(event.params.collateralAsset) &&
    !isTrackedToken(event.params.debtAsset)
  ) {
    return;
  }

  let user = getOrCreateUser(event.params.user.toHex());

  // update user balance for collateral asset
  if (isTrackedToken(event.params.collateralAsset)) {
    let token = getToken(event.params.collateralAsset);
    let balance = getOrCreateBalance(user, token);
    balance.totalSupplied = balance.totalSupplied.minus(
      event.params.liquidatedCollateralAmount
    );
    balance.netSupplied = balance.totalSupplied.minus(balance.totalBorrowed);
    balance.lastUpdated = event.block.timestamp;
    balance.save();

    updateSnapshop(balance, event);
  }

  // update user balance for debt asset
  if (isTrackedToken(event.params.debtAsset)) {
    let token = getToken(event.params.debtAsset);
    let balance = getOrCreateBalance(user, token);
    balance.totalBorrowed = balance.totalBorrowed.minus(
      event.params.debtToCover
    );
    balance.netSupplied = balance.totalSupplied.minus(balance.totalBorrowed);
    balance.lastUpdated = event.block.timestamp;
    balance.save();

    updateSnapshop(balance, event);
  }
}

export function handleReserveDataUpdated(event: ReserveDataUpdatedEvent): void {
  if (!isTrackedToken(event.params.reserve)) {
    return;
  }

  //TODO: add logic to update interest earned, accrued, etc.
}

// Initialize tokens on the start. Probably can hard code these...
export function handleBlock(block: ethereum.Block): void {
  // Initialize tokens if they don't exist
  initializeToken(WETH, "WETH", "Wrapped Ether", 18);
  initializeToken(USDC, "USDC", "USD Coin", 6);
  initializeToken(USDT, "USDT", "Tether USD", 6);
}

/**************************************************************************/
/* Handler functions for aTokens */
/**************************************************************************/
function handleTransfer(
  userFrom: User,
  userTo: User,
  token: Token,
  value: BigInt,
  event: ethereum.Event
): void {
  // update current state of the sender

  let balanceUserFrom = getOrCreateBalance(userFrom, token);
  balanceUserFrom.totalSupplied = balanceUserFrom.totalSupplied.minus(value);
  balanceUserFrom.netSupplied = balanceUserFrom.totalSupplied.minus(
    balanceUserFrom.totalBorrowed
  );
  balanceUserFrom.lastUpdated = event.block.timestamp;
  balanceUserFrom.save();

  // update snapshot state of the sender balance
  updateSnapshop(balanceUserFrom, event);

  // update current state of the receiver
  let balanceUserTo = getOrCreateBalance(userTo, token);
  balanceUserTo.totalSupplied = balanceUserTo.totalSupplied.plus(value);
  balanceUserTo.netSupplied = balanceUserTo.totalSupplied.minus(
    balanceUserTo.totalBorrowed
  );
  balanceUserTo.lastUpdated = event.block.timestamp;
  balanceUserTo.save();

  // update snapshot state of the receiver balance
  updateSnapshop(balanceUserTo, event);
}

export function handleaUSDCTransfer(event: aUSDCTransferEvent): void {
  // ignore transfers from/to zero address
  if (event.params.from == ZERO || event.params.to == ZERO) {
    return;
  }

  // get users and token
  let userFrom = getOrCreateUser(event.params.from.toHex());
  let userTo = getOrCreateUser(event.params.to.toHex());
  let token = getToken(USDC);

  // update balances
  handleTransfer(userFrom, userTo, token, event.params.value, event);
}

export function handleaUSDTTransfer(event: aUSDTTransferEvent): void {
  // ignore transfers from/to zero address
  if (event.params.from == ZERO || event.params.to == ZERO) {
    return;
  }

  // get users and token
  let userFrom = getOrCreateUser(event.params.from.toHex());
  let userTo = getOrCreateUser(event.params.to.toHex());
  let token = getToken(USDT);

  // update balances
  handleTransfer(userFrom, userTo, token, event.params.value, event);
}

export function handleaWETHTransfer(event: aWETHTransferEvent): void {
  // ignore transfers from/to zero address
  if (event.params.from == ZERO || event.params.to == ZERO) {
    return;
  }

  // get users and token
  let userFrom = getOrCreateUser(event.params.from.toHex());
  let userTo = getOrCreateUser(event.params.to.toHex());
  let token = getToken(WETH);

  // update balances
  handleTransfer(userFrom, userTo, token, event.params.value, event);
}
