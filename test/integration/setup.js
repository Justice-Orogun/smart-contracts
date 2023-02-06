const { BigNumber } = require('ethers');
const { ethers } = require('hardhat');
const { expect } = require('chai');

const { ContractTypes } = require('../utils').constants;
const { toBytes2, toBytes8 } = require('../utils').helpers;
const { proposalCategories } = require('../utils');
const { getAccounts, stakingPoolManagers } = require('../utils').accounts;
const { enrollMember } = require('./utils/enroll');

const { getContractAddress, parseEther, parseUnits } = ethers.utils;
const { AddressZero, MaxUint256 } = ethers.constants;

const deployProxy = async (contract, deployParams = [], options = {}) => {
  const contractFactory = await ethers.getContractFactory(contract, options);
  const implementation = await contractFactory.deploy(...deployParams);
  const proxy = await ethers.deployContract('OwnedUpgradeabilityProxy', [implementation.address]);
  return await ethers.getContractAt(contract, proxy.address);
};

const upgradeProxy = async (proxyAddress, contract, constructorArgs = [], options = {}) => {
  const contractFactory = await ethers.getContractFactory(contract, options);
  const impl = await contractFactory.deploy(...constructorArgs);
  const proxy = await ethers.getContractAt('OwnedUpgradeabilityProxy', proxyAddress);
  await proxy.upgradeTo(impl.address);
  const instance = await ethers.getContractAt(contract, proxyAddress);
  return instance;
};

const transferProxyOwnership = async (proxyAddress, newOwner) => {
  const proxy = await ethers.getContractAt('OwnedUpgradeabilityProxy', proxyAddress);
  await proxy.transferProxyOwnership(newOwner);
};

