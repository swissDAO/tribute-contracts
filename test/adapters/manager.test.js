// Whole-script strict mode syntax
"use strict";

/**
MIT License

Copyright (c) 2020 Openlaw

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */
const { expect } = require("chai");
const {
  sha3,
  toBN,
  toWei,
  fromAscii,
  GUILD,
  ZERO_ADDRESS,
  DAI_TOKEN,
} = require("../../utils/contract-util");

const {
  deployDefaultDao,
  takeChainSnapshot,
  revertChainSnapshot,
  getAccounts,
  proposalIdGenerator,
  web3,
  Manager,
  FinancingContract,
  ERC1271Extension,
  NFTExtension,
} = require("../../utils/hardhat-test-util");

const {
  bankExtensionAclFlagsMap,
  daoAccessFlagsMap,
  entryDao,
  entryBank,
} = require("../../utils/access-control-util");

const { extensionsIdsMap } = require("../../utils/dao-ids-util");

const { SigUtilSigner } = require("../../utils/offchain-voting-util");

const signer = {
  address: "0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1",
  privKey: "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d",
};

const proposalCounter = proposalIdGenerator().generator;
const getProposalCounter = () => proposalCounter().next().value;

const generateCouponSignature = ({
  daoAddress,
  managerAddress,
  proposalId,
  proposal,
  configs,
  nonce,
  chainId,
}) => {
  const signerUtil = SigUtilSigner(signer.privKey);
  const messageData = {
    type: "manager",
    daoAddress,
    proposal,
    configs,
    proposalId,
    nonce,
  };
  const signature = signerUtil(
    messageData,
    daoAddress,
    managerAddress,
    chainId
  );

  return signature;
};

