# Deploying ZKEVM contracts with nexus network

Nexus Network enable native yields and protocol revenue from underlying assets on bridge contract of rollup.

### Native ETH yield
- To earn extra yield on ETH present in the rollup bridge contract one needs to deploy nexus library contract:
```
npx hardhat run deployment/nexus_library.ts --network holesky
```
- Note the address printed on the console
- Change the address for the variable `nexusLibrary` in the PolygonZkEVMBridge.sol to the address printed in the console
- Now run the deployment of polygon zkevm
```
npm run deploy:v2:holesky
npm run verify:v2:holesky

```

For more information about nexus network refer to [docs](https://docs.nexusnetwork.co.in/)