async function setup() {
  const ethersAccounts = await getAccounts();
  const { members, emergencyAdmin } = ethersAccounts;
  const owner = ethersAccounts.defaultSender;

  const QE = '0x51042c4d8936a7764d18370a6a0762b860bb8e07';
  const INITIAL_SUPPLY = parseEther('15000000000');

  // deploy external contracts
  const weth = await ethers.deployContract('WETH9');

  const dai = await ethers.deployContract('ERC20Mock');
  await dai.mint(owner.address, parseEther('10000000'));

  const stETH = await ethers.deployContract('ERC20Mock');
  await stETH.mint(owner.address, parseEther('10000000'));

  const enzymeVault = await ethers.deployContract('ERC20Mock');
  await enzymeVault.mint(owner.address, parseEther('10000000'));

  const usdcDecimals = 6;
  const usdc = await ethers.deployContract('ERC20CustomDecimalsMock', [usdcDecimals]);
  await usdc.mint(owner.address, parseUnits('10000000', usdcDecimals));

  const chainlinkDAI = await ethers.deployContract('ChainlinkAggregatorMock');
  await chainlinkDAI.setLatestAnswer(parseEther('1'));

  const chainlinkSteth = await ethers.deployContract('ChainlinkAggregatorMock');
  await chainlinkSteth.setLatestAnswer(parseEther('1'));

  const chainlinkUSDC = await ethers.deployContract('ChainlinkAggregatorMock');
  await chainlinkUSDC.setLatestAnswer(parseEther('1'));

  const chainlinkEnzymeVault = await ethers.deployContract('ChainlinkAggregatorMock');
  await chainlinkEnzymeVault.setLatestAnswer(parseEther('1'));

  const ybDAI = await ethers.deployContract('ERC20Mock');
  await ybDAI.mint(owner.address, parseEther('10000000'));

  const ybETH = await ethers.deployContract('ERC20Mock');
  await ybETH.mint(owner.address, parseEther('10000000'));

  const ybUSDC = await ethers.deployContract('ERC20CustomDecimalsMock', [usdcDecimals]);
  await ybUSDC.mint(owner.address, parseEther('10000000'));

  const tk = await ethers.deployContract('NXMToken', [owner.address, INITIAL_SUPPLY]);

  // proxy contracts
  const master = await deployProxy('DisposableNXMaster');
  const mr = await deployProxy('DisposableMemberRoles', [tk.address]);
  const ps = await deployProxy('DisposablePooledStaking');
  const pc = await deployProxy('DisposableProposalCategory');
  const gv = await deployProxy('DisposableGovernance');
  const gateway = await deployProxy('DisposableGateway');

  // non-proxy contracts
  const lcr = await ethers.deployContract('LegacyClaimsReward', [master.address, dai.address]);

  const mcrEth = parseEther('50000');
  const mcrFloor = mcrEth.sub(parseEther('10000'));

  const latestBlock = await ethers.provider.getBlock('latest');
  const lastUpdateTime = latestBlock.timestamp;
  const mcrFloorIncrementThreshold = 13000;
  const maxMCRFloorIncrement = 100;
  const maxMCRIncrement = 500;
  const gearingFactor = 48000;
  const minUpdateTime = 3600;
  const desiredMCR = mcrEth;

  const disposableMCR = await ethers.deployContract('DisposableMCR', [
    mcrEth,
    mcrFloor,
    desiredMCR,
    lastUpdateTime,
    mcrFloorIncrementThreshold,
    maxMCRFloorIncrement,
    maxMCRIncrement,
    gearingFactor,
    minUpdateTime,
  ]);

  // deploy MCR with DisposableMCR as a fake master
  const mc = await ethers.deployContract('MCR', [disposableMCR.address]);

  // trigger initialize and update master address
  await disposableMCR.initializeNextMcr(mc.address, master.address);

  const priceFeedOracle = await ethers.deployContract('PriceFeedOracle', [
    [dai, stETH, usdc, enzymeVault].map(c => c.address),
    [chainlinkDAI, chainlinkSteth, chainlinkUSDC, chainlinkEnzymeVault].map(c => c.address),
    [18, 18, 6, 18],
  ]);

  // placeholder is swapped with the actual one after master is initialized
  const swapOperatorPlaceholder = { address: AddressZero };

  const p1 = await ethers.deployContract(
    'Pool',
    [master, priceFeedOracle, swapOperatorPlaceholder, dai, stETH, enzymeVault, tk].map(c => c.address),
  );

  const cowVaultRelayer = await ethers.deployContract('SOMockVaultRelayer');
  const cowSettlement = await ethers.deployContract('SOMockSettlement', [cowVaultRelayer.address]);
  const swapOperator = await ethers.deployContract('SwapOperator', [
    cowSettlement.address,
    owner.address, // _swapController,
    master.address,
    weth.address,
    AddressZero,
    AddressZero,
    '0',
  ]);

  const qd = await ethers.deployContract('TestnetQuotationData', [QE, owner.address]);
  const productsV1 = await ethers.deployContract('ProductsV1');

  const ic = await deployProxy('DisposableIndividualClaims', []);
  const yt = await deployProxy('DisposableYieldTokenIncidents', []);
  let as = await deployProxy('DisposableAssessment', []);
  const cl = await deployProxy('CoverMigrator', [qd.address, productsV1.address]);

  const expectedCoverAddress = getContractAddress({
    from: owner.address,
    nonce: (await owner.getTransactionCount()) + 7,
  });

  const spf = await ethers.deployContract('StakingPoolFactory', [expectedCoverAddress]);
  const stakingNFT = await ethers.deployContract('StakingNFT', [
    'Nexus Mutual Deposit',
    'NMD',
    spf.address,
    expectedCoverAddress,
  ]);
  const coverNFT = await ethers.deployContract('CoverNFT', ['Nexus Mutual Cover', 'NMC', expectedCoverAddress]);

  const tc = await deployProxy('DisposableTokenController', [qd.address, lcr.address, spf.address, tk.address]);

  const stakingPool = await ethers.deployContract('StakingPool', [
    stakingNFT.address,
    tk.address,
    expectedCoverAddress,
    tc.address,
    master.address,
  ]);

  let cover = await deployProxy('DisposableCover', [
    coverNFT.address,
    stakingNFT.address,
    spf.address,
    stakingPool.address,
  ]);

  expect(cover.address).to.equal(expectedCoverAddress);

  await cover.changeMasterAddress(master.address);

  const contractType = code => {
    const upgradable = ['MC', 'P1', 'CR'];
    const proxies = ['GV', 'MR', 'PC', 'PS', 'TC', 'GW', 'IC', 'YT', 'AS', 'CO', 'CL'];

    if (upgradable.includes(code)) {
      return ContractTypes.Replaceable;
    }

    if (proxies.includes(code)) {
      return ContractTypes.Proxy;
    }

    return 0;
  };

  const codes = ['QD', 'TC', 'P1', 'MC', 'GV', 'PC', 'MR', 'PS', 'GW', 'IC', 'CL', 'YT', 'AS', 'CO', 'CR'];
  const addresses = [qd, tc, p1, mc, owner, pc, mr, ps, gateway, ic, cl, yt, as, cover, lcr].map(c => c.address);

  await master.initialize(
    owner.address,
    tk.address,
    emergencyAdmin.address,
    codes.map(toBytes2), // codes
    codes.map(contractType), // types
    addresses, // addresses
  );

  await p1.updateAddressParameters(toBytes8('SWP_OP'), swapOperator.address);
  await p1.addAsset(usdc.address, true, parseUnits('1000000', usdcDecimals), parseUnits('2000000', usdcDecimals), 250);

  await tc.initialize(master.address, ps.address, as.address);
  await tc.addToWhitelist(lcr.address);

  await mr.initialize(
    owner.address,
    master.address,
    tc.address,
    [owner.address], // initial members
    [parseEther('10000')], // initial tokens
    [owner.address], // advisory board members
  );

  await mr.setKycAuthAddress(owner.address);

  await pc.initialize(mr.address);

  // FIXME gas override
  for (const category of proposalCategories) {
    await pc.addInitialCategory(...category);
  }

  await gv.initialize(
    3 * 24 * 3600, // tokenHoldingTime
    14 * 24 * 3600, // maxDraftTime
    5, // maxVoteWeigthPer
    40, // maxFollowers
    75, // specialResolutionMajPerc
    24 * 3600, // actionWaitingTime
  );

  await ps.initialize(
    tc.address,
    parseEther('20'), // min stake
    parseEther('20'), // min unstake
    10, // max exposure
    90 * 24 * 3600, // unstake lock time
  );

  await ic.initialize(master.address);

  const CLAIM_METHOD = {
    INDIVIDUAL_CLAIMS: 0,
    YIELD_TOKEN_INCIDENTS: 1,
  };

  await cover.changeDependentContractAddress();

  await cover.setProductTypes([
    {
      // Protocol Cover
      productTypeName: 'Protocol',
      productTypeId: MaxUint256,
      ipfsMetadata: 'protocolCoverIPFSHash',
      productType: {
        descriptionIpfsHash: 'protocolCoverIPFSHash',
        claimMethod: CLAIM_METHOD.INDIVIDUAL_CLAIMS,
        gracePeriod: 30 * 24 * 3600, // 30 days
      },
    },
    {
      // Custody Cover
      productTypeName: 'Custody',
      productTypeId: MaxUint256,
      ipfsMetadata: 'custodyCoverIPFSHash',
      productType: {
        descriptionIpfsHash: 'custodyCoverIPFSHash',
        claimMethod: CLAIM_METHOD.INDIVIDUAL_CLAIMS,
        gracePeriod: 90 * 24 * 3600, // 90 days
      },
    },
    // Yield Token Cover
    {
      productTypeName: 'Yield Token',
      productTypeId: MaxUint256,
      ipfsMetadata: 'yieldTokenCoverIPFSHash',
      productType: {
        descriptionIpfsHash: 'yieldTokenCoverIPFSHash',
        claimMethod: CLAIM_METHOD.YIELD_TOKEN_INCIDENTS,
        gracePeriod: 14 * 24 * 3600, // 14 days
      },
    },
  ]);

  await cover.setProducts([
    {
      productName: 'Product 0',
      productId: MaxUint256,
      ipfsMetadata: 'product 0 metadata',
      product: {
        productType: 0, // Protocol Cover
        yieldTokenAddress: AddressZero,
        coverAssets: 0, // Use fallback
        initialPriceRatio: 100,
        capacityReductionRatio: 0,
        useFixedPrice: false,
      },
      allowedPools: [],
    },
    {
      productName: 'Product 1',
      productId: MaxUint256,
      ipfsMetadata: 'product 1 metadata',
      product: {
        productType: 1, // Custody Cover
        yieldTokenAddress: AddressZero,
        coverAssets: 0, // Use fallback
        initialPriceRatio: 100,
        capacityReductionRatio: 0,
        useFixedPrice: false,
      },
      allowedPools: [],
    },
    {
      productName: 'Product 2',
      productId: MaxUint256,
      ipfsMetadata: 'product 2 metadata',
      product: {
        productType: 2, // Yield Token Cover
        yieldTokenAddress: ybETH.address,
        coverAssets: 0b01, // ETH
        initialPriceRatio: 100,
        capacityReductionRatio: 0,
        useFixedPrice: false,
      },
      allowedPools: [],
    },
    {
      productName: 'Product 3',
      productId: MaxUint256,
      ipfsMetadata: 'product 3 metadata',
      product: {
        productType: 2, // Yield Token Cover
        yieldTokenAddress: ybDAI.address,
        coverAssets: 0b10, // DAI
        initialPriceRatio: 100,
        capacityReductionRatio: 0,
        useFixedPrice: false,
      },
      allowedPools: [],
    },
    {
      productName: 'Product 4',
      productId: MaxUint256,
      ipfsMetadata: 'product 4 metadata',
      product: {
        productType: 0, // Protocol Cover
        yieldTokenAddress: AddressZero,
        coverAssets: 0, // Use fallback
        initialPriceRatio: 100,
        capacityReductionRatio: 0,
        useFixedPrice: true,
      },
      allowedPools: [1],
    },
    {
      productName: 'Product 5',
      productId: MaxUint256,
      ipfsMetadata: 'product 5 metadata',
      product: {
        productType: 2, // Yield Token Cover
        yieldTokenAddress: ybUSDC.address,
        coverAssets: 0b10000, // USDC
        initialPriceRatio: 100,
        capacityReductionRatio: 0,
        useFixedPrice: false,
      },
      allowedPools: [],
    },
    {
      productName: 'Product 6',
      productId: MaxUint256,
      ipfsMetadata: 'product 6 metadata',
      product: {
        productType: 0, // Protocol Cover
        yieldTokenAddress: ybUSDC.address,
        coverAssets: 0b10000, // use usdc
        initialPriceRatio: 100,
        capacityReductionRatio: 0,
        useFixedPrice: false,
      },
      allowedPools: [],
    },
  ]);

  await cover.initialize();

  await gv.changeMasterAddress(master.address);
  await master.switchGovernanceAddress(gv.address);

  await gateway.initialize(master.address, dai.address);

  await yt.initialize(master.address);

  await upgradeProxy(mr.address, 'MemberRoles', [tk.address]);
  await upgradeProxy(tc.address, 'TokenController', [qd.address, lcr.address, spf.address, tk.address]);
  await upgradeProxy(ps.address, 'LegacyPooledStaking', [cover.address, productsV1.address]);
  await upgradeProxy(pc.address, 'ProposalCategory');
  await upgradeProxy(master.address, 'NXMaster');
  await upgradeProxy(gv.address, 'Governance');
  await upgradeProxy(gateway.address, 'LegacyGateway');
  await upgradeProxy(ic.address, 'IndividualClaims', [tk.address, coverNFT.address]);
  await upgradeProxy(yt.address, 'YieldTokenIncidents', [tk.address, coverNFT.address]);
  await upgradeProxy(as.address, 'Assessment', [tk.address]);
  await upgradeProxy(cover.address, 'Cover', [coverNFT.address, stakingNFT.address, spf.address, stakingPool.address]);

  cover = await ethers.getContractAt('Cover', cover.address);
  as = await ethers.getContractAt('Assessment', as.address);

  // [todo] We should probably call changeDependentContractAddress on every contract
  await gateway.changeDependentContractAddress();
  await cover.changeDependentContractAddress();
  await ic.changeDependentContractAddress();
  await as.changeDependentContractAddress();
  await yt.changeDependentContractAddress();

  await transferProxyOwnership(mr.address, master.address);
  await transferProxyOwnership(tc.address, master.address);
  await transferProxyOwnership(ps.address, master.address);
  await transferProxyOwnership(pc.address, master.address);
  await transferProxyOwnership(gv.address, master.address);
  await transferProxyOwnership(gateway.address, master.address);
  await transferProxyOwnership(ic.address, master.address);
  await transferProxyOwnership(cl.address, master.address);
  await transferProxyOwnership(as.address, master.address);
  await transferProxyOwnership(cover.address, gv.address);
  await transferProxyOwnership(master.address, gv.address);

  const POOL_ETHER = parseEther('90000');
  const POOL_DAI = parseEther('2000000');
  const POOL_USDC = parseUnits('2000000', usdcDecimals);

  // fund pool
  await owner.sendTransaction({ to: p1.address, value: POOL_ETHER.toString() });
  await dai.transfer(p1.address, POOL_DAI);
  await usdc.transfer(p1.address, POOL_USDC);

  const ethToDaiRate = 20000;

  const daiToEthRate = BigNumber.from('10')
    .pow(BigNumber.from('36'))
    .div(parseEther((ethToDaiRate / 100).toString()));
  await chainlinkDAI.setLatestAnswer(daiToEthRate);

  const ethToUsdcRate = parseUnits('200', usdcDecimals);

  const usdcToEthRate = BigNumber.from('10').pow(BigNumber.from('24')).div(ethToUsdcRate);
  await chainlinkUSDC.setLatestAnswer(usdcToEthRate);

  await as.initialize();

  const external = { chainlinkDAI, dai, usdc, weth, productsV1, ybDAI, ybETH, ybUSDC };
  const nonUpgradable = { qd, productsV1, spf, coverNFT, stakingNFT };
  const instances = { tk, cl, p1, mcr: mc, lcr };

  // we upgraded them, get non-disposable instances because
  const proxies = {
    master: await ethers.getContractAt('NXMaster', master.address),
    tc: await ethers.getContractAt('TokenController', tc.address),
    gv: await ethers.getContractAt('Governance', gv.address),
    pc: await ethers.getContractAt('ProposalCategory', pc.address),
    mr: await ethers.getContractAt('MemberRoles', mr.address),
    ps: await ethers.getContractAt('LegacyPooledStaking', ps.address),
    gateway: await ethers.getContractAt('LegacyGateway', gateway.address),
    ic: await ethers.getContractAt('IndividualClaims', ic.address),
    yc: await ethers.getContractAt('YieldTokenIncidents', yt.address),
    cl: await ethers.getContractAt('CoverMigrator', cl.address),
    as: await ethers.getContractAt('Assessment', as.address),
    cover: await ethers.getContractAt('Cover', cover.address),
  };

  const nonInternal = { priceFeedOracle, swapOperator };

  this.contracts = {
    ...external,
    ...nonUpgradable,
    ...instances,
    ...proxies,
    ...nonInternal,
  };

  this.rates = {
    daiToEthRate,
    ethToDaiRate,
  };

  this.contractType = contractType;

  await enrollMember(this.contracts, members, owner);

  const product = {
    productId: 0,
    weight: 100,
    initialPrice: 1000,
    targetPrice: 1000,
  };

  const DEFAULT_PRODUCTS = [product];
  const DEFAULT_POOL_FEE = '5';

  for (let i = 0; i < 3; i++) {
    await this.contracts.cover.createStakingPool(
      stakingPoolManagers[i],
      false, // isPrivatePool,
      DEFAULT_POOL_FEE, // initialPoolFee
      DEFAULT_POOL_FEE, // maxPoolFee,
      DEFAULT_PRODUCTS,
      '', // ipfs hash
    );

    const stakingPoolAddress = await cover.stakingPool(i);
    const stakingPoolInstance = await ethers.getContractAt('StakingPool', stakingPoolAddress);

    this.contracts['stakingPool' + i] = stakingPoolInstance;
  }
  const config = {
    BUCKET_SIZE: await cover.BUCKET_SIZE(),
  };

  this.config = config;
  this.accounts = ethersAccounts;
  this.DEFAULT_PRODUCTS = DEFAULT_PRODUCTS;
}

module.exports = setup;