describe("Adapter - Manager", () => {
  let accounts, daoOwner;
  const chainId = 1337;

  before("deploy dao", async () => {
    accounts = await getAccounts();
    daoOwner = accounts[0];

    const { dao, adapters, extensions } = await deployDefaultDao({
      owner: daoOwner,
      managerSignerAddress: signer.address,
    });
    this.dao = dao;
    this.adapters = adapters;
    this.extensions = extensions;
    this.snapshotId = await takeChainSnapshot();
  });

  beforeEach(async () => {
    await revertChainSnapshot(this.snapshotId);
    this.snapshotId = await takeChainSnapshot();
  });

  it("should not be possible to send ETH to the adapter via receive function", async () => {
    const manager = this.adapters.manager;
    await expect(
      web3.eth.sendTransaction({
        to: manager.address,
        from: daoOwner,
        gasPrice: toBN("0"),
        value: toWei("1"),
      })
    ).to.be.revertedWith("revert");
  });

  it("should not be possible to send ETH to the adapter via fallback function", async () => {
    const manager = this.adapters.manager;
    await expect(
      web3.eth.sendTransaction({
        to: manager.address,
        from: daoOwner,
        gasPrice: toBN("0"),
        value: toWei("1"),
        data: fromAscii("should go to fallback func"),
      })
    ).to.be.revertedWith("revert");
  });

  it("should not be possible to submit a new adapter with more keys than values", async () => {
    const dao = this.dao;
    const manager = this.adapters.manager;
    const newAdapterId = sha3("bank");
    const proposalId = getProposalCounter();
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const proposal = {
      adapterOrExtensionId: newAdapterId,
      adapterOrExtensionAddr: GUILD,
      updateType: 1,
      flags: 0,
      keys: [
        "0x0000000000000000000000000000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000000000000000000000000000002",
        "0x0000000000000000000000000000000000000000000000000000000000000004",
      ], // 3 keys
      values: [], // 0 values
      extensionAddresses: [],
      extensionAclFlags: [],
    };

    const signature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs: [],
      nonce,
      proposalId,
    });

    await expect(
      manager.processSignedProposal(
        dao.address,
        proposalId,
        proposal,
        [], //configs
        nonce,
        signature
      )
    ).to.be.revertedWith("must be an equal number of config keys and values");
  });

  it("should not be possible to propose a new adapter with more values than keys", async () => {
    const dao = this.dao;
    const managing = this.adapters.managing;
    const newAdapterId = sha3("bank");
    await expect(
      managing.submitProposal(
        dao.address,
        "0x1",
        {
          adapterOrExtensionId: newAdapterId,
          adapterOrExtensionAddr: GUILD,
          updateType: 1,
          flags: 0,
          keys: [], // 0 keys
          values: [1, 2, 3], // 3 values
          extensionAddresses: [],
          extensionAclFlags: [],
        },
        [], //configs
        [], //data
        { from: daoOwner, gasPrice: toBN("0") }
      )
    ).to.be.revertedWith("must be an equal number of config keys and values");
  });

  it("should not be possible to propose a new adapter using a reserved address", async () => {
    const dao = this.dao;
    const proposalId = getProposalCounter();
    const manager = this.adapters.manager;
    const newAdapterId = sha3("bank");
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const proposal = {
      adapterOrExtensionId: newAdapterId,
      adapterOrExtensionAddr: GUILD,
      updateType: 1,
      flags: 0,
      keys: [],
      values: [],
      extensionAddresses: [],
      extensionAclFlags: [],
    };

    const signature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs: [],
      nonce,
      proposalId,
    });

    await expect(
      manager.processSignedProposal(
        dao.address,
        proposalId,
        proposal,
        [], //configs
        nonce,
        signature
      )
    ).to.be.revertedWith("address is reserved");
  });

  it("should not be possible to process proposal with proposal and signature mismatch", async () => {
    const dao = this.dao;
    const proposalId = getProposalCounter();
    const manager = this.adapters.manager;
    const adapterIdToRemove = sha3("onboarding");
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const proposal = {
      adapterOrExtensionId: adapterIdToRemove,
      adapterOrExtensionAddr: ZERO_ADDRESS,
      updateType: 1,
      flags: 0,
      keys: [],
      values: [],
      extensionAddresses: [],
      extensionAclFlags: [],
    };

    await expect(
      manager.processSignedProposal(
        dao.address,
        proposalId,
        proposal,
        [], // configs
        nonce,
        generateCouponSignature({
          daoAddress: ZERO_ADDRESS, //Invalid daoAddress
          managerAddress: manager.address,
          chainId,
          proposal,
          configs: [],
          nonce: nonce,
          proposalId,
        })
      )
    ).to.be.revertedWith("invalid sig");

    await expect(
      manager.processSignedProposal(
        dao.address,
        proposalId,
        proposal,
        [], // configs
        nonce,
        generateCouponSignature({
          daoAddress: dao.address,
          managerAddress: ZERO_ADDRESS, //Invalid managerAddress
          chainId,
          proposal,
          configs: [],
          nonce: nonce,
          proposalId,
        })
      )
    ).to.be.revertedWith("invalid sig");

    await expect(
      manager.processSignedProposal(
        dao.address,
        proposalId,
        proposal,
        [], // configs
        nonce,
        generateCouponSignature({
          daoAddress: dao.address,
          managerAddress: manager.address,
          chainId: 9000, //Invalid chainId
          proposal,
          configs: [],
          nonce: nonce,
          proposalId,
        })
      )
    ).to.be.revertedWith("invalid sig");

    await expect(
      manager.processSignedProposal(
        dao.address,
        proposalId,
        proposal,
        [], // configs
        nonce,
        generateCouponSignature({
          daoAddress: dao.address,
          managerAddress: manager.address,
          chainId,
          proposal: { ...proposal, flags: 1 }, //Invalid proposal
          configs: [],
          nonce,
          proposalId,
        })
      )
    ).to.be.revertedWith("invalid sig");

    await expect(
      manager.processSignedProposal(
        dao.address,
        proposalId,
        proposal,
        [], // configs
        nonce,
        generateCouponSignature({
          daoAddress: dao.address,
          managerAddress: manager.address,
          chainId,
          proposal,
          configs: [
            {
              key: sha3("some.numeric.config"),
              numericValue: 32,
              addressValue: ZERO_ADDRESS,
              configType: 0, //NUMERIC
            },
          ], //Invalid configs
          nonce,
          proposalId,
        })
      )
    ).to.be.revertedWith("invalid sig");

    await expect(
      manager.processSignedProposal(
        dao.address,
        proposalId,
        proposal,
        [], // configs
        nonce,
        generateCouponSignature({
          daoAddress: dao.address,
          managerAddress: manager.address,
          chainId,
          proposal,
          configs: [],
          nonce: nonce + 1, //Invalid nonce
          proposalId,
        })
      )
    ).to.be.revertedWith("invalid sig");
  });

  it("cannot replay proposal", async () => {
    const dao = this.dao;
    const proposalId = getProposalCounter();
    const adapterId = sha3("onboarding");
    const newAdapterAddress = accounts[4];
    const manager = this.adapters.manager;
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const proposal = {
      adapterOrExtensionId: adapterId,
      adapterOrExtensionAddr: newAdapterAddress,
      updateType: 1,
      flags: 0,
      keys: [],
      values: [],
      extensionAddresses: [],
      extensionAclFlags: [],
    };

    const signature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs: [],
      nonce,
      proposalId,
    });

    // Update adapter.
    await manager.processSignedProposal(
      dao.address,
      proposalId,
      proposal,
      [], //configs
      nonce,
      signature
    );

    // Try to replay.
    await expect(
      manager.processSignedProposal(
        dao.address,
        proposalId,
        proposal,
        [], //configs
        nonce,
        signature
      )
    ).to.be.revertedWith("coupon already redeemed");
  });

  it("should be possible to remove an adapter if 0x0 is used as the adapter address", async () => {
    const dao = this.dao;
    const proposalId = getProposalCounter();
    const manager = this.adapters.manager;
    const adapterIdToRemove = sha3("onboarding");
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const proposal = {
      adapterOrExtensionId: adapterIdToRemove,
      adapterOrExtensionAddr: ZERO_ADDRESS,
      updateType: 1,
      flags: 0,
      keys: [],
      values: [],
      extensionAddresses: [],
      extensionAclFlags: [],
    };
    const signature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs: [],
      nonce,
      proposalId,
    });

    //Proposal to remove the Onboarding adapter
    await manager.processSignedProposal(
      dao.address,
      proposalId,
      proposal,
      [], // configs
      nonce,
      signature
    );

    //Check if the adapter was removed from the Registry
    await expect(dao.getAdapterAddress(adapterIdToRemove)).to.be.revertedWith(
      "adapter not found"
    );
  });

  it("should not be possible to reuse a proposal id", async () => {
    const dao = this.dao;
    const proposalId = getProposalCounter();
    const manager = this.adapters.manager;
    const adapterId = sha3("onboarding");
    const newAdapterAddress = accounts[4];
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const proposal = {
      adapterOrExtensionId: adapterId,
      adapterOrExtensionAddr: newAdapterAddress,
      updateType: 1,
      flags: 0,
      keys: [],
      values: [],
      extensionAddresses: [],
      extensionAclFlags: [],
    };
    const signature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs: [],
      nonce,
      proposalId,
    });

    await manager.processSignedProposal(
      dao.address,
      proposalId,
      proposal,
      [], // configs
      nonce,
      signature
    );

    const signature2 = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs: [],
      nonce: nonce + 1,
      proposalId,
    });

    await expect(
      manager.processSignedProposal(
        dao.address,
        proposalId,
        proposal,
        [], // configs
        nonce + 1,
        signature2
      )
    ).to.be.revertedWith("proposalId must be unique");
  });

  it("should be possible to replace the manager adapter and perform DAO updates", async () => {
    const dao = this.dao;
    const proposalId = getProposalCounter();
    const manager = this.adapters.manager;
    const newManager = await Manager.new();
    const newManagerId = sha3("manager");
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const { flags } = entryDao(newManagerId, newManager.address, {
      dao: [
        daoAccessFlagsMap.SUBMIT_PROPOSAL,
        daoAccessFlagsMap.REPLACE_ADAPTER,
      ],
    });
    const proposal = {
      adapterOrExtensionId: newManagerId,
      adapterOrExtensionAddr: newManager.address,
      updateType: 1,
      flags,
      keys: [],
      values: [],
      extensionAddresses: [],
      extensionAclFlags: [],
    };
    const signature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs: [],
      nonce,
      proposalId,
    });

    await manager.processSignedProposal(
      dao.address,
      proposalId,
      proposal,
      [], //configs
      nonce,
      signature
    );

    //Check if the new adapter was added to the Registry
    const newAddress = await dao.getAdapterAddress(newManagerId);
    expect(newAddress).equal(newManager.address);

    // Lets try to remove the financing adapter using the new
    // managing adapter to test its permission flags
    const newProposalId = getProposalCounter();
    const financingAdapterId = sha3("financing");
    const newProposal = {
      adapterOrExtensionId: financingAdapterId,
      adapterOrExtensionAddr: ZERO_ADDRESS,
      updateType: 1,
      flags,
      keys: [],
      values: [],
      extensionAddresses: [],
      extensionAclFlags: [],
    };
    const newSignature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: newManager.address,
      chainId,
      proposal: newProposal,
      configs: [],
      nonce: nonce + 1,
      proposalId: newProposalId,
    });

    await newManager.processSignedProposal(
      dao.address,
      newProposalId,
      newProposal,
      [], //configs
      nonce + 1,
      newSignature
    );

    await expect(dao.getAdapterAddress(financingAdapterId)).to.be.revertedWith(
      "adapter not found"
    );
  });

  it("should not be possible to perform DAO updates if the manager adapter was replaced without the proper permissions", async () => {
    const dao = this.dao;
    const proposalId = getProposalCounter();
    const manager = this.adapters.manager;
    const newManager = await Manager.new();
    const newManagerId = sha3("manager");
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const proposal = {
      adapterOrExtensionId: newManagerId,
      adapterOrExtensionAddr: newManager.address,
      updateType: 1,
      flags: entryDao(newManagerId, newManager.address, {
        dao: [], // no permissions were set
        extensions: {}, // no permissions were set
      }).flags,
      keys: [],
      values: [],
      extensionAddresses: [],
      extensionAclFlags: [],
    };
    const signature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs: [],
      nonce,
      proposalId,
    });
    await manager.processSignedProposal(
      dao.address,
      proposalId,
      proposal,
      [], //configs
      nonce,
      signature
    );

    // Lets try to remove the financing adapter using the new
    // managing adapter to test its permission flags
    const newProposalId = getProposalCounter();
    const financingAdapterId = sha3("financing");
    const newProposal = {
      adapterOrExtensionId: financingAdapterId,
      adapterOrExtensionAddr: ZERO_ADDRESS,
      updateType: 1,
      flags: 0,
      keys: [],
      values: [],
      extensionAddresses: [],
      extensionAclFlags: [],
    };
    const newSignature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: newManager.address,
      chainId,
      proposal: newProposal,
      configs: [],
      nonce: nonce + 1,
      proposalId: newProposalId,
    });

    await expect(
      newManager.processSignedProposal(
        dao.address,
        newProposalId,
        newProposal,
        [], //configs
        nonce + 1,
        newSignature
      )
    ).to.be.revertedWith("accessDenied");
  });

  it("should not fail if the adapter id used for removal is not valid", async () => {
    const dao = this.dao;
    const proposalId = getProposalCounter();
    const newAdapterId = sha3("invalid-id");
    const manager = this.adapters.manager;
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const proposal = {
      adapterOrExtensionId: newAdapterId,
      adapterOrExtensionAddr: ZERO_ADDRESS, // 0 address to indicate a removal operation
      updateType: 1,
      flags: 0,
      keys: [],
      values: [],
      extensionAddresses: [],
      extensionAclFlags: [],
    };
    const signature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs: [],
      nonce,
      proposalId,
    });

    await manager.processSignedProposal(
      dao.address,
      proposalId,
      proposal,
      [], //configs
      nonce,
      signature
    );
  });

  it("should not be possible to add a new adapter using an address that is already registered", async () => {
    const dao = this.dao;
    const proposalId = getProposalCounter();
    const newAdapterId = sha3("invalid-id");
    const manager = this.adapters.manager;
    const voting = this.adapters.voting;
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const proposal = {
      adapterOrExtensionId: newAdapterId,
      adapterOrExtensionAddr: voting.address, // using the voting.address as the new financing adapter address
      updateType: 1,
      flags: 0,
      keys: [],
      values: [],
      extensionAddresses: [],
      extensionAclFlags: [],
    };
    const signature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs: [],
      nonce,
      proposalId,
    });

    await expect(
      manager.processSignedProposal(
        dao.address,
        proposalId,
        proposal,
        [], //configs
        nonce,
        signature
      )
    ).to.be.revertedWith("adapterAddress already in use");
  });

  it("should be possible to add a new adapter and set the acl flags for some extension", async () => {
    const dao = this.dao;
    const proposalId = getProposalCounter();
    const manager = this.adapters.manager;
    const financing = await FinancingContract.new();
    const bankExt = this.extensions.bankExt;
    const newAdapterId = sha3("testFinancing");
    const newAdapterAddress = financing.address;
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const proposal = {
      adapterOrExtensionId: newAdapterId,
      adapterOrExtensionAddr: newAdapterAddress,
      updateType: 1,
      flags: 0,
      keys: [],
      values: [],
      // Set the extension address which will be accessed by the new adapter
      extensionAddresses: [bankExt.address],
      // Set the acl flags so the new adapter can access the bank extension
      extensionAclFlags: [
        entryBank(financing.address, {
          extensions: {
            [extensionsIdsMap.BANK_EXT]: [
              bankExtensionAclFlagsMap.ADD_TO_BALANCE,
              bankExtensionAclFlagsMap.SUB_FROM_BALANCE,
              bankExtensionAclFlagsMap.INTERNAL_TRANSFER,
            ],
          },
        }).flags,
      ],
    };
    const signature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs: [],
      nonce,
      proposalId,
    });

    await manager.processSignedProposal(
      dao.address,
      proposalId,
      proposal,
      [], //configs
      nonce,
      signature
    );

    // At this point the adapter should be able access the Bank Extension
    // We check that by verifying if the ACL flag in the DAO matches the one
    // submitted in the proposal.

    /**
     * Bank flags
     * 0: ADD_TO_BALANCE
     * 1: SUB_FROM_BALANCE
     * 2: INTERNAL_TRANSFER
     * 3: WITHDRAW
     * 4: REGISTER_NEW_TOKEN
     * 5: REGISTER_NEW_INTERNAL_TOKEN
     * 6: UPDATE_TOKEN
     */
    expect(await dao.getAdapterAddress(newAdapterId)).equal(newAdapterAddress);
    expect(
      await dao.hasAdapterAccessToExtension(
        newAdapterAddress,
        bankExt.address,
        0 //ADD_TO_BALANCE
      )
    ).equal(true);
    expect(
      await dao.hasAdapterAccessToExtension(
        newAdapterAddress,
        bankExt.address,
        1 // SUB_FROM_BALANCE
      )
    ).equal(true);
    expect(
      await dao.hasAdapterAccessToExtension(
        newAdapterAddress,
        bankExt.address,
        2 // INTERNAL_TRANSFER
      )
    ).equal(true);

    expect(
      await dao.hasAdapterAccessToExtension(
        newAdapterAddress,
        bankExt.address,
        3 // WITHDRAW
      )
    ).equal(false);

    expect(
      await dao.hasAdapterAccessToExtension(
        newAdapterAddress,
        bankExt.address,
        4 // REGISTER_NEW_TOKEN
      )
    ).equal(false);

    expect(
      await dao.hasAdapterAccessToExtension(
        newAdapterAddress,
        bankExt.address,
        5 // REGISTER_NEW_INTERNAL_TOKEN
      )
    ).equal(false);

    expect(
      await dao.hasAdapterAccessToExtension(
        newAdapterAddress,
        bankExt.address,
        6 // UPDATE_TOKEN
      )
    ).equal(false);
  });

  it("should be possible to add a new adapter with DAO configs", async () => {
    const dao = this.dao;
    const proposalId = getProposalCounter();
    const manager = this.adapters.manager;
    const voting = this.adapters.voting;
    const financing = await FinancingContract.new();
    const bankExt = this.extensions.bankExt;
    const newAdapterId = sha3("testFinancing");
    const newAdapterAddress = financing.address;
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const proposal = {
      adapterOrExtensionId: newAdapterId,
      adapterOrExtensionAddr: newAdapterAddress,
      updateType: 1,
      flags: 0,
      keys: [],
      values: [],
      // Set the extension address which will be accessed by the new adapter
      extensionAddresses: [bankExt.address],
      // Set the acl flags so the new adapter can access the bank extension
      extensionAclFlags: [
        entryBank(financing, {
          ADD_TO_BALANCE: true,
          SUB_FROM_BALANCE: true,
          INTERNAL_TRANSFER: true,
        }).flags,
      ],
    };
    const configs = [
      {
        key: sha3("some.numeric.config"),
        numericValue: 32,
        addressValue: ZERO_ADDRESS,
        configType: 0, //NUMERIC
      },
      {
        key: sha3("some.address.config"),
        numericValue: 0,
        addressValue: DAI_TOKEN,
        configType: 1, //ADDRESS
      },
    ];
    const signature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs,
      nonce,
      proposalId,
    });

    await manager.processSignedProposal(
      dao.address,
      proposalId,
      proposal,
      configs,
      nonce,
      signature
    );

    expect(await dao.getAdapterAddress(newAdapterId)).equal(newAdapterAddress);
    const numericConfig = await dao.getConfiguration(
      sha3("some.numeric.config")
    );
    expect(numericConfig.toString()).equal("32");
    const addressConfig = await dao.getAddressConfiguration(
      sha3("some.address.config")
    );
    expect(addressConfig.toLowerCase()).equal(DAI_TOKEN);
  });

  it("should be possible to add a new extension", async () => {
    const dao = this.dao;
    const proposalId = getProposalCounter();
    const manager = this.adapters.manager;
    const erc1171Ext = await ERC1271Extension.new();
    const newExtensionId = sha3("testNewExtension");
    const newExtensionAddr = erc1171Ext.address;
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const proposal = {
      adapterOrExtensionId: newExtensionId,
      adapterOrExtensionAddr: newExtensionAddr,
      updateType: 2, // 1 = Adapter, 2 = Extension
      flags: 0,
      keys: [],
      values: [],
      // Set the extension address which will be accessed by the new adapter
      extensionAddresses: [],
      // Set the acl flags so the new adapter can access the bank extension
      extensionAclFlags: [],
    };
    const signature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs: [],
      nonce,
      proposalId,
    });

    await manager.processSignedProposal(
      dao.address,
      proposalId,
      proposal,
      [], //configs
      nonce,
      signature
    );

    expect(await dao.getExtensionAddress(newExtensionId)).equal(
      newExtensionAddr
    );
  });

  it("should be possible to add a new extension with DAO configs", async () => {
    const dao = this.dao;
    const proposalId = getProposalCounter();
    const manager = this.adapters.manager;
    const nftExt = await NFTExtension.new();
    const newExtensionId = sha3("testNewExtension");
    const newExtensionAddr = nftExt.address;
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const proposal = {
      adapterOrExtensionId: newExtensionId,
      adapterOrExtensionAddr: newExtensionAddr,
      updateType: 2, // 1 = Adapter, 2 = Extension
      flags: 0,
      keys: [],
      values: [],
      // Set the extension address which will be accessed by the new adapter
      extensionAddresses: [],
      // Set the acl flags so the new adapter can access the bank extension
      extensionAclFlags: [],
    };
    const configs = [
      {
        key: sha3("some.numeric.config"),
        numericValue: 32,
        addressValue: ZERO_ADDRESS,
        configType: 0, //NUMERIC
      },
      {
        key: sha3("some.address.config"),
        numericValue: 0,
        addressValue: DAI_TOKEN,
        configType: 1, //ADDRESS
      },
    ];
    const signature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs,
      nonce,
      proposalId,
    });

    await manager.processSignedProposal(
      dao.address,
      proposalId,
      proposal,
      configs,
      nonce,
      signature
    );

    expect(await dao.getExtensionAddress(newExtensionId)).equal(
      newExtensionAddr
    );
    const numericConfig = await dao.getConfiguration(
      sha3("some.numeric.config")
    );
    expect(numericConfig.toString()).equal("32");
    const addressConfig = await dao.getAddressConfiguration(
      sha3("some.address.config")
    );
    expect(addressConfig.toLowerCase()).equal(DAI_TOKEN);
  });

  it("should be possible to remove an extension", async () => {
    const dao = this.dao;
    const proposalId = getProposalCounter();
    const removeExtensionId = sha3("bank");
    const manager = this.adapters.manager;
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const proposal = {
      adapterOrExtensionId: removeExtensionId,
      adapterOrExtensionAddr: ZERO_ADDRESS,
      updateType: 2, // 1 = Adapter, 2 = Extension
      flags: 0,
      keys: [],
      values: [],
      extensionAddresses: [],
      extensionAclFlags: [],
    };
    const signature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs: [],
      nonce,
      proposalId,
    });

    await manager.processSignedProposal(
      dao.address,
      proposalId,
      proposal,
      [], //configs
      nonce,
      signature
    );

    await expect(dao.getExtensionAddress(removeExtensionId)).to.be.revertedWith(
      "extension not found"
    );
  });

  it("should revert if UpdateType is unknown", async () => {
    const dao = this.dao;
    const proposalId = getProposalCounter();
    const removeExtensionId = sha3("bank");
    const manager = this.adapters.manager;
    const nonce = (await manager.nonces(dao.address)).toNumber() + 1;
    const proposal = {
      adapterOrExtensionId: removeExtensionId,
      adapterOrExtensionAddr: ZERO_ADDRESS,
      updateType: 0, //0 = Unknown 1 = Adapter, 2 = Extension
      flags: 0,
      keys: [],
      values: [],
      extensionAddresses: [],
      extensionAclFlags: [],
    };
    const signature = generateCouponSignature({
      daoAddress: dao.address,
      managerAddress: manager.address,
      chainId,
      proposal,
      configs: [],
      nonce,
      proposalId,
    });

    await expect(
      manager.processSignedProposal(
        dao.address,
        proposalId,
        proposal,
        [], //configs
        nonce,
        signature
      )
    ).to.be.revertedWith("unknown update type");
  });
});