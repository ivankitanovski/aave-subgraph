import { Address, BigInt, ethereum, store } from "@graphprotocol/graph-ts";
import {
  Borrow as BorrowEvent,
  LiquidationCall as LiquidationCallEvent,
  Repay as RepayEvent,
  ReserveDataUpdated as ReserveDataUpdatedEvent,
  Supply as SupplyEvent,
  Withdraw as WithdrawEvent,
} from "../generated/Aave/Aave";
import { Transfer as aUSDCTransferEvent } from "../generated/aUSDC/aUSDC";
import { Transfer as aUSDTTransferEvent } from "../generated/aUSDT/aUSDT";
import { Transfer as aWETHTransferEvent } from "../generated/aWETH/aWETH";
import { Snapshot, Token, User, Balance, Loan } from "../generated/schema";
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
// null address
const NULL = Address.fromString("0x0000000000000000000000000000000000000000");
// big int constants
const ZERO = BigInt.zero();
const SECONDS_IN_YEAR = BigInt.fromI32(31536000);
const RAY = BigInt.fromI32(10).pow(27)

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
    token.borrowers = [];
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
    balance.totalSupplied = ZERO;
    balance.totalBorrowed = ZERO;
    balance.pendingSupplied = ZERO;
    balance.pendingWithdrawn = ZERO;
    balance.pendingRepaid = ZERO;
    balance.netSupplied = ZERO;
    balance.timestamp = ZERO;
    balance.liquidityIndex = ZERO;
    balance.accruedInterest = ZERO;
    balance.blockNumber = ZERO;
    balance.save();
  }
  return balance as Balance;
}

/**
 * Get or create a loan for balance
 */
function createLoan(balance: Balance, event: BorrowEvent): Loan {
  let id = balance.id + "-" + event.transaction.hash.toHex();
  let loan = Loan.load(id);
  if (loan == null) {
    loan = new Loan(id);
    loan.balance = balance.id;
    loan.amount = event.params.amount;
    loan.borrowRate = event.params.borrowRate;
    loan.borrowType = event.params.interestRateMode;
    loan.accruedInterest = ZERO;
    loan.isLiquidated = false; // set to true if liquidated
    loan.timestamp = event.block.timestamp;
    loan.blockNumber = event.block.number;
    loan.save();
  }
  return loan as Loan;
}

/*
 * Update snapshot entity for a balance
 */
function updateSnapshop(balance: Balance, event: ethereum.Event): void {
  let hour = getHourStartTimestamp(event.block.timestamp);
  let id = balance.id + "-" + hour.toString(); // the id is in the form of "user-token-hour"
  let snapshot = Snapshot.load(id);
  // create a snapshot if it doesn't exist
  if (snapshot == null) {
    snapshot = new Snapshot(id);
    snapshot.balance = balance.id;
  }
  // update state of the snapshot
  snapshot.totalSupplied = balance.totalSupplied;
  snapshot.totalBorrowed = balance.totalBorrowed
  snapshot.accruedInterest = balance.accruedInterest;
  snapshot.netSupplied = balance.netSupplied;
  snapshot.timestamp = balance.timestamp;
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

  let user = getOrCreateUser(event.params.onBehalfOf.toHex());
  let token = getToken(event.params.reserve);

  // // add user to the borrowers list
  token.borrowers.push(user.id);
  token.save();

  // update current state of the user balance
  let balance = getOrCreateBalance(user, token);

  // create loan entity
  createLoan(balance, event);
}

export function handleRepay(event: RepayEvent): void {
  if (!isTrackedToken(event.params.reserve)) {
    return;
  }

  let user = getOrCreateUser(event.params.user.toHex());
  let token = getToken(event.params.reserve);

  // update current state of the user balance
  let balance = getOrCreateBalance(user, token);
  balance.pendingRepaid = balance.pendingRepaid.plus(event.params.amount);
  balance.save();

  // update snapshot state of the user balance
  updateSnapshop(balance, event);
}

export function handleSupply(event: SupplyEvent): void {
  if (!isTrackedToken(event.params.reserve)) {
    return;
  }

  let user = getOrCreateUser(event.params.onBehalfOf.toHex());
  let token = getToken(event.params.reserve);

  // add pending supplied amount to the user balance
  let balance = getOrCreateBalance(user, token);
  balance.pendingSupplied = balance.pendingSupplied.plus(event.params.amount);
  balance.save();
}

export function handleWithdraw(event: WithdrawEvent): void {
  if (!isTrackedToken(event.params.reserve)) {
    return;
  }

  let user = getOrCreateUser(event.params.user.toHex());
  let token = getToken(event.params.reserve);

  // add pending supplied amount to the user balance
  let balance = getOrCreateBalance(user, token);
  balance.pendingWithdrawn = balance.pendingWithdrawn.plus(event.params.amount);
  balance.save();
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
    balance.netSupplied = balance.totalSupplied.minus(balance.totalBorrowed.plus(balance.accruedInterest));
    balance.timestamp = event.block.timestamp;
    balance.save();

    updateSnapshop(balance, event);
  }

  // update user balance for debt asset
  if (isTrackedToken(event.params.debtAsset)) {
    let token = getToken(event.params.debtAsset);
    let balance = getOrCreateBalance(user, token);
    
    // reset the total borrowed amount to 0, the user is liquidated
    balance.totalBorrowed = ZERO;
    balance.accruedInterest = ZERO;
    balance.netSupplied = balance.totalSupplied.minus(balance.totalBorrowed.plus(balance.accruedInterest));
    
    // delete all loans
    let loans = balance.loans.load()
    for(let i = 0; i < loans.length; i++) { 
      let loan = loans[i];
      store.remove("Loan", loan.id);
    }
    
    balance.timestamp = event.block.timestamp;
    balance.blockNumber = event.block.number;
    balance.save();

    updateSnapshop(balance, event);
  }
}

