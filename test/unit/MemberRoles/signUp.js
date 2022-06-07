const { expect } = require('chai');
const { ethers } = require('hardhat');
const { parseUnits } = require('ethers/lib/utils');
const {
  formatBytes32String,
  defaultAbiCoder,
  arrayify,
  hexConcat,
  hexZeroPad,
  splitSignature,
  keccak256,
} = ethers.utils;

const JOINING_FEE = parseUnits('0.002');
const MEMBERSHIP_APPROVAL = formatBytes32String('MEMBERSHIP_APPROVAL');

const approveMembership = async ({ nonce, address, kycAuthSigner }) => {
  const message = defaultAbiCoder.encode(['bytes32', 'uint256', 'address'], [MEMBERSHIP_APPROVAL, nonce, address]);
  const hash = keccak256(message);
  const signature = await kycAuthSigner.signMessage(arrayify(hash));
  const { compact: compactSignature } = splitSignature(signature);
  return hexConcat([hexZeroPad(nonce, 32), compactSignature]);
};

describe('signUp', function () {
  it('reverts when reusing the same nonce', async function () {
    const { memberRoles } = this.contracts;
    const { nonMembers, defaultSender: kycAuthSigner } = this.accounts;

    const membershipApprovalData0 = await approveMembership({
      nonce: 0,
      address: nonMembers[0].address,
      kycAuthSigner,
    });

    await memberRoles.signUp(nonMembers[0].address, arrayify(membershipApprovalData0), {
      value: JOINING_FEE,
    });
    await memberRoles.connect(nonMembers[0]).switchMembership(nonMembers[1].address);
    await expect(
      memberRoles.signUp(nonMembers[0].address, arrayify(membershipApprovalData0), {
        value: JOINING_FEE,
      }),
    ).to.be.revertedWith('MemberRoles: Signature already used');

    const membershipApprovalData1 = await approveMembership({
      nonce: 1,
      address: nonMembers[0].address,
      kycAuthSigner,
    });
    await expect(
      memberRoles.signUp(nonMembers[0].address, arrayify(membershipApprovalData1), {
        value: JOINING_FEE,
      }),
    ).not.to.be.revertedWith('MemberRoles: Signature already used');
  });

  it('reverts when using the signature of another address', async function () {
    const { memberRoles } = this.contracts;
    const { nonMembers, defaultSender: kycAuthSigner } = this.accounts;

    const membershipApprovalData0 = await approveMembership({
      nonce: 0,
      address: nonMembers[0].address,
      kycAuthSigner,
    });

    await expect(
      memberRoles.signUp(nonMembers[1].address, arrayify(membershipApprovalData0), {
        value: JOINING_FEE,
      }),
    ).to.be.revertedWith('MemberRoles: Signature is invalid');

    await expect(
      memberRoles.signUp(nonMembers[0].address, arrayify(membershipApprovalData0), {
        value: JOINING_FEE,
      }),
    ).not.to.be.revertedWith('MemberRoles: Signature is invalid');
  });

  it('reverts when trying to sign up the 0 address', async function () {
    const { memberRoles } = this.contracts;
    const { nonMembers, defaultSender: kycAuthSigner } = this.accounts;

    const membershipApprovalData0 = await approveMembership({
      nonce: 0,
      address: nonMembers[0].address,
      kycAuthSigner,
    });

    await expect(
      memberRoles.signUp('0x0000000000000000000000000000000000000000', arrayify(membershipApprovalData0), {
        value: JOINING_FEE,
      }),
    ).to.be.revertedWith('MemberRoles: Address 0 cannot be used');

    await expect(
      memberRoles.signUp(nonMembers[0].address, arrayify(membershipApprovalData0), {
        value: JOINING_FEE,
      }),
    ).not.to.be.revertedWith('MemberRoles: Address 0 cannot be used');
  });

  it('reverts when the address is already a member', async function () {
    const { memberRoles } = this.contracts;
    const { nonMembers, defaultSender: kycAuthSigner } = this.accounts;

    const membershipApprovalData0 = await approveMembership({
      nonce: 0,
      address: nonMembers[0].address,
      kycAuthSigner,
    });

    await memberRoles.signUp(nonMembers[0].address, arrayify(membershipApprovalData0), {
      value: JOINING_FEE,
    });
    await expect(
      memberRoles.signUp(nonMembers[0].address, arrayify(membershipApprovalData0), {
        value: JOINING_FEE,
      }),
    ).to.be.revertedWith('MemberRoles: This address is already a member');
  });

  it('reverts when the system is paused', async function () {
    // [todo]
  });

  it('reverts when the value sent is different than the joining fee', async function () {
    const { memberRoles } = this.contracts;
    const { nonMembers, defaultSender: kycAuthSigner } = this.accounts;

    const membershipApprovalData0 = await approveMembership({
      nonce: 0,
      address: nonMembers[0].address,
      kycAuthSigner,
    });

    await expect(
      memberRoles.signUp(nonMembers[0].address, arrayify(membershipApprovalData0), {
        value: JOINING_FEE.sub('1'),
      }),
    ).to.be.revertedWith('MemberRoles: The transaction value should equal to the joining fee');
    await expect(
      memberRoles.signUp(nonMembers[0].address, arrayify(membershipApprovalData0), {
        value: JOINING_FEE.add('1'),
      }),
    ).to.be.revertedWith('MemberRoles: The transaction value should equal to the joining fee');
    await expect(memberRoles.signUp(nonMembers[0].address, arrayify(membershipApprovalData0))).to.be.revertedWith(
      'MemberRoles: The transaction value should equal to the joining fee',
    );
    await expect(
      memberRoles.signUp(nonMembers[0].address, arrayify(membershipApprovalData0), {
        value: JOINING_FEE,
      }),
    ).not.to.be.revertedWith('MemberRoles: The transaction value should equal to the joining fee');
  });

  it('reverts when a valid signature is not provided', async function () {
    const { memberRoles } = this.contracts;
    const { nonMembers, defaultSender: kycAuthSigner } = this.accounts;

    const membershipApprovalData0 = await approveMembership({
      nonce: 0,
      address: nonMembers[0].address,
      kycAuthSigner,
    });

    await expect(
      memberRoles.signUp(
        nonMembers[0].address,
        arrayify(
          '0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        ),
        {
          value: JOINING_FEE,
        },
      ),
    ).to.be.revertedWith('ECDSA: invalid signature');
    await expect(
      memberRoles.signUp(
        nonMembers[0].address,
        arrayify(
          '0x000000000000000000000000000000000000000000000000000000000000000011111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111',
        ),
        {
          value: JOINING_FEE,
        },
      ),
    ).to.be.revertedWith('ECDSA: invalid signature');
  });

  it('reverts if the transfer of the joining fee to the pool fails', async function () {
    const { memberRoles, pool } = this.contracts;
    const { nonMembers, defaultSender: kycAuthSigner } = this.accounts;

    const membershipApprovalData0 = await approveMembership({
      nonce: 0,
      address: nonMembers[0].address,
      kycAuthSigner,
    });

    await pool.setRevertOnTransfers(true);
    await expect(
      memberRoles.signUp(nonMembers[0].address, arrayify(membershipApprovalData0), {
        value: JOINING_FEE,
      }),
    ).to.be.revertedWith('MemberRoles: The joining fee transfer to the pool failed');

    await pool.setRevertOnTransfers(false);
    await expect(
      memberRoles.signUp(nonMembers[0].address, arrayify(membershipApprovalData0), {
        value: JOINING_FEE,
      }),
    ).not.to.be.revertedWith('MemberRoles: The joining fee transfer to the pool failed');
  });

  it('whitelists the address through token controller to allow it to transfer tokens', async function () {
    const { memberRoles, tokenController } = this.contracts;
    const { nonMembers, defaultSender: kycAuthSigner } = this.accounts;

    const membershipApprovalData0 = await approveMembership({
      nonce: 0,
      address: nonMembers[0].address,
      kycAuthSigner,
    });
    const addToWhitelistLastCalledWtihBefore = await tokenController.addToWhitelistLastCalledWtih();
    expect(addToWhitelistLastCalledWtihBefore).to.be.equal('0x0000000000000000000000000000000000000000');

    await memberRoles.signUp(nonMembers[0].address, arrayify(membershipApprovalData0), {
      value: JOINING_FEE,
    });

    const addToWhitelistLastCalledWtihAfter = await tokenController.addToWhitelistLastCalledWtih();
    expect(addToWhitelistLastCalledWtihAfter).to.be.equal(nonMembers[0].address);
  });

  it('assigns the member role to the address', async function () {
    const { memberRoles } = this.contracts;
    const { nonMembers, defaultSender: kycAuthSigner } = this.accounts;

    const membershipApprovalData0 = await approveMembership({
      nonce: 0,
      address: nonMembers[0].address,
      kycAuthSigner,
    });
    const isMemberBefore = await memberRoles.isMember(nonMembers[0].address);
    expect(isMemberBefore).to.be.equal(false);

    await memberRoles.signUp(nonMembers[0].address, arrayify(membershipApprovalData0), {
      value: JOINING_FEE,
    });

    const isMemberAfter = await memberRoles.isMember(nonMembers[0].address);
    expect(isMemberAfter).to.be.equal(true);
  });
});