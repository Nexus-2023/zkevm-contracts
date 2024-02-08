//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface INexusInterface {
    // structs to be used for nexus interface
    struct Rollup {
        address bridgeContract;
        uint16 stakingLimit;
        uint64 operatorCluster;
    }
    struct Validator {
        bytes pubKey;
        bytes withdrawalAddress;
        bytes signature;
        bytes32 depositRoot;
    }

    // functions
    function depositValidatorRollup(
        address _rollupAdmin,
        Validator[] calldata _validators
    ) external;
}
