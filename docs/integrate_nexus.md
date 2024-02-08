# Nexus Network

Nexus Network is building an economic layer for rollups. This means that Rollups can earn extra yields on already present assets on the Rollup bridge contract.

### Native ETH yield
- To earn extra yield on ETH present in the rollup bridge contract one needs to deploy nexus library contract:
```
npx hardhat run /deployment/nexus_library.js --network holesky/goerli
```
- Note the address printed on the console
- Change the address for the variable `nexusLibrary` in the PolygonZkEVMBridge.sol to the address printed in the console
- Now run the deployment for other contracts as it is.

For more information about nexus network refer to [docs](https://docs.nexusnetwork.co.in/)