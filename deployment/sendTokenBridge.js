/* eslint-disable no-console, no-inner-declarations, no-undef, import/no-unresolved */
/* eslint-disable no-await-in-loop, no-use-before-define, no-lonely-if, no-restricted-syntax */
const { ethers } = require('hardhat');

async function main() {
    console.log('test');
    const [signer] = await ethers.getSigners();
    const PolygonBridge = await ethers.getContractFactory('PolygonZkEVMBridge');
    const bridge = await PolygonBridge.attach('0x8F20926159Dc7577F56fB3Dc903d8D46526E9594');
    console.log(await ethers.provider.getBalance('0x8F20926159Dc7577F56fB3Dc903d8D46526E9594'));
    console.log(await bridge.connect(signer).NEXUS_NETWORK());
    // await bridge.connect(signer).withdraw(ethers.utils.parseEther('200'));
    // await bridge.connect(signer).bridgeAsset(1, signer.address, ethers.utils.parseEther('2000'), '0x0000000000000000000000000000000000000000', false, '0x', { value: ethers.utils.parseEther('2000') });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
