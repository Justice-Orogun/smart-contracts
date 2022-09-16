const { web3, network } = require('hardhat');
const { ether } = require('@openzeppelin/test-helpers');
const { MAX_UINT256 } = require('@openzeppelin/test-helpers').constants;
const { toBN } = web3.utils;
const { parseUnits } = require('ethers/lib/utils');
const { signMembershipApproval } = require('../utils').membership;

const JOINING_FEE = parseUnits('0.002');

async function enrollMember({ mr, tk, tc }, members, kycAuthSigner, options = {}) {
  const { initialTokens = ether('2500') } = options;

  for (const member of members) {
    const membershipApprovalData0 = await signMembershipApproval({
      nonce: 0,
      address: member.address,
      kycAuthSigner,
      chainId: network.config.chainId,
    });

    await mr.join(member.address, 0, membershipApprovalData0, {
      value: JOINING_FEE,
    });

    await tk.approve(tc.address, MAX_UINT256, { from: member.address });
    await tk.transfer(member.address, toBN(initialTokens));
  }
}

// TODO: remove eslint disable once the function is implemented
// eslint-disable-next-line no-unused-vars
async function enrollClaimAssessor({ tc: _unusedTc }, assessors, options = {}) {
  // eslint-disable-next-line no-unused-vars
  const { lockTokens = ether('2000'), validity = 180 * 24 * 60 * 60 } = options;

  // eslint-disable-next-line no-unused-vars
  for (const member of assessors) {
    // [todo] All assessors will be unlocked
    // await tc.lockClaimAssessmentTokens(toBN(lockTokens), toBN(validity), { from: member });
  }
}

module.exports = {
  enrollMember,
  enrollClaimAssessor,
};