export function handleReserveDataUpdated(event: ReserveDataUpdatedEvent): void {
  if (!isTrackedToken(event.params.reserve)) {
    return;
  }

  //Get user and token related data
  let user = getOrCreateUser(event.transaction.from.toHex());
  let token = getToken(event.params.reserve);
  let balance = getOrCreateBalance(user, token);

  // update the total supplied amount based on the new liquidity index
  if (balance.liquidityIndex > ZERO) {
    balance.totalSupplied = balance.totalSupplied.times(
      event.params.liquidityIndex.div(balance.liquidityIndex)
    );
    balance.save();
  }

  // if there is a supply or withdraw event
  if (
    balance.pendingSupplied > ZERO ||
    balance.pendingWithdrawn > ZERO
  ) {
    // check if the pending amount is supplied or withdrawn
    if (balance.pendingSupplied > ZERO) {
      balance.totalSupplied = balance.totalSupplied.plus(
        balance.pendingSupplied
      );
    } else {
      balance.totalSupplied = balance.totalSupplied.minus(
        balance.pendingWithdrawn
      );
    }
    // restart pending amounts
    balance.pendingSupplied = ZERO;
    balance.pendingWithdrawn = ZERO;
  }

  // update the users loans
  let loans = balance.loans.load();
  let totalInterest = ZERO;
  let totalBorrowed = ZERO;
  for (let i = 0; i < loans.length; i++) {
    let loan = loans[i];
    // calculate the accrued interest
    let timeElapsed = event.block.timestamp.minus(loan.timestamp);
    let interestAccrued = loan.amount
      .times(loan.borrowRate.div(RAY))
      .times(timeElapsed)
      .div(SECONDS_IN_YEAR);
    loan.accruedInterest = loan.accruedInterest.plus(interestAccrued);

    // update globals
    totalInterest = totalInterest.plus(interestAccrued);
    totalBorrowed = totalBorrowed.plus(loan.amount);

    if (loan.borrowType == 1) {
      loan.borrowRate = event.params.stableBorrowRate;
    } else if (loan.borrowType == 2) {
      loan.borrowRate = event.params.variableBorrowRate;
    }

    loan.save();
  }

  // update the total borrowed and accrued interest
  balance.totalBorrowed = totalBorrowed;
  balance.accruedInterest = totalInterest;
  
  // handle repay event
  if (balance.pendingRepaid > ZERO) {
    let pendingRepaid = balance.pendingRepaid;

    if(totalInterest >= pendingRepaid) {
      // pay off the interest first
      balance.accruedInterest = totalInterest.minus(pendingRepaid);

      // update the interest for the loans
      for(let i = 0; i < loans.length; i++) {
        let loan = loans[i];
        // deduct  = repaid * (loan interest / totalInterest)
        let deductedInterest = pendingRepaid.times(loan.accruedInterest.div(totalInterest)); 
        loan.accruedInterest = loan.accruedInterest.minus(deductedInterest);
        loan.save();
      }
    } else {
      // pay off the interest and the principal

      // clear the interest for the loans
      for(let i = 0; i < loans.length; i++) {
        let loan = loans[i];
        pendingRepaid = pendingRepaid.minus(loan.accruedInterest);
        loan.accruedInterest = ZERO;
        loan.save();
      }

      // update the balance, no interest left, principal is paid off proportionally
      balance.accruedInterest = ZERO;
      balance.totalBorrowed = balance.totalBorrowed.minus(pendingRepaid);

       // deduct the principal
      for(let i = 0; i < loans.length; i++) {
        let loan = loans[i];
        // deduct  = repaid * (loan principal / totalPrincipal)
        let deductPrincipal = pendingRepaid.times(loan.amount.div(totalBorrowed)); 
        loan.amount = loan.amount.minus(deductPrincipal);
        loan.save();
      }
    }

  }

  // update the net supplied amount
  balance.netSupplied = balance.totalSupplied.minus(balance.totalBorrowed.plus(balance.accruedInterest)); 
  balance.liquidityIndex = event.params.liquidityIndex;
  balance.timestamp = event.block.timestamp;
  balance.blockNumber = event.block.number;
  balance.save();

  updateSnapshop(balance, event);
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
    balanceUserFrom.totalBorrowed.plus(balanceUserFrom.accruedInterest)
  );
  balanceUserFrom.timestamp = event.block.timestamp;
  balanceUserFrom.save();

  // update snapshot state of the sender balance
  updateSnapshop(balanceUserFrom, event);

  // update current state of the receiver
  let balanceUserTo = getOrCreateBalance(userTo, token);
  balanceUserTo.totalSupplied = balanceUserTo.totalSupplied.plus(value);
  balanceUserTo.netSupplied = balanceUserTo.totalSupplied.minus(
    balanceUserTo.totalBorrowed.plus(balanceUserTo.accruedInterest)
  );
  balanceUserTo.timestamp = event.block.timestamp;
  balanceUserTo.save();

  // update snapshot state of the receiver balance
  updateSnapshop(balanceUserTo, event);
}

export function handleaUSDCTransfer(event: aUSDCTransferEvent): void {
  // ignore transfers from/to zero address
  if (event.params.from == NULL || event.params.to == NULL) {
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
  if (event.params.from == NULL || event.params.to == NULL) {
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
  if (event.params.from == NULL || event.params.to == NULL) {
    return;
  }

  // get users and token
  let userFrom = getOrCreateUser(event.params.from.toHex());
  let userTo = getOrCreateUser(event.params.to.toHex());
  let token = getToken(WETH);

  // update balances
  handleTransfer(userFrom, userTo, token, event.params.value, event);
}
