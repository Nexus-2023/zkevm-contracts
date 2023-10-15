const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');
const MerkleTreeBridge = require('@0xpolygonhermez/zkevm-commonjs').MTBridge;
const {
    verifyMerkleProof,
    getLeafValue,
} = require('@0xpolygonhermez/zkevm-commonjs').mtBridgeUtils;

function calculateGlobalExitRoot(mainnetExitRoot, rollupExitRoot) {
    return ethers.utils.solidityKeccak256(['bytes32', 'bytes32'], [mainnetExitRoot, rollupExitRoot]);
}

describe('PolygonZkEVMBridge Contract', () => {
    let deployer;
    let rollup;
    let acc1;

    let polygonZkEVMGlobalExitRoot;
    let polygonZkEVMBridgeContract;
    let tokenContract;

    const tokenName = 'Matic Token';
    const tokenSymbol = 'MATIC';
    const decimals = 18;
    const tokenInitialBalance = ethers.utils.parseEther('20000000');
    const metadataToken = ethers.utils.defaultAbiCoder.encode(
        ['string', 'string', 'uint8'],
        [tokenName, tokenSymbol, decimals],
    );

    const networkIDMainnet = 0;
    const networkIDRollup = 1;

    const LEAF_TYPE_ASSET = 0;
    const LEAF_TYPE_MESSAGE = 1;

    const polygonZkEVMAddress = ethers.constants.AddressZero;

    beforeEach('Deploy contracts', async () => {
        // load signers
        [deployer, rollup, acc1] = await ethers.getSigners();

        // deploy PolygonZkEVMBridge
        const polygonZkEVMBridgeFactory = await ethers.getContractFactory('PolygonZkEVMBridge');
        polygonZkEVMBridgeContract = await upgrades.deployProxy(polygonZkEVMBridgeFactory, [], { initializer: false });

        // deploy global exit root manager
        const PolygonZkEVMGlobalExitRootFactory = await ethers.getContractFactory('PolygonZkEVMGlobalExitRoot');
        polygonZkEVMGlobalExitRoot = await PolygonZkEVMGlobalExitRootFactory.deploy(rollup.address, polygonZkEVMBridgeContract.address);

        await polygonZkEVMBridgeContract.initialize(networkIDMainnet, polygonZkEVMGlobalExitRoot.address, polygonZkEVMAddress);

        // deploy token
        const maticTokenFactory = await ethers.getContractFactory('ERC20PermitMock');
        tokenContract = await maticTokenFactory.deploy(
            tokenName,
            tokenSymbol,
            deployer.address,
            tokenInitialBalance,
        );
        await tokenContract.deployed();
    });

    it('should check the constructor parameters', async () => {
        expect(await polygonZkEVMBridgeContract.globalExitRootManager()).to.be.equal(polygonZkEVMGlobalExitRoot.address);
        expect(await polygonZkEVMBridgeContract.networkID()).to.be.equal(networkIDMainnet);
        expect(await polygonZkEVMBridgeContract.polygonZkEVMaddress()).to.be.equal(polygonZkEVMAddress);
    });

    it('should PolygonZkEVM bridge asset and verify merkle proof', async () => {
        const depositCount = await polygonZkEVMBridgeContract.depositCount();
        const originNetwork = networkIDMainnet;
        const tokenAddress = tokenContract.address;
        const amount = ethers.utils.parseEther('10');
        const destinationNetwork = networkIDRollup;
        const destinationAddress = deployer.address;

        const metadata = metadataToken;
        const metadataHash = ethers.utils.solidityKeccak256(['bytes'], [metadata]);

        const balanceDeployer = await tokenContract.balanceOf(deployer.address);
        const balanceBridge = await tokenContract.balanceOf(polygonZkEVMBridgeContract.address);

        const rollupExitRoot = await polygonZkEVMGlobalExitRoot.lastRollupExitRoot();

        // create a new deposit
        await expect(tokenContract.approve(polygonZkEVMBridgeContract.address, amount))
            .to.emit(tokenContract, 'Approval')
            .withArgs(deployer.address, polygonZkEVMBridgeContract.address, amount);

        // pre compute root merkle tree in Js
        const height = 32;
        const merkleTree = new MerkleTreeBridge(height);
        const leafValue = getLeafValue(
            LEAF_TYPE_ASSET,
            originNetwork,
            tokenAddress,
            destinationNetwork,
            destinationAddress,
            amount,
            metadataHash,
        );
        merkleTree.add(leafValue);
        const rootJSMainnet = merkleTree.getRoot();

        // check requires
        await expect(polygonZkEVMBridgeContract.bridgeAsset(
            2,
            destinationAddress,
            amount,
            tokenAddress,
            true,
            '0x',
        )).to.be.revertedWith('DestinationNetworkInvalid');

        await expect(polygonZkEVMBridgeContract.bridgeAsset(
            destinationNetwork,
            destinationAddress,
            amount,
            tokenAddress,
            true,
            '0x',
            { value: 1 },
        )).to.be.revertedWith('MsgValueNotZero');

        await expect(polygonZkEVMBridgeContract.bridgeAsset(destinationNetwork, destinationAddress, amount, tokenAddress, true, '0x'))
            .to.emit(polygonZkEVMBridgeContract, 'BridgeEvent')
            .withArgs(LEAF_TYPE_ASSET, originNetwork, tokenAddress, destinationNetwork, destinationAddress, amount, metadata, depositCount)
            .to.emit(polygonZkEVMGlobalExitRoot, 'UpdateGlobalExitRoot')
            .withArgs(rootJSMainnet, rollupExitRoot);

        expect(await tokenContract.balanceOf(deployer.address)).to.be.equal(balanceDeployer.sub(amount));
        expect(await tokenContract.balanceOf(polygonZkEVMBridgeContract.address)).to.be.equal(balanceBridge.add(amount));
        expect(await polygonZkEVMBridgeContract.lastUpdatedDepositCount()).to.be.equal(1);

        // check merkle root with SC
        const rootSCMainnet = await polygonZkEVMBridgeContract.getDepositRoot();
        expect(rootSCMainnet).to.be.equal(rootJSMainnet);

        // check merkle proof
        const proof = merkleTree.getProofTreeByIndex(0);
        const index = 0;

        // verify merkle proof
        expect(verifyMerkleProof(leafValue, proof, index, rootSCMainnet)).to.be.equal(true);
        expect(await polygonZkEVMBridgeContract.verifyMerkleProof(
            leafValue,
            proof,
            index,
            rootSCMainnet,
        )).to.be.equal(true);

        const computedGlobalExitRoot = calculateGlobalExitRoot(rootJSMainnet, rollupExitRoot);
        expect(computedGlobalExitRoot).to.be.equal(await polygonZkEVMGlobalExitRoot.getLastGlobalExitRoot());
    });

    it('should PolygonZkEVMBridge message and verify merkle proof', async () => {
        const depositCount = await polygonZkEVMBridgeContract.depositCount();
        const originNetwork = networkIDMainnet;
        const originAddress = deployer.address;
        const amount = ethers.utils.parseEther('10');
        const destinationNetwork = networkIDRollup;
        const destinationAddress = deployer.address;

        const metadata = metadataToken;
        const metadataHash = ethers.utils.solidityKeccak256(['bytes'], [metadata]);
        const rollupExitRoot = await polygonZkEVMGlobalExitRoot.lastRollupExitRoot();

        // pre compute root merkle tree in Js
        const height = 32;
        const merkleTree = new MerkleTreeBridge(height);
        const leafValue = getLeafValue(
            LEAF_TYPE_MESSAGE,
            originNetwork,
            originAddress,
            destinationNetwork,
            destinationAddress,
            amount,
            metadataHash,
        );
        merkleTree.add(leafValue);
        const rootJSMainnet = merkleTree.getRoot();

        await expect(polygonZkEVMBridgeContract.bridgeMessage(destinationNetwork, destinationAddress, true, metadata, { value: amount }))
            .to.emit(polygonZkEVMBridgeContract, 'BridgeEvent')
            .withArgs(
                LEAF_TYPE_MESSAGE,
                originNetwork,
                originAddress,
                destinationNetwork,
                destinationAddress,
                amount,
                metadata,
                depositCount,
            );

        // check merkle root with SC
        const rootSCMainnet = await polygonZkEVMBridgeContract.getDepositRoot();
        expect(rootSCMainnet).to.be.equal(rootJSMainnet);

        // check merkle proof
        const proof = merkleTree.getProofTreeByIndex(0);
        const index = 0;

        // verify merkle proof
        expect(verifyMerkleProof(leafValue, proof, index, rootSCMainnet)).to.be.equal(true);
        expect(await polygonZkEVMBridgeContract.verifyMerkleProof(
            leafValue,
            proof,
            index,
            rootSCMainnet,
        )).to.be.equal(true);

        const computedGlobalExitRoot = calculateGlobalExitRoot(rootJSMainnet, rollupExitRoot);
        expect(computedGlobalExitRoot).to.be.equal(await polygonZkEVMGlobalExitRoot.getLastGlobalExitRoot());
    });

    it('should PolygonZkEVM bridge asset and message to check global exit root updates', async () => {
        const depositCount = await polygonZkEVMBridgeContract.depositCount();
        const originNetwork = networkIDMainnet;
        const tokenAddress = tokenContract.address;
        const amount = ethers.utils.parseEther('10');
        const destinationNetwork = networkIDRollup;
        const destinationAddress = deployer.address;

        const metadata = metadataToken;
        const metadataHash = ethers.utils.solidityKeccak256(['bytes'], [metadata]);

        const balanceDeployer = await tokenContract.balanceOf(deployer.address);
        const balanceBridge = await tokenContract.balanceOf(polygonZkEVMBridgeContract.address);

        const rollupExitRoot = await polygonZkEVMGlobalExitRoot.lastRollupExitRoot();

        // create a new deposit
        await expect(tokenContract.approve(polygonZkEVMBridgeContract.address, amount))
            .to.emit(tokenContract, 'Approval')
            .withArgs(deployer.address, polygonZkEVMBridgeContract.address, amount);

        // pre compute root merkle tree in Js
        const height = 32;
        const merkleTree = new MerkleTreeBridge(height);
        const leafValue = getLeafValue(
            LEAF_TYPE_ASSET,
            originNetwork,
            tokenAddress,
            destinationNetwork,
            destinationAddress,
            amount,
            metadataHash,
        );
        merkleTree.add(leafValue);
        const rootJSMainnet = merkleTree.getRoot();

        await expect(polygonZkEVMBridgeContract.bridgeAsset(destinationNetwork, destinationAddress, amount, tokenAddress, false, '0x'))
            .to.emit(polygonZkEVMBridgeContract, 'BridgeEvent')
            .withArgs(LEAF_TYPE_ASSET, originNetwork, tokenAddress, destinationNetwork, destinationAddress, amount, metadata, depositCount);

        expect(await tokenContract.balanceOf(deployer.address)).to.be.equal(balanceDeployer.sub(amount));
        expect(await tokenContract.balanceOf(polygonZkEVMBridgeContract.address)).to.be.equal(balanceBridge.add(amount));
        expect(await polygonZkEVMBridgeContract.lastUpdatedDepositCount()).to.be.equal(0);
        expect(await polygonZkEVMGlobalExitRoot.lastMainnetExitRoot()).to.be.equal(ethers.constants.HashZero);

        // check merkle root with SC
        const rootSCMainnet = await polygonZkEVMBridgeContract.getDepositRoot();
        expect(rootSCMainnet).to.be.equal(rootJSMainnet);

        // Update global exit root
        await expect(polygonZkEVMBridgeContract.updateGlobalExitRoot())
            .to.emit(polygonZkEVMGlobalExitRoot, 'UpdateGlobalExitRoot')
            .withArgs(rootJSMainnet, rollupExitRoot);

        // no state changes since there are not any deposit pending to be updated
        await polygonZkEVMBridgeContract.updateGlobalExitRoot();
        expect(await polygonZkEVMBridgeContract.lastUpdatedDepositCount()).to.be.equal(1);
        expect(await polygonZkEVMGlobalExitRoot.lastMainnetExitRoot()).to.be.equal(rootJSMainnet);

        const computedGlobalExitRoot = calculateGlobalExitRoot(rootJSMainnet, rollupExitRoot);
        expect(computedGlobalExitRoot).to.be.equal(await polygonZkEVMGlobalExitRoot.getLastGlobalExitRoot());

        // bridge message
        await expect(polygonZkEVMBridgeContract.bridgeMessage(destinationNetwork, destinationAddress, false, metadata, { value: amount }))
            .to.emit(polygonZkEVMBridgeContract, 'BridgeEvent')
            .withArgs(
                LEAF_TYPE_MESSAGE,
                originNetwork,
                deployer.address,
                destinationNetwork,
                destinationAddress,
                amount,
                metadata,
                1,
            );
        expect(await polygonZkEVMBridgeContract.lastUpdatedDepositCount()).to.be.equal(1);
        expect(await polygonZkEVMGlobalExitRoot.lastMainnetExitRoot()).to.be.equal(rootJSMainnet);

        // Update global exit root
        await expect(polygonZkEVMBridgeContract.updateGlobalExitRoot())
            .to.emit(polygonZkEVMGlobalExitRoot, 'UpdateGlobalExitRoot');

        expect(await polygonZkEVMBridgeContract.lastUpdatedDepositCount()).to.be.equal(2);
        expect(await polygonZkEVMGlobalExitRoot.lastMainnetExitRoot()).to.not.be.equal(rootJSMainnet);

        // Just to have the metric of a low cost bridge Asset
        const tokenAddress2 = ethers.constants.AddressZero; // Ether
        const amount2 = ethers.utils.parseEther('10');
        await polygonZkEVMBridgeContract.bridgeAsset(destinationNetwork, destinationAddress, amount2, tokenAddress2, false, '0x', { value: amount2 });
    });


    it('should PolygonZkEVMBridge and sync the current root with events', async () => {
        const depositCount = await polygonZkEVMBridgeContract.depositCount();
        const originNetwork = networkIDMainnet;
        const tokenAddress = ethers.constants.AddressZero; // Ether
        const amount = ethers.utils.parseEther('10');
        const destinationNetwork = networkIDRollup;
        const destinationAddress = deployer.address;

        const metadata = '0x';// since is ether does not have metadata

        // create 3 new deposit
        await expect(polygonZkEVMBridgeContract.bridgeAsset(
            destinationNetwork,
            destinationAddress,
            amount,
            tokenAddress,
            true,
            '0x',
            { value: amount },
        ))
            .to.emit(
                polygonZkEVMBridgeContract,
                'BridgeEvent',
            )
            .withArgs(
                LEAF_TYPE_ASSET,
                originNetwork,
                tokenAddress,
                destinationNetwork,
                destinationAddress,
                amount,
                metadata,
                depositCount,
            );

        await expect(polygonZkEVMBridgeContract.bridgeAsset(
            destinationNetwork,
            destinationAddress,
            amount,
            tokenAddress,
            true,
            '0x',
            { value: amount },
        ))
            .to.emit(
                polygonZkEVMBridgeContract,
                'BridgeEvent',
            )
            .withArgs(
                LEAF_TYPE_ASSET,
                originNetwork,
                tokenAddress,
                destinationNetwork,
                destinationAddress,
                amount,
                metadata,
                depositCount.add(1),
            );

        await expect(polygonZkEVMBridgeContract.bridgeAsset(
            destinationNetwork,
            destinationAddress,
            amount,
            tokenAddress,
            true,
            '0x',
            { value: amount },
        ))
            .to.emit(
                polygonZkEVMBridgeContract,
                'BridgeEvent',
            )
            .withArgs(
                LEAF_TYPE_ASSET,
                originNetwork,
                tokenAddress,
                destinationNetwork,
                destinationAddress,
                amount,
                metadata,
                depositCount.add(2),
            );

        // Prepare merkle tree
        const height = 32;
        const merkleTree = new MerkleTreeBridge(height);

        // Get the deposit's events
        const filter = polygonZkEVMBridgeContract.filters.BridgeEvent(
            null,
            null,
            null,
            null,
            null,
        );
        const events = await polygonZkEVMBridgeContract.queryFilter(filter, 0, 'latest');
        events.forEach((e) => {
            const { args } = e;
            const leafValue = getLeafValue(
                args.leafType,
                args.originNetwork,
                args.originAddress,
                args.destinationNetwork,
                args.destinationAddress,
                args.amount,
                ethers.utils.solidityKeccak256(['bytes'], [args.metadata]),
            );
            merkleTree.add(leafValue);
        });

        // Check merkle root with SC
        const rootSC = await polygonZkEVMBridgeContract.getDepositRoot();
        const rootJS = merkleTree.getRoot();

        expect(rootSC).to.be.equal(rootJS);
    });
});
