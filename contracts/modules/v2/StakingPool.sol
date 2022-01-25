// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.8.0;

import "@openzeppelin/contracts-v4/token/ERC20/ERC20.sol";

import "hardhat/console.sol";

contract StakingPool is ERC20 {

  struct PoolBucket {
    // slot 0
    uint64 rewardPerSecondCut;
    // amount of shares requested for unstake
    uint96 unstakeRequested;
    // amount of unstaked shares
    uint96 unstaked;

    // slot 1
    // underlying amount unstaked, stored for rate calculation
    uint96 unstakedNXM;
  }

  struct Product {
    uint96 activeCoverAmount;
    uint16 weight;
    uint16 lastBucket;
    // uint128 _unused;
  }

  struct ProductBucket {
    uint96 expiringCoverAmount;
    // uint160 _unused;
  }

  struct UnstakeRequest {
    uint96 amount;
    uint96 withdrawn;
    uint16 bucketIndex;
    // uint48 _unused;
  }

  struct AllocateCapacityParams {
    uint productId;
    uint coverAmount;
    uint rewardsDenominator;
    uint period;
    uint globalCapacityRatio;
    uint globalRewardsRatio;
    uint capacityReductionRatio;
    uint initialPrice;
  }

  struct Staker {
    uint96 unstakeAmount;
    uint16 lastUnstakeBucket;
    // FIFO:
    // unstakeRequests mapping keys. zero means no unstake exists.
    uint32 firstUnstakeId;
    uint32 lastUnstakeId;
    uint16 lastUnstakeBucketIndex;
    // uint48 _unused;
  }

  struct LastPrice {
    uint96 value;
    uint32 lastUpdateTime;
  }

  /*
  (productId, poolAddress) => lastPrice
  Last base prices at which a cover was sold by a pool for a particular product.
  */
  mapping(uint => LastPrice) lastBasePrices;

  mapping(uint => uint) targetPrices;

  /* slot 0 */
  // bucket index => pool bucket
  mapping(uint => PoolBucket) public poolBuckets;

  /* slot 1 */
  // product index => bucket index => cover amount expiring
  mapping(uint => mapping(uint => ProductBucket)) public productBuckets;

  /* slot 2 */
  // staker address => staker unstake info
  // todo: unstakes may take a looooong time, consider issuing an nft that represents staker's requests
  mapping(address => Staker) public stakers;

  /* slot 3 */
  // staker address => request id => unstake request
  mapping(address => mapping(uint32 => UnstakeRequest)) unstakeRequests;

  /* slot 4 */
  // product id => product info
  mapping(uint => Product) public products;

  /* slot 5 */
  // array with product ids to be able to iterate them
  // todo: pack me
  uint[] public poolProductsIds;

  // unstakes flow:
  // 1. bucket n: unstake requested
  // 2. bucket n + 2: unstake becomes queued
  // 3. bucket n + 2 + m: unstake is granted

  /* slot 6 */
  uint96 public stakeActive;
  uint96 public stakeInactive;
  uint64 public lastRewardPerSecond;

  uint32 public lastRewardTime;
  uint16 public lastPoolBucketIndex;
  uint16 public lastUnstakeBucketIndex;
  uint16 public totalWeight;
  uint16 public maxTotalWeight; // todo: read from cover

  // IDK if the next three are needed:
  // total actually requested and not yet queued
  uint96 public totalUnstakeRequested;
  // requested at bucket t-2
  uint96 public totalUnstakeQueued;
  // unstaked but not withdrawn
  uint96 public totalUnstakeGranted;

  // used for max unstake
  // max unstake = min(stake - maxCapacity, stake - totalLeverage)
  uint96 public maxCapacity;
  uint96 public totalLeverage;

  address public manager;

  /* immutables */
  ERC20 public immutable nxm;
  address public immutable coverContract;

  /* constants */
  uint public constant TOKEN_PRECISION = 1e18;
  uint public constant PARAM_PRECISION = 10_000;
  uint public constant BUCKET_SIZE = 7 days;

  uint public constant PRICE_CURVE_EXPONENT = 7;
  uint public constant MAX_PRICE_RATIO = 1e20;
  uint public constant PRICE_RATIO_CHANGE_PER_DAY = 100;
  uint public constant PRICE_DENOMINATOR = 10_000;
  uint public constant GLOBAL_CAPACITY_DENOMINATOR = 10_000;
  uint public constant PRODUCT_WEIGHT_DENOMINATOR = 10_000;
  uint public constant CAPACITY_REDUCTION_DENOMINATOR = 10_000;

  // base price bump by 2% for each 10% of capacity used
  uint public constant BASE_PRICE_BUMP_RATIO = 200; // 2%
  uint public constant BASE_PRICE_BUMP_INTERVAL = 1000; // 10%
  uint public constant BASE_PRICE_BUMP_DENOMINATOR = 10_000;

  uint public constant GLOBAL_MIN_PRICE_RATIO = 100; // 1%

  modifier onlyCoverContract {
    require(msg.sender == coverContract, "StakingPool: Caller is not the cover contract");
    _;
  }

  modifier onlyManager {
    require(msg.sender == manager, "StakingPool: Caller is not the manager");
    _;
  }

  constructor (address _nxm, address _coverContract) ERC20("Staked NXM", "SNXM") {
    nxm = ERC20(_nxm);
    coverContract = _coverContract;

  }

  function initialize(address _manager) external onlyCoverContract {
    require(lastPoolBucketIndex == 0, "Staking Pool: Already initialized");
    lastPoolBucketIndex = uint16(block.timestamp / BUCKET_SIZE);
    lastUnstakeBucketIndex = uint16(block.timestamp / BUCKET_SIZE);
    manager = _manager;
  }

  /* View functions */

  function min(uint a, uint b) internal pure returns (uint) {
    return a < b ? a : b;
  }

  function max(uint a, uint b) internal pure returns (uint) {
    return a > b ? a : b;
  }

  /* State-changing functions */

  function processPoolBuckets() internal returns (uint staked) {

    // 1 SLOAD
    staked = stakeActive;
    uint rewardPerSecond = lastRewardPerSecond;
    uint rewardTime = lastRewardTime;
    uint poolBucketIndex = lastPoolBucketIndex;

    // 1 SLOAD
    uint unstakeQueued = totalUnstakeQueued;

    // get bucket for current time
    uint currentBucketIndex = block.timestamp / BUCKET_SIZE;

    // process expirations, 1 SLOAD / iteration
    while (poolBucketIndex < currentBucketIndex) {

      ++poolBucketIndex;
      uint bucketStartTime = poolBucketIndex * BUCKET_SIZE;
      staked += (bucketStartTime - rewardTime) * rewardPerSecond;
      rewardTime = bucketStartTime;

      // 1 SLOAD for both
      rewardPerSecond -= poolBuckets[poolBucketIndex].rewardPerSecondCut;
      unstakeQueued += poolBuckets[poolBucketIndex].unstakeRequested;
    }

    // if we're mid-bucket, process rewards until current timestamp
    staked += (block.timestamp - rewardTime) * rewardPerSecond;

    // 1 SSTORE
    stakeActive = uint96(staked);
    lastRewardPerSecond = uint64(rewardPerSecond);
    lastRewardTime = uint32(block.timestamp);
    lastPoolBucketIndex = uint16(poolBucketIndex);

    // 1 SSTORE
    totalUnstakeQueued = uint96(unstakeQueued);
  }

  /* callable by cover contract */

  function allocateCapacity(AllocateCapacityParams calldata params) external returns (uint, uint) {

    uint staked = processPoolBuckets();
    uint currentBucket = block.timestamp / BUCKET_SIZE;

    Product storage product = products[params.productId];
    uint activeCoverAmount = product.activeCoverAmount;
    uint lastBucket = product.lastBucket;

    // process expirations
    while (lastBucket < currentBucket) {
      ++lastBucket;
      activeCoverAmount -= productBuckets[params.productId][lastBucket].expiringCoverAmount;
    }

    // limit cover amount to the amount left available
    uint capacity = (
      staked *
      params.globalCapacityRatio *
      product.weight *
      (CAPACITY_REDUCTION_DENOMINATOR - params.capacityReductionRatio) /
      GLOBAL_CAPACITY_DENOMINATOR /
      PRODUCT_WEIGHT_DENOMINATOR /
      CAPACITY_REDUCTION_DENOMINATOR
    );

    uint coverAmount = min(
      capacity - activeCoverAmount,
      params.coverAmount
    );

    {
      // calculate expiration bucket, reward period, reward amount
      uint expirationBucket = (block.timestamp + params.period) / BUCKET_SIZE + 1;
      uint rewardPeriod = expirationBucket * BUCKET_SIZE - block.timestamp;
      uint addedRewardPerSecond = params.globalRewardsRatio * coverAmount / params.rewardsDenominator / rewardPeriod;

      // update state
      // 1 SLOAD + 3 SSTORE
      lastRewardPerSecond = uint64(lastRewardPerSecond + addedRewardPerSecond);
      poolBuckets[expirationBucket].rewardPerSecondCut += uint64(addedRewardPerSecond);
      productBuckets[params.productId][expirationBucket].expiringCoverAmount += uint96(coverAmount);

      product.lastBucket = uint16(lastBucket);
      product.activeCoverAmount = uint96(activeCoverAmount + coverAmount);
    }

    // price calculation
    uint actualPrice = getActualPriceAndUpdateBasePrice(
      params.productId,
      coverAmount,
      product.activeCoverAmount,
      activeCoverAmount,
      params.initialPrice
    );

    return (coverAmount, calculatePremium(actualPrice, coverAmount, params.period));
  }

  function burnStake() external {

    //

  }

  /* callable by stakers */

  function stake(uint amount) external {

    // TODO: use operator transfer and transfer to TC instead
    nxm.transferFrom(msg.sender, address(this), amount);

    uint supply = totalSupply();
    uint staked;
    uint shares;

    if (supply == 0) {
      shares = amount;
    } else {
      staked = processPoolBuckets();
      shares = supply * amount / staked;
    }

    stakeActive = uint96(staked + amount);
    _mint(msg.sender, shares);
  }

  function requestUnstake(uint shares) external {

    uint staked = processPoolBuckets();
    uint supply = totalSupply();
    uint amount = shares * staked / supply;
    uint currentBucket = block.timestamp / BUCKET_SIZE;

    // should revert if caller doesn't have enough shares
    _burn(msg.sender, shares);
    stakeActive = uint96(staked - amount);

    Staker memory staker = stakers[msg.sender];

    if (currentBucket != staker.lastUnstakeBucket) {
      ++staker.lastUnstakeId;
    }

    // SLOAD
    UnstakeRequest memory unstakeRequest = unstakeRequests[msg.sender][staker.lastUnstakeId];

    // update
    unstakeRequest.amount += uint96(amount);
    staker.unstakeAmount += uint96(amount);

    // SSTORE
    unstakeRequests[msg.sender][staker.lastUnstakeId] = unstakeRequest;
    stakers[msg.sender] = staker;
  }

  function withdraw(uint amount) external {

    // uint lastUnstakeBucket = lastUnstakeBucketIndex;

  }

  /* Pool management functions */

  function addProduct() external onlyManager {

    //

  }

  function removeProduct() external onlyManager {

    //

  }

  function setWeights() external onlyManager {

    //

  }

  function setTargetPrice(uint productId, uint targetPrice) external onlyManager {
    require(targetPrice >= GLOBAL_MIN_PRICE_RATIO, "StakingPool: Target price must be greater than global min price");
    targetPrices[productId] = targetPrice;
  }

  /* VIEWS */

  /* ========== PRICE CALCULATION ========== */

  function calculatePremium(uint priceRatio, uint coverAmount, uint period) public pure returns (uint) {
    return priceRatio * coverAmount / MAX_PRICE_RATIO * period / 365 days;
  }

  uint public constant SURGE_THRESHOLD_RATIO = 8e17;
  uint public constant BASE_SURGE_LOADING_RATIO = 1e17;
  uint public constant SURGE_DENOMINATOR = 1e18;


  function getActualPriceAndUpdateBasePrice(
    uint productId,
    uint amount,
    uint activeCover,
    uint capacity,
    uint initialPrice
  ) internal returns (uint) {

    (uint actualPrice, uint basePrice) = getPrices(
      amount, activeCover, capacity, initialPrice, lastBasePrices[productId], targetPrices[productId], block.timestamp
    );
    // store the last base price
    lastBasePrices[productId] = LastPrice(
      uint96(basePrice),
      uint32(block.timestamp)
    );

    return actualPrice;
  }

  function getPrices(
    uint amount,
    uint activeCover,
    uint capacity,
    uint initialPrice,
    LastPrice memory lastBasePrice,
    uint targetPrice,
    uint blockTimestamp
  ) public view returns (uint actualPrice, uint basePrice) {

    basePrice = interpolatePrice(
      lastBasePrice.value != 0 ? lastBasePrice.value : initialPrice,
      targetPrice,
      lastBasePrice.lastUpdateTime,
      blockTimestamp
    );

    console.log("basePrice", basePrice);

    // calculate actualPrice using the current basePrice
    actualPrice = calculatePrice(amount, basePrice, activeCover, capacity);

    console.log("actualPrice", actualPrice);

    // Bump base price by 2% (200 basis points) per 10% (1000 basis points) of capacity used
    uint priceBump = amount * BASE_PRICE_BUMP_DENOMINATOR / capacity / BASE_PRICE_BUMP_INTERVAL * BASE_PRICE_BUMP_RATIO;

    console.log("priceBump", priceBump);
    basePrice = uint96(basePrice + priceBump);
  }

  function calculatePrice(
    uint amount,
    uint basePrice,
    uint activeCover,
    uint capacity
  ) public pure returns (uint) {

    uint activeCoverRatio = activeCover * 1e18 / capacity;
    uint newActiveCoverAmount = amount + activeCover;
    uint newActiveCoverRatio = newActiveCoverAmount * 1e18 / capacity;

    if (newActiveCoverRatio < SURGE_THRESHOLD_RATIO) {
      return basePrice;
    }

    uint surgeLoadingRatio = newActiveCoverRatio - SURGE_THRESHOLD_RATIO;

    // if the active cover ratio is already above SURGE_THRESHOLD (80%) then apply the surge loading to the entire
    // value of the cover (surgeFraction = 1). Otherwise apply to the part of the cover that is above the threshold.
    uint surgeFraction = activeCoverRatio >= SURGE_THRESHOLD_RATIO ? SURGE_DENOMINATOR : surgeLoadingRatio * capacity / amount;

    // apply a base BASE_SURGE_LOADING_RATIO of 10% for each 1% of the surgeLoadingRatio
    uint surgeLoading =
      BASE_SURGE_LOADING_RATIO
      * surgeLoadingRatio / (SURGE_DENOMINATOR / 100)
      / 2 * surgeFraction / 1e18;

    return basePrice * (1e18 + surgeLoading) / 1e18;
  }

  /**
   * Price changes towards targetPrice from lastPrice by maximum of 1% a day per every 100k NXM staked
   */
  function interpolatePrice(
    uint lastPrice,
    uint targetPrice,
    uint lastPriceUpdate,
    uint currentTimestamp
  ) public pure returns (uint) {

    uint priceChange = (currentTimestamp - lastPriceUpdate) / 1 days * PRICE_RATIO_CHANGE_PER_DAY;

    if (targetPrice > lastPrice) {
      return targetPrice;
    }

    return lastPrice - (lastPrice - targetPrice) * priceChange / PRICE_DENOMINATOR;
  }
}