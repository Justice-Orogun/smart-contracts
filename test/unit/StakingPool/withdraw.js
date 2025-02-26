const { ethers, expect } = require('hardhat');
const { increaseTime, mineNextBlock, setNextBlockTime } = require('../utils').evm;
const {
  getTranches,
  getNewRewardShares,
  estimateStakeShares,
  calculateStakeAndRewardsWithdrawAmounts,
  setTime,
  generateRewards,
  TRANCHE_DURATION,
  BUCKET_DURATION,
} = require('./helpers');

const { BigNumber } = ethers;
const { AddressZero } = ethers.constants;
const { parseEther } = ethers.utils;

const product0 = {
  productId: 0,
  weight: 100,
  initialPrice: '500',
  targetPrice: '500',
};

const initializeParams = {
  poolId: 1,
  isPrivatePool: false,
  initialPoolFee: 5, // 5%
  maxPoolFee: 5, // 5%
  products: [product0],
  ipfsDescriptionHash: 'Description Hash',
};

const withdrawFixture = {
  ...initializeParams,
  amount: parseEther('100'),
  trancheId: 0,
  tokenId: 1,
  destination: AddressZero,
};

describe('withdraw', function () {
  beforeEach(async function () {
    const { stakingPool, stakingProducts, coverSigner, tokenController } = this;
    const manager = this.accounts.defaultSender;

    const { poolId, initialPoolFee, maxPoolFee, products, isPrivatePool, ipfsDescriptionHash } = initializeParams;

    await stakingPool
      .connect(coverSigner)
      .initialize(isPrivatePool, initialPoolFee, maxPoolFee, poolId, ipfsDescriptionHash);

    await tokenController.setStakingPoolManager(poolId, manager.address);

    await stakingProducts.connect(this.coverSigner).setInitialProducts(poolId, products);

    // Move to the beginning of the next tranche
    const { firstActiveTrancheId: trancheId } = await getTranches();
    await setTime((trancheId + 1) * TRANCHE_DURATION);
  });

  it('reverts if system is paused', async function () {
    const { stakingPool, master } = this;
    const [user] = this.accounts.members;

    const { tokenId } = withdrawFixture;
    const { firstActiveTrancheId } = await getTranches();

    // enable emergency pause
    await master.setEmergencyPause(true);

    await expect(
      stakingPool.connect(user).withdraw(tokenId, true, false, [firstActiveTrancheId]),
    ).to.be.revertedWithCustomError(stakingPool, 'SystemPaused');
  });

  it('reverts if trying to withdraw stake locked in governance', async function () {
    const { nxm, stakingPool } = this;
    const manager = this.accounts.defaultSender;
    const [user] = this.accounts.members;

    const { amount, tokenId, destination } = withdrawFixture;

    const { firstActiveTrancheId } = await getTranches();

    await stakingPool.connect(user).depositTo(
      amount,
      firstActiveTrancheId,
      0, // new position,
      destination,
    );

    await increaseTime(TRANCHE_DURATION);

    // Simulate manager lock in governance
    await nxm.setLock(manager.address, 1e6);

    const withdrawStake = true;
    const withdrawRewards = true;
    const trancheIds = [firstActiveTrancheId];

    await expect(
      stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds),
    ).to.be.revertedWithCustomError(stakingPool, 'ManagerNxmIsLockedForGovernanceVote');
  });

  it('allows to withdraw only stake', async function () {
    const { nxm, coverSigner, stakingPool, tokenController } = this;
    const [user] = this.accounts.members;

    const { amount: depositAmount, tokenId, destination } = withdrawFixture;
    const { firstActiveTrancheId } = await getTranches();

    await stakingPool.connect(user).depositTo(
      depositAmount,
      firstActiveTrancheId,
      0, // new position
      destination,
    );

    await generateRewards(stakingPool, coverSigner);
    await increaseTime(TRANCHE_DURATION);

    const withdrawStake = true;
    const withdrawRewards = false;
    const trancheIds = [firstActiveTrancheId];

    const depositBefore = await stakingPool.deposits(tokenId, firstActiveTrancheId);
    const userBalanceBefore = await nxm.balanceOf(user.address);
    const tcBalanceBefore = await nxm.balanceOf(tokenController.address);

    await stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds);

    const depositAfter = await stakingPool.deposits(tokenId, firstActiveTrancheId);
    const userBalanceAfter = await nxm.balanceOf(user.address);
    const tcBalanceAfter = await nxm.balanceOf(tokenController.address);

    const expectedShares = Math.sqrt(depositAmount);
    expect(depositBefore.stakeShares).to.be.eq(expectedShares);
    expect(depositAfter.stakeShares).to.be.eq(0);

    expect(userBalanceAfter).to.be.eq(userBalanceBefore.add(depositAmount));
    expect(tcBalanceAfter).to.be.eq(tcBalanceBefore.sub(depositAmount));
  });

  it('transfers nxm stake and rewards from token controller to nft owner', async function () {
    const { nxm, coverSigner, stakingPool, tokenController } = this;
    const [user] = this.accounts.members;

    const { amount, tokenId, destination } = withdrawFixture;

    const { firstActiveTrancheId } = await getTranches();

    await stakingPool.connect(user).depositTo(
      amount,
      firstActiveTrancheId,
      0, // new position,
      destination,
    );

    await generateRewards(stakingPool, coverSigner);

    await increaseTime(TRANCHE_DURATION);
    await mineNextBlock();

    const withdrawStake = true;
    const withdrawRewards = true;
    const trancheIds = [firstActiveTrancheId];

    const tcBalanceBefore = await nxm.balanceOf(tokenController.address);
    const userBalanceBefore = await nxm.balanceOf(user.address);
    const deposit = await stakingPool.deposits(tokenId, firstActiveTrancheId);

    await stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds);

    const tcBalanceAfter = await nxm.balanceOf(tokenController.address);
    const userBalanceAfter = await nxm.balanceOf(user.address);

    const { accNxmPerRewardShareAtExpiry } = await stakingPool.getExpiredTranche(firstActiveTrancheId);
    const rewardsWithdrawn = deposit.rewardsShares
      .mul(accNxmPerRewardShareAtExpiry.sub(deposit.lastAccNxmPerRewardShare))
      .div(parseEther('1'))
      .add(deposit.pendingRewards);

    expect(tcBalanceAfter).to.be.eq(tcBalanceBefore.sub(rewardsWithdrawn).sub(amount));
    expect(userBalanceAfter).to.be.eq(userBalanceBefore.add(rewardsWithdrawn).add(amount));
  });

  it('allows to withdraw only rewards', async function () {
    const { nxm, coverSigner, stakingPool, tokenController } = this;
    const [user] = this.accounts.members;
    const { defaultSender: manager } = this.accounts;

    const { amount, tokenId, destination } = withdrawFixture;
    const { firstActiveTrancheId } = await getTranches();

    await stakingPool.connect(user).depositTo(
      amount,
      firstActiveTrancheId,
      0, // new position
      destination,
    );

    const expectedStakeShares = Math.sqrt(amount);
    const expectedRewardShares = await getNewRewardShares({
      stakingPool,
      initialStakeShares: 0,
      stakeSharesIncrease: expectedStakeShares,
      initialTrancheId: firstActiveTrancheId,
      newTrancheId: firstActiveTrancheId,
    });

    const tcBalanceInitial = await nxm.balanceOf(tokenController.address);
    await generateRewards(stakingPool, coverSigner);

    const depositBefore = await stakingPool.deposits(tokenId, firstActiveTrancheId);
    const userBalanceBefore = await nxm.balanceOf(user.address);
    const managerBalanceBefore = await nxm.balanceOf(manager.address);
    const tcBalanceBefore = await nxm.balanceOf(tokenController.address);

    const managerTokenId = 0;
    const managerDepositBefore = await stakingPool.deposits(managerTokenId, firstActiveTrancheId);

    await increaseTime(TRANCHE_DURATION);

    const withdrawStake = false;
    const withdrawRewards = true;
    const trancheIds = [firstActiveTrancheId];

    // User withdraw
    await stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds);

    // Manager withdraw
    await stakingPool.connect(manager).withdraw(managerTokenId, withdrawStake, withdrawRewards, trancheIds);

    const rewardPerSecondAfter = await stakingPool.getRewardPerSecond();
    expect(rewardPerSecondAfter).to.equal(0);

    const depositAfter = await stakingPool.deposits(tokenId, firstActiveTrancheId);
    const userBalanceAfter = await nxm.balanceOf(user.address);
    const managerBalanceAfter = await nxm.balanceOf(manager.address);
    const tcBalanceAfter = await nxm.balanceOf(tokenController.address);

    expect(depositBefore.stakeShares).to.be.eq(expectedStakeShares);
    expect(depositAfter.stakeShares).to.be.eq(expectedStakeShares);

    expect(depositBefore.rewardsShares).to.be.eq(expectedRewardShares);
    expect(depositAfter.pendingRewards).to.be.eq(0);

    const { accNxmPerRewardShareAtExpiry } = await stakingPool.getExpiredTranche(firstActiveTrancheId);

    const expectedUserRewardsWithdrawn = depositBefore.rewardsShares
      .mul(accNxmPerRewardShareAtExpiry.sub(depositBefore.lastAccNxmPerRewardShare))
      .div(parseEther('1'))
      .add(depositBefore.pendingRewards);

    const expectedManagerRewardsWithdrawn = managerDepositBefore.rewardsShares
      .mul(accNxmPerRewardShareAtExpiry.sub(depositBefore.lastAccNxmPerRewardShare))
      .div(parseEther('1'))
      .add(managerDepositBefore.pendingRewards);

    const expectedRewardsWithdrawn = expectedUserRewardsWithdrawn.add(expectedManagerRewardsWithdrawn);
    const rewardsMinted = tcBalanceBefore.sub(tcBalanceInitial);

    expect(userBalanceAfter).to.be.eq(userBalanceBefore.add(expectedUserRewardsWithdrawn));
    expect(managerBalanceAfter).to.be.eq(managerBalanceBefore.add(expectedManagerRewardsWithdrawn));
    expect(tcBalanceAfter).to.be.eq(tcBalanceInitial.add(1)); // add 1 because of round error
    expect(expectedRewardsWithdrawn).to.be.eq(rewardsMinted.sub(1)); // sub 1 because of round error
  });

  it('allows to withdraw stake only if tranche is expired', async function () {
    const { tokenController, nxm, stakingPool } = this;
    const [user] = this.accounts.members;

    const { amount, tokenId, destination } = withdrawFixture;

    const { firstActiveTrancheId } = await getTranches();

    await stakingPool.connect(user).depositTo(
      amount,
      firstActiveTrancheId,
      0, // new position
      destination,
    );

    const withdrawStake = true;
    const withdrawRewards = true;
    const trancheIds = [firstActiveTrancheId];

    const depositBefore = await stakingPool.deposits(tokenId, firstActiveTrancheId);
    const userBalanceBefore = await nxm.balanceOf(user.address);
    const tcBalanceBefore = await nxm.balanceOf(tokenController.address);

    await expect(stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds)).to.not.be
      .reverted;

    const depositAfter = await stakingPool.deposits(tokenId, firstActiveTrancheId);
    const userBalanceAfter = await nxm.balanceOf(user.address);
    const tcBalanceAfter = await nxm.balanceOf(tokenController.address);

    // Nothing changes
    expect(depositBefore.stakeShares).to.be.eq(depositAfter.stakeShares);
    expect(userBalanceBefore).to.be.eq(userBalanceAfter);
    expect(tcBalanceBefore).to.be.eq(tcBalanceAfter);
  });

  it('allows to withdraw stake and rewards from multiple tranches', async function () {
    const { nxm, coverSigner, stakingPool, tokenController } = this;
    const [user] = this.accounts.members;
    const { amount, tokenId, destination } = withdrawFixture;

    const TRANCHES_NUMBER = 5;
    const trancheIds = [];

    const withdrawStake = true;
    const withdrawRewards = true;

    for (let i = 0; i < TRANCHES_NUMBER; i++) {
      const { firstActiveTrancheId: currentTranche } = await getTranches();

      await stakingPool.connect(user).depositTo(
        amount,
        currentTranche,
        i === 0 ? 0 : tokenId, // Only create new position for the first tranche
        destination,
      );

      trancheIds.push(currentTranche);
      await generateRewards(stakingPool, coverSigner);
      await increaseTime(TRANCHE_DURATION);
      await mineNextBlock();
    }

    const depositsBeforeWithdraw = {};
    for (const tranche of trancheIds) {
      depositsBeforeWithdraw[tranche] = await stakingPool.deposits(tokenId, tranche);
    }

    const userBalanceBefore = await nxm.balanceOf(user.address);
    const tcBalanceBefore = await nxm.balanceOf(tokenController.address);

    await stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds);

    const userBalanceAfter = await nxm.balanceOf(user.address);
    const tcBalanceAfter = await nxm.balanceOf(tokenController.address);

    const lastTrancheId = trancheIds[TRANCHES_NUMBER - 1];
    const expiredTranche = await stakingPool.getExpiredTranche(lastTrancheId);
    const depositAfter = await stakingPool.deposits(tokenId, lastTrancheId);

    expect(depositAfter.stakeShares).to.be.eq(0);
    expect(depositAfter.rewardsShares).to.be.eq(depositsBeforeWithdraw[lastTrancheId].rewardsShares);
    expect(depositAfter.lastAccNxmPerRewardShare).to.be.eq(expiredTranche.accNxmPerRewardShareAtExpiry);
    expect(depositAfter.pendingRewards).to.be.eq(0);

    let rewardsWithdrawn = BigNumber.from(0);
    let stakeWithdrawn = BigNumber.from(0);

    for (const tranche of trancheIds) {
      const { rewards, stake } = await calculateStakeAndRewardsWithdrawAmounts(
        stakingPool,
        depositsBeforeWithdraw[tranche],
        tranche,
      );

      rewardsWithdrawn = rewardsWithdrawn.add(rewards);
      stakeWithdrawn = stakeWithdrawn.add(stake);
    }

    expect(userBalanceAfter).to.be.eq(userBalanceBefore.add(rewardsWithdrawn).add(stakeWithdrawn));
    expect(tcBalanceAfter).to.be.eq(tcBalanceBefore.sub(rewardsWithdrawn).sub(stakeWithdrawn));
  });

  it('update tranches', async function () {
    const { coverSigner, stakingPool } = this;
    const [user] = this.accounts.members;

    const { amount, tokenId, destination } = withdrawFixture;

    const { firstActiveTrancheId } = await getTranches();

    await stakingPool.connect(user).depositTo(
      amount,
      firstActiveTrancheId,
      0, // new position,
      destination,
    );

    const withdrawStake = false;
    const withdrawRewards = true;
    const trancheIds = [firstActiveTrancheId];

    const activeStakeBefore = await stakingPool.getActiveStake();
    const accNxmPerRewardsShareBefore = await stakingPool.getAccNxmPerRewardsShare();
    const lastAccNxmUpdateBefore = await stakingPool.getLastAccNxmUpdate();
    const stakeSharesSupplyBefore = await stakingPool.getStakeSharesSupply();
    const rewardsSharesSupplyBefore = await stakingPool.getRewardsSharesSupply();

    await generateRewards(stakingPool, coverSigner);

    await increaseTime(TRANCHE_DURATION);
    await mineNextBlock();

    await stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds);

    const activeStakeAfter = await stakingPool.getActiveStake();
    const accNxmPerRewardsShareAfter = await stakingPool.getAccNxmPerRewardsShare();
    const lastAccNxmUpdateAfter = await stakingPool.getLastAccNxmUpdate();
    const stakeSharesSupplyAfter = await stakingPool.getStakeSharesSupply();
    const rewardsSharesSupplyAfter = await stakingPool.getRewardsSharesSupply();

    expect(activeStakeAfter).to.not.eq(activeStakeBefore);
    expect(accNxmPerRewardsShareAfter).to.not.eq(accNxmPerRewardsShareBefore);
    expect(lastAccNxmUpdateAfter).to.not.eq(lastAccNxmUpdateBefore);
    expect(stakeSharesSupplyAfter).to.not.eq(stakeSharesSupplyBefore);
    expect(rewardsSharesSupplyAfter).to.not.eq(rewardsSharesSupplyBefore);
  });

  it('anyone can call to withdraw stake and rewards for a token id', async function () {
    const { coverSigner, stakingPool, nxm } = this;
    const [user] = this.accounts.members;
    const [randomUser] = this.accounts.nonMembers;

    const { amount, tokenId, destination } = withdrawFixture;

    const { firstActiveTrancheId } = await getTranches();

    await stakingPool.connect(user).depositTo(
      amount,
      firstActiveTrancheId,
      0, // new position
      destination,
    );

    const withdrawStake = true;
    const withdrawRewards = false;
    const trancheIds = [firstActiveTrancheId];

    await generateRewards(stakingPool, coverSigner);

    const deposit = await stakingPool.deposits(tokenId, firstActiveTrancheId);
    await increaseTime(TRANCHE_DURATION);

    const userBalanceBefore = await nxm.balanceOf(user.address);
    const randomUserBalanceBefore = await nxm.balanceOf(randomUser.address);

    await expect(stakingPool.connect(randomUser).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds)).to.not
      .be.reverted;

    const { stake } = await calculateStakeAndRewardsWithdrawAmounts(stakingPool, deposit, firstActiveTrancheId);

    const userBalanceAfter = await nxm.balanceOf(user.address);
    const randomUserBalanceAfter = await nxm.balanceOf(randomUser.address);

    expect(randomUserBalanceAfter).to.eq(randomUserBalanceBefore);
    expect(userBalanceAfter).to.eq(userBalanceBefore.add(stake));
  });

  it('allows withdrawing rewards multiple times', async function () {
    const { coverSigner, stakingPool, stakingNFT, nxm, tokenController } = this;
    const [alice, bob] = this.accounts.members;
    const manager = this.accounts.defaultSender;

    // deposit params
    const amount = parseEther('10');
    const rewardsPeriod = 20 * 24 * 3600;
    const { firstActiveTrancheId } = await getTranches();
    const lastTrancheId = firstActiveTrancheId + 7;

    // allocation params
    const previousPremium = 0;
    const allocationRequest = {
      productId: 0,
      coverId: 0,
      allocationId: 0,
      period: rewardsPeriod,
      gracePeriod: 0,
      previousStart: 0,
      previousExpiration: 0,
      previousRewardsRatio: 5000,
      useFixedPrice: true, // using fixed price to get the exact same premium
      globalCapacityRatio: 20000,
      capacityReductionRatio: 0,
      rewardRatio: 10000, // 1:1
      globalMinPrice: 10000,
    };

    const poolId = initializeParams.poolId;
    const lastTokenId = await stakingNFT.totalSupply();
    const [aliceTokenId, bobTokenId] = [lastTokenId.add(1), lastTokenId.add(2)];

    // alice creates 2 deposits at the same time
    await stakingPool
      .connect(alice)
      .multicall(
        [
          await stakingPool.populateTransaction.depositTo(amount, lastTrancheId, 0, alice.address),
          await stakingPool.populateTransaction.depositTo(amount, lastTrancheId, 0, bob.address),
        ].map(tx => tx.data),
      );

    const { timestamp: depositTimestamp } = await ethers.provider.getBlock('latest');

    const aliceDeposit = await stakingPool.getDeposit(aliceTokenId, lastTrancheId);
    const bobDeposit = await stakingPool.getDeposit(bobTokenId, lastTrancheId);

    expect(aliceDeposit.stakeShares).to.eq(bobDeposit.stakeShares);
    expect(aliceDeposit.rewardsShares).to.eq(bobDeposit.rewardsShares);

    const aliceBalanceBefore = await nxm.balanceOf(alice.address);
    const bobBalanceBefore = await nxm.balanceOf(bob.address);
    const managerBalanceBefore = await nxm.balanceOf(manager.address);

    const { rewards: rewardsMintedBefore } = await tokenController.stakingPoolNXMBalances(poolId);

    const rewardsTimestamp = depositTimestamp + 1;
    const rewardExpirationBucket = Math.ceil((rewardsTimestamp + rewardsPeriod) / BUCKET_DURATION);
    const rewardExpirationTimestamp = rewardExpirationBucket * BUCKET_DURATION;
    const rewardStreamPeriod = rewardExpirationTimestamp - rewardsTimestamp;

    // static call to simulate the call and get the function return data
    const { premium } = await stakingPool
      .connect(coverSigner)
      .callStatic.requestAllocation(amount, previousPremium, allocationRequest);

    // set the exact time and send the tx
    await setNextBlockTime(rewardsTimestamp);
    await stakingPool.connect(coverSigner).requestAllocation(amount, previousPremium, allocationRequest);

    const { rewards: rewardsMintedAfter } = await tokenController.stakingPoolNXMBalances(poolId);
    const actualRewardsMinted = rewardsMintedAfter.sub(rewardsMintedBefore);

    // advance time and withdraw rewards
    const withdrawStake = false;
    const withdrawRewards = true;

    // half way through rewards period
    await increaseTime(rewardsPeriod / 2);
    await stakingPool.withdraw(aliceTokenId, withdrawStake, withdrawRewards, [lastTrancheId]);

    // advance time untill after the rewards period has ended
    await increaseTime(rewardsPeriod + BUCKET_DURATION);
    await stakingPool.withdraw(aliceTokenId, withdrawStake, withdrawRewards, [lastTrancheId]);
    await stakingPool.withdraw(bobTokenId, withdrawStake, withdrawRewards, [lastTrancheId]);
    await stakingPool.withdraw(0, withdrawStake, withdrawRewards, [lastTrancheId]);

    const { rewards: rewardsLeft } = await tokenController.stakingPoolNXMBalances(poolId);

    const rewardPerSecond = premium.div(rewardStreamPeriod);
    const expectedRewardsMinted = rewardPerSecond.mul(rewardStreamPeriod);

    const aliceBalanceAfter = await nxm.balanceOf(alice.address);
    const bobBalanceAfter = await nxm.balanceOf(bob.address);
    const managerBalanceAfter = await nxm.balanceOf(manager.address);

    const aliceRewards = aliceBalanceAfter.sub(aliceBalanceBefore);
    const bobRewards = bobBalanceAfter.sub(bobBalanceBefore);
    const managerRewards = managerBalanceAfter.sub(managerBalanceBefore);

    const managerDeposit = await stakingPool.getDeposit(0, lastTrancheId);
    const rewardShareSupply = await stakingPool.getRewardsSharesSupply();
    const expectedManagerRewards = expectedRewardsMinted.mul(managerDeposit.rewardsShares).div(rewardShareSupply);

    const expectedPerStakerRewards = expectedRewardsMinted.mul(aliceDeposit.rewardsShares).div(rewardShareSupply);
    const expectedWithdrawnRewards = expectedPerStakerRewards.mul(2).add(expectedManagerRewards);
    const expectedLeftRewards = expectedRewardsMinted.sub(expectedWithdrawnRewards);

    expect(actualRewardsMinted).to.eq(expectedRewardsMinted);
    expect(rewardsLeft).to.eq(expectedLeftRewards);
    expect(managerRewards).to.eq(expectedManagerRewards);
    expect(aliceRewards).to.eq(expectedPerStakerRewards);
    expect(aliceRewards).to.eq(bobRewards);
  });

  it('should emit some event', async function () {
    const { coverSigner, stakingPool } = this;
    const [user] = this.accounts.members;
    const { amount, tokenId, destination } = withdrawFixture;

    const TRANCHES_NUMBER = 3;
    const trancheIds = [];

    const withdrawStake = true;
    const withdrawRewards = true;

    for (let i = 0; i < TRANCHES_NUMBER; i++) {
      const { firstActiveTrancheId: currentTranche } = await getTranches();

      await stakingPool.connect(user).depositTo(
        amount.mul(i * 5 + 1),
        currentTranche,
        i === 0 ? 0 : tokenId, // Only create new position for the first tranche
        destination,
      );

      trancheIds.push(currentTranche);
      await generateRewards(stakingPool, coverSigner);
      await increaseTime(TRANCHE_DURATION);
      await mineNextBlock();
    }

    const depositsBeforeWithdraw = {};
    for (const tranche of trancheIds) {
      depositsBeforeWithdraw[tranche] = await stakingPool.deposits(tokenId, tranche);
    }

    // Update expiredTranches
    await stakingPool.processExpirations(true);

    const stakes = [];
    const rewards = [];
    for (const tranche of trancheIds) {
      const { rewards: currentReward, stake } = await calculateStakeAndRewardsWithdrawAmounts(
        stakingPool,
        depositsBeforeWithdraw[tranche],
        tranche,
      );

      stakes.push(stake);
      rewards.push(currentReward);
    }

    await expect(stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds))
      .to.emit(stakingPool, 'Withdraw')
      .withArgs(user.address, tokenId, trancheIds[0], stakes[0], rewards[0])
      .to.emit(stakingPool, 'Withdraw')
      .withArgs(user.address, tokenId, trancheIds[1], stakes[1], rewards[1])
      .to.emit(stakingPool, 'Withdraw')
      .withArgs(user.address, tokenId, trancheIds[2], stakes[2], rewards[2]);
  });

  it('allow multiple users to withdraw stake and rewards from multiple tranches', async function () {
    const { nxm, coverSigner, stakingPool, tokenController } = this;
    const [user1, user2, user3] = this.accounts.members;
    const { defaultSender: manager } = this.accounts;
    const { destination } = withdrawFixture;

    const users = [user1, user2, user3];
    const depositAmounts = [
      [parseEther('100'), parseEther('300'), parseEther('200')],
      [parseEther('150'), parseEther('225'), parseEther('333')],
      [parseEther('600'), parseEther('100'), parseEther('100')],
      [parseEther('120'), parseEther('75'), parseEther('1')],
      [parseEther('13'), parseEther('100'), parseEther('100')],
    ];

    const tokenIds = [1, 2, 3];
    const TRANCHE_COUNT = 5;
    const trancheIds = [];

    const withdrawStake = true;
    const withdrawRewards = true;

    const { firstActiveTrancheId: currentTranche } = await getTranches();
    const userShares = {};

    let activeStake = BigNumber.from(0);
    let stakeSharesSupply = BigNumber.from(0);

    for (let t = 0; t < TRANCHE_COUNT; t++) {
      userShares[t] = {};

      for (let uid = 0; uid < users.length; uid++) {
        const user = users[uid];
        const amount = depositAmounts[t][uid];

        const stakeShares = await estimateStakeShares({ amount, stakingPool });
        userShares[t][uid] = { amount, stakeShares };

        await stakingPool.connect(user).depositTo(
          amount,
          currentTranche + t,
          t === 0 ? 0 : tokenIds[uid], // Only create new position for the first tranche
          destination,
        );

        stakeSharesSupply = stakeSharesSupply.add(stakeShares);
        activeStake = activeStake.add(amount);
      }

      trancheIds.push(currentTranche + t);
    }

    const tcBalanceBeforeRewards = await nxm.balanceOf(tokenController.address);

    const allocationAmount = parseEther('100');
    await generateRewards(stakingPool, coverSigner, undefined, undefined, allocationAmount);

    const tcBalanceAfterRewards = await nxm.balanceOf(tokenController.address);
    const rewardedAmount = tcBalanceAfterRewards.sub(tcBalanceBeforeRewards);

    await increaseTime(TRANCHE_DURATION * TRANCHE_COUNT);
    await mineNextBlock();

    const depositsBeforeWithdraw = {};

    for (let t = 0; t < TRANCHE_COUNT; t++) {
      const tranche = trancheIds[t];
      depositsBeforeWithdraw[tranche] = {};

      for (let uid = 0; uid < users.length; uid++) {
        const deposit = await stakingPool.deposits(tokenIds[uid], tranche);
        depositsBeforeWithdraw[tranche][uid] = deposit;

        const { stakeShares } = deposit;
        expect(stakeShares).to.eq(userShares[t][uid].stakeShares);
      }
    }

    let totalRewardsWithdrawn = BigNumber.from(0);

    for (let uid = 0; uid < users.length; uid++) {
      const user = users[uid];

      const userBalanceBefore = await nxm.balanceOf(user.address);
      const tcBalanceBefore = await nxm.balanceOf(tokenController.address);

      await stakingPool.connect(user).withdraw(tokenIds[uid], withdrawStake, withdrawRewards, trancheIds);

      const userBalanceAfter = await nxm.balanceOf(user.address);
      const tcBalanceAfter = await nxm.balanceOf(tokenController.address);

      let rewardsWithdrawn = BigNumber.from(0);
      let stakeWithdrawn = BigNumber.from(0);

      for (let t = 0; t < TRANCHE_COUNT; t++) {
        const tranche = trancheIds[t];

        const { rewards, stake } = await calculateStakeAndRewardsWithdrawAmounts(
          stakingPool,
          depositsBeforeWithdraw[tranche][uid],
          tranche,
        );

        stakeWithdrawn = stakeWithdrawn.add(stake);
        rewardsWithdrawn = rewardsWithdrawn.add(rewards);
        totalRewardsWithdrawn = totalRewardsWithdrawn.add(rewards);
      }

      expect(userBalanceAfter).to.be.eq(userBalanceBefore.add(rewardsWithdrawn).add(stakeWithdrawn));
      expect(tcBalanceAfter).to.be.eq(tcBalanceBefore.sub(rewardsWithdrawn).sub(stakeWithdrawn));
    }

    // withdraw manager rewards
    const managerTokenId = 0;
    const managerDepositsBeforeWithdraw = {};
    for (let t = 0; t < TRANCHE_COUNT; t++) {
      const tranche = trancheIds[t];
      const deposit = await stakingPool.deposits(managerTokenId, tranche);
      managerDepositsBeforeWithdraw[tranche] = deposit;
    }

    const managerBalanceBefore = await nxm.balanceOf(manager.address);
    const tcBalanceBefore = await nxm.balanceOf(tokenController.address);

    await stakingPool.connect(manager).withdraw(managerTokenId, withdrawStake, withdrawRewards, trancheIds);

    const managerBalanceAfter = await nxm.balanceOf(manager.address);
    const tcBalanceAfter = await nxm.balanceOf(tokenController.address);

    let rewardsWithdrawn = BigNumber.from(0);
    let stakeWithdrawn = BigNumber.from(0);

    for (let t = 0; t < TRANCHE_COUNT; t++) {
      const tranche = trancheIds[t];

      const { rewards, stake } = await calculateStakeAndRewardsWithdrawAmounts(
        stakingPool,
        managerDepositsBeforeWithdraw[tranche],
        tranche,
      );

      stakeWithdrawn = stakeWithdrawn.add(stake);
      rewardsWithdrawn = rewardsWithdrawn.add(rewards);
      totalRewardsWithdrawn = totalRewardsWithdrawn.add(rewards);
    }

    expect(managerBalanceAfter).to.be.eq(managerBalanceBefore.add(rewardsWithdrawn).add(stakeWithdrawn));
    expect(tcBalanceAfter).to.be.eq(tcBalanceBefore.sub(rewardsWithdrawn).sub(stakeWithdrawn));

    // Consider 11 wei of accumulated round error
    expect(totalRewardsWithdrawn).to.be.gte(rewardedAmount.sub(11));
    expect(totalRewardsWithdrawn).to.be.lte(rewardedAmount);
  });
});
