/* eslint-disable no-await-in-loop, no-use-before-define, no-lonely-if, import/no-dynamic-require, global-require */
/* eslint-disable no-console, no-inner-declarations, no-undef, import/no-unresolved, no-restricted-syntax */
const { ethers } = require('hardhat');

async function main() {
    const Nexus = await ethers.getContractFactory('NexusLibrary');
    const nexus = await Nexus.deploy();
    console.log('nexus library deployed to:', nexus.address);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
