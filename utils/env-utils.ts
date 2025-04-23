import hre, { deployments, ethers } from "hardhat";
import { config } from "dotenv";
import { eBevmNetwork, eEthereumNetwork } from "./types";
config({ path: "../.env" });

export const getAddress = (name: string) => {
  const configName = name.toUpperCase() + "_" + hre.network.name.toUpperCase();
  const address = process.env[configName];
  console.trace("@@1 getaddress Get address for %s: %s", configName, address);
  return address || "";
};

export const getMockPunks = () => {
  const configName = "PUNKS_MOCK_" + hre.network.name.toUpperCase();
  const address = process.env[configName];
  console.log("@@2 punks Get address for %s: %s", configName, address);
  return address || "";
};

export const getMockUSDC = async () => {
  if (hre.network.name == "hardhat") {
    return (await deployments.get("MockUSDC")).address;
  } else {
    const configName = "USDC_MOCK_" + hre.network.name.toUpperCase();
    const address = process.env[configName];
    console.log("@@3 usdc Get address for %s: %s", configName, address);
    return address || "";
  }
};

export const getMockRWA = (name: string) => {
  const configName = name.toUpperCase() + "_" + hre.network.name.toUpperCase();
  const address = process.env[configName];
  console.log("@@4 rwa Get address for %s: %s", configName, address);
  return address || "";
};

export const getWethAddress = async () => {
  if (hre.network.name === eEthereumNetwork.hardhat || hre.network.name === eBevmNetwork.testnet || hre.network.name === eEthereumNetwork.localhost) {
    return (await deployments.get("WBTC")).address;
  } else {
    return getAddress("wbtc");
  }
};

export const getWPunkAddress = async () => {
  if (hre.network.name == "hardhat") {
    return (await deployments.get("WrappedPunk")).address;
  } else {
    return getAddress("wpunk");
  }
};

export const getPunksAddress = async () => {
  if (hre.network.name == "hardhat") {
    return (await deployments.get("CryptoPunks")).address;
  } else if (hre.network.name == "goerli" || hre.network.name == "sepolia") {
    return getMockPunks();
  }  else {
    return getAddress("punks");
  }
};


export const getNftAddress = async (asset: string) => {
  if (hre.network.name == "hardhat" || hre.network.name == "goerli" || hre.network.name == "scrollAlpha") {
    const mockNft = await deployments.get(asset);
    return mockNft.address;
  } else {
    return getAddress(asset);
  }
};

export const getAggregatorAddress = async (asset: string) => {
  if (hre.network.name == "hardhat" || hre.network.name == "scrollAlpha") {
    const mocAggregator = await deployments.get(asset + "Aggregator");
    return mocAggregator.address;
  } else {
    return getAddress(asset + "_AGGREGATOR");
  }
};

export const getBaseURI = (asset: string) => {
  const configName = asset.toUpperCase() + "_URI";
  const uri = process.env[configName];
  console.log("Get base uri with %s: %s", configName, uri);
  return uri || "";
};

export const getDeployedContractWithDefaultName = async (contractName: string) => {
  return await getDeployedContract(contractName, contractName);
};

export const getDeployedContract = async (contractName: string, deployName: string) => {
  let deployedAddr = (await deployments.get(deployName)).address;
  return await ethers.getContractAt(contractName, deployedAddr);
};


export const getSignTypedData = async (signer: any, domain: any, types: any, value: any) => {

  // const domain = {
  //   name: 'SN',
  //   version: '1',
  //   chainId:  chainId,
  //   verifyingContract: lendingV2.target.toString(),
  // };

  // // The named list of all type definitions
  // const types = {
  //   LoanOffer: [
  //       { name: 'lender', type: 'address' },
  //       { name: 'collection', type: 'address' },
  //       { name: 'tokenId', type: 'uint256' },
  //       { name: 'loanToken', type: 'address' },
  //       { name: 'totalAmount', type: 'uint256' },
  //       { name: 'maxAmount', type: 'uint256' },
  //       { name: 'loanRate', type: 'uint256' },
  //       { name: 'loanDuration', type: 'uint256' },
  //       { name: 'expirationTime', type: 'uint256' },
  //       { name: 'salt', type: 'uint256' },
  //       { name: 'nonce', type: 'uint256' }
  //   ]
  // };

  // The data to sign
  // const value = {
  //   lender: testOffer.lender,
  //   collection: testOffer.collection,
  //   tokenId: testOffer.tokenId,
  //   loanToken: testOffer.loanToken,
  //   totalAmount: testOffer.totalAmount,
  //   maxAmount: testOffer.maxAmount,
  //   loanRate: testOffer.loanRate,
  //   loanDuration: testOffer.loanDuration,
  //   expirationTime: testOffer.expirationTime,
  //   salt: testOffer.salt,
  //   nonce: await lendingV2.nonces(testOffer.lender)
  // };

  return await signer.signTypedData(domain, types, value);
};

export const getEIP712Domain = async (name: string, version: string, verifyingContract: string) => {
  const chainId = await ethers.provider.getNetwork().then(network => network.chainId);
  const domain =  {
    name,
    version,
    chainId:  chainId,
    verifyingContract,
  };
  return domain;
}

export const getLoanOfferValue = async (
  testOffer: any, 
  nonce: any
) => {
  // The data to sign
  const value = {
    lender: testOffer.lender,
    collection: testOffer.collection,
    allTokenId: testOffer.allTokenId,
    tokenId: testOffer.tokenId,
    loanToken: testOffer.loanToken,
    totalAmount: testOffer.totalAmount,
    maxAmount: testOffer.maxAmount,
    loanRate: testOffer.loanRate,
    loanDuration: testOffer.loanDuration,
    expirationTime: testOffer.expirationTime,
    salt: testOffer.salt,
    nonce: nonce
  };

  return value;
};

export const getBorrowOfferValue = async (
  testOffer: any, 
  nonce: any
) => {
  // The data to sign
  const value = {
    borrower: testOffer.borrower,
    collection: testOffer.collection,
    tokenId: testOffer.tokenId,
    loanToken: testOffer.loanToken,
    loanAmount: testOffer.loanAmount,
    loanRate: testOffer.loanRate,
    loanDuration: testOffer.loanDuration,
    expirationTime: testOffer.expirationTime,
    salt: testOffer.salt,
    nonce: nonce
  };

  return value;
};