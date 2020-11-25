/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface ClaimsRewardContract
  extends Truffle.Contract<ClaimsRewardInstance> {
  "new"(
    masterAddress: string,
    _daiAddress: string,
    meta?: Truffle.TransactionDetails
  ): Promise<ClaimsRewardInstance>;
}

type AllEvents = never;

export interface ClaimsRewardInstance extends Truffle.ContractInstance {
  DAI(txDetails?: Truffle.TransactionDetails): Promise<string>;

  ETH(txDetails?: Truffle.TransactionDetails): Promise<string>;

  _claimStakeCommission: {
    (
      _records: number | BN | string,
      _user: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _records: number | BN | string,
      _user: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _records: number | BN | string,
      _user: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _records: number | BN | string,
      _user: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  changeClaimStatus: {
    (
      claimid: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      claimid: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      claimid: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      claimid: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  changeDependentContractAddress: {
    (txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
    estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
  };

  changeMasterAddress: {
    (_masterAddress: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _masterAddress: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _masterAddress: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _masterAddress: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  claimAllPendingReward: {
    (
      records: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      records: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      records: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      records: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  fixStuckStatuses: {
    (txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
    estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
  };

  getAllPendingRewardOfUser(
    _add: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  getCurrencyAssetAddress(
    currency: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<string>;

  getRewardAndClaimedStatus(
    check: number | BN | string,
    claimId: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<[BN, boolean]>;

  getRewardToBeDistributedByUser(
    _add: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  getRewardToBeGiven(
    check: number | BN | string,
    voteid: number | BN | string,
    flag: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<[BN, boolean, BN, BN]>;

  ms(txDetails?: Truffle.TransactionDetails): Promise<string>;

  nxMasterAddress(txDetails?: Truffle.TransactionDetails): Promise<string>;

  upgrade: {
    (_newAdd: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _newAdd: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _newAdd: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _newAdd: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
    DAI(txDetails?: Truffle.TransactionDetails): Promise<string>;

    ETH(txDetails?: Truffle.TransactionDetails): Promise<string>;

    _claimStakeCommission: {
      (
        _records: number | BN | string,
        _user: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _records: number | BN | string,
        _user: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _records: number | BN | string,
        _user: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _records: number | BN | string,
        _user: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    changeClaimStatus: {
      (
        claimid: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        claimid: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        claimid: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        claimid: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    changeDependentContractAddress: {
      (txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(txDetails?: Truffle.TransactionDetails): Promise<void>;
      sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
      estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
    };

    changeMasterAddress: {
      (_masterAddress: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _masterAddress: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _masterAddress: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _masterAddress: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    claimAllPendingReward: {
      (
        records: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        records: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        records: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        records: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    fixStuckStatuses: {
      (txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(txDetails?: Truffle.TransactionDetails): Promise<void>;
      sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
      estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
    };

    getAllPendingRewardOfUser(
      _add: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    getCurrencyAssetAddress(
      currency: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;

    getRewardAndClaimedStatus(
      check: number | BN | string,
      claimId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<[BN, boolean]>;

    getRewardToBeDistributedByUser(
      _add: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    getRewardToBeGiven(
      check: number | BN | string,
      voteid: number | BN | string,
      flag: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<[BN, boolean, BN, BN]>;

    ms(txDetails?: Truffle.TransactionDetails): Promise<string>;

    nxMasterAddress(txDetails?: Truffle.TransactionDetails): Promise<string>;

    upgrade: {
      (_newAdd: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _newAdd: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _newAdd: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _newAdd: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };
  };

  getPastEvents(event: string): Promise<EventData[]>;
  getPastEvents(
    event: string,
    options: PastEventOptions,
    callback: (error: Error, event: EventData) => void
  ): Promise<EventData[]>;
  getPastEvents(event: string, options: PastEventOptions): Promise<EventData[]>;
  getPastEvents(
    event: string,
    callback: (error: Error, event: EventData) => void
  ): Promise<EventData[]>;
}
