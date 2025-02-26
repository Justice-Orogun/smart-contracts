const { ethers } = require('hardhat');
const { BigNumber } = ethers;
const { parseEther } = ethers.utils;
const { AddressZero, WeiPerEther } = ethers.constants;

const { Role } = require('../utils').constants;
const { getAccounts } = require('../../utils/accounts');
const { toBytes2 } = require('../utils').helpers;

async function setup() {
  // rewrite above artifact imports using ethers.js
  const MasterMock = await ethers.getContractFactory('MasterMock');
  const TokenController = await ethers.getContractFactory('TokenControllerMock');
  const TokenMock = await ethers.getContractFactory('NXMTokenMock');
  const Pool = await ethers.getContractFactory('Pool');
  const MCR = await ethers.getContractFactory('P1MockMCR');
  const ERC20Mock = await ethers.getContractFactory('ERC20Mock');
  const ERC20BlacklistableMock = await ethers.getContractFactory('ERC20BlacklistableMock');
  const PriceFeedOracle = await ethers.getContractFactory('PriceFeedOracle');
  const ChainlinkAggregatorMock = await ethers.getContractFactory('ChainlinkAggregatorMock');
  const P1MockSwapOperator = await ethers.getContractFactory('P1MockSwapOperator');
  const MemberRolesMock = await ethers.getContractFactory('MemberRolesMock');

  const master = await MasterMock.deploy();
  const dai = await ERC20Mock.deploy();
  const stETH = await ERC20BlacklistableMock.deploy();
  const enzymeVault = await ERC20Mock.deploy();
  const otherAsset = await ERC20Mock.deploy();
  const memberRoles = await MemberRolesMock.deploy();

  const ethToDaiRate = parseEther('394.59');
  const daiToEthRate = BigNumber.from(10).pow(36).div(ethToDaiRate);

  const chainlinkDAI = await ChainlinkAggregatorMock.deploy();
  await chainlinkDAI.setLatestAnswer(daiToEthRate);

  const chainlinkSteth = await ChainlinkAggregatorMock.deploy();
  await chainlinkSteth.setLatestAnswer(WeiPerEther);

  const chainlinkEnzymeVault = await ChainlinkAggregatorMock.deploy();
  await chainlinkEnzymeVault.setLatestAnswer(WeiPerEther);

  const chainlinkOtherAsset = await ChainlinkAggregatorMock.deploy();
  await chainlinkOtherAsset.setLatestAnswer(WeiPerEther);

  const priceFeedOracle = await PriceFeedOracle.deploy(
    [dai, stETH, enzymeVault, otherAsset].map(c => c.address),
    [chainlinkDAI, chainlinkSteth, chainlinkEnzymeVault, chainlinkOtherAsset].map(c => c.address),
    [18, 18, 18, 18],
  );

  const swapOperator = await P1MockSwapOperator.deploy();
  const accounts = await getAccounts();

  const mcr = await MCR.deploy();
  const tokenController = await TokenController.deploy();

  const token = await TokenMock.deploy();
  await token.setOperator(tokenController.address);
  await token.mint(accounts.defaultSender.address, parseEther('10000'));

  const pool = await Pool.deploy(
    AddressZero, // master: it is changed a few lines below
    priceFeedOracle.address,
    swapOperator.address,
    dai.address,
    stETH.address,
    enzymeVault.address,
    token.address,
  );

  // set contract addresses
  await master.setTokenAddress(token.address);
  await master.setLatestAddress(toBytes2('P1'), pool.address);
  await master.setLatestAddress(toBytes2('MC'), mcr.address);
  await master.setLatestAddress(toBytes2('TC'), tokenController.address);
  await master.setLatestAddress(toBytes2('MR'), memberRoles.address);

  const contractsToUpdate = [mcr, pool, tokenController];

  for (const contract of contractsToUpdate) {
    await contract.changeMasterAddress(master.address);
    await contract.changeDependentContractAddress();
  }

  // required to be able to mint
  await master.enrollInternal(pool.address);

  for (const member of accounts.members) {
    await master.enrollMember(member.address, Role.Member);
    await memberRoles.setRole(member.address, Role.Member);
  }

  for (const advisoryBoardMember of accounts.advisoryBoardMembers) {
    await master.enrollMember(advisoryBoardMember.address, Role.AdvisoryBoard);
    await memberRoles.setRole(advisoryBoardMember.address, Role.AdvisoryBoard);
  }

  for (const internalContract of accounts.internalContracts) {
    await master.enrollInternal(internalContract.address);
  }

  // there is only one in reality, but it doesn't matter
  for (const governanceContract of accounts.governanceContracts) {
    await master.enrollGovernance(governanceContract.address);
  }

  this.accounts = accounts;
  this.master = master;
  this.token = token;
  this.pool = pool;
  this.mcr = mcr;
  this.tokenController = tokenController;
  this.memberRoles = memberRoles;
  this.swapOperator = swapOperator;
  this.priceFeedOracle = priceFeedOracle;

  // tokens
  this.dai = dai;
  this.stETH = stETH;
  this.enzymeVault = enzymeVault;
  this.otherAsset = otherAsset;

  // oracles
  this.chainlinkDAI = chainlinkDAI;
  this.chainlinkSteth = chainlinkSteth;
  this.chainlinkEnzymeVault = chainlinkEnzymeVault;
}

module.exports = setup;
