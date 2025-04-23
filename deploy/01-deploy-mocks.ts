import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

import { config } from "dotenv";
import { getBaseURI, getDeployedContract, getDeployedContractWithDefaultName } from "../utils/env-utils";
import { MOCK_CHAINLINK_AGGREGATORS_PRICES, RESERVE_TOKENS } from "../utils/constants";
import { ConfigNames, getReserveAddresses, getSymbolsByPrefix, isIncentivesEnabled, loadPoolConfig } from "../utils/market-config-helpers";
import { eBevmNetwork, eEthereumNetwork, eNetwork } from "../utils/types";
import { FAUCET_OWNABLE_ID, TESTNET_PRICE_AGGR_PREFIX, TESTNET_REWARD_TOKEN_PREFIX } from "../utils/deploy-ids";
import Bluebird from "bluebird";
import { MARKET_NAME } from "../utils/env";
config({ path: "../.env" });

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  console.log("deployer: ", deployer);

  const poolConfig = loadPoolConfig(MARKET_NAME as ConfigNames);
  const network = (
    process.env.FORK ? process.env.FORK : hre.network.name
  ) as eNetwork;

  if (network != eEthereumNetwork.hardhat && network != eBevmNetwork.testnet && network != eEthereumNetwork.localhost) {
    console.log(
      "[Deployment] Skipping testnet token setup at production market"
    );
    // Early exit if is not a testnet market
    return;
  }

  //Deploy FaucetOwnable contract
  console.log("- Deployment of FaucetOwnable contract");
  await deploy(FAUCET_OWNABLE_ID, {
    contract: "Faucet",
    args: [deployer, false],
    from: deployer,
  }).then((res) => {
    console.log("Faucet deployed to: %s, %s", res.address, res.newlyDeployed);
  });
  const faucet = await getDeployedContract("Faucet", FAUCET_OWNABLE_ID);
  
  // Deploy Testnet tokens
  const reservesConfig = poolConfig.ReservesConfig;
  const reserveSymbols = Object.keys(reservesConfig);
  if (reserveSymbols.length === 0) {
    console.warn(
      "Market Config does not contain ReservesConfig. Skipping testnet token setup."
    );
    return;
  }

  for (const token of reserveSymbols) {
    if (token === "WBTC") {
      // Deploy WETH9Mock
      await deploy("WBTC", {
        contract: "WETH9Mock",
        from: deployer,
        args: [
          poolConfig.WrappedNativeTokenSymbol,
          poolConfig.WrappedNativeTokenSymbol,
          faucet.target,
        ],
      }).then(async (res) => {
        console.log("WBTC deployed to: %s, %s", res.address, res.newlyDeployed);

        let tx = await faucet.mint( res.address, deployer, "10000000000");
        await tx.wait().then(() => {
          console.log("       @@@mint to deployer done!", res.address,  );
        });

      });
      continue;
    }
    await deploy(token, {
      contract: "TestnetERC20",
      from: deployer,
      args: [
        token, 
        token.toUpperCase(), 
        reservesConfig[token].reserveDecimals, 
        faucet.target
      ],
    }).then(async (res) => {
      console.log("%s deployed to: %s, %s", token, res.address, res.newlyDeployed);

      let tx = await faucet.mint( res.address, deployer, ethers.parseUnits("10", Number(reservesConfig[token].reserveDecimals)).toString());
      await tx.wait().then(() => {
        console.log("       @@@mint to deployer done!", res.address,  );
      });

    });
  }

  let symbols = reserveSymbols;

  // Deploy reward tokens
  if (isIncentivesEnabled(poolConfig)) {

    // const rewardSymbols: string[] = Object.keys(
    //   poolConfig.IncentivesConfig.rewards[network] || {}
    // );

    // symbols = [...symbols, ...rewardSymbols];

    // for (let y = 0; y < rewardSymbols.length; y++) {
    //   const reward = rewardSymbols[y];
    //   await deploy(reward, {
    //     contract: "TestnetERC20",
    //     from: deployer,
    //     args: [reward, reward, 18, faucet.address],
    //   }).then((res) => {
    //     console.log("%s deployed to: %s, %s", reward, res.address, res.newlyDeployed);
    //   });
    // }

    // 3. Deployment of Stake Aave
    // const COOLDOWN_SECONDS = "3600";
    // const UNSTAKE_WINDOW = "1800";
    // const blendTokenArtifact = await deployments.get(`BLEND`);

    // await deploy("InitializableAdminUpgradeabilityProxy", {
    //   contract: "InitializableAdminUpgradeabilityProxy",
    //   from: deployer,
    // }).then((res) => {
    //   console.log(
    //     "InitializableAdminUpgradeabilityProxy deployed to: %s, %s",
    //     res.address,
    //     res.newlyDeployed
    //   );
    // });
    // const stakeProxy = await getDeployedContractWithDefaultName("InitializableAdminUpgradeabilityProxy");

    // Setup StkAave
    // const proxyAdminSlot = await hre.ethers.provider.getStorageAt(
    //   stakeProxy.address,
    //   "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103" // keccak-256 eip1967.proxy.admin sub 1
    // );

    // console.log("Testnet Reserve Tokens");
    // console.log("======================");

    // const allDeployments = await deployments.all();
    // const testnetDeployment = Object.keys(allDeployments).filter((x) =>
    //   x.includes(TESTNET_TOKEN_PREFIX)
    // );
    // testnetDeployment.forEach((key) =>
    //   console.log(key, allDeployments[key].address)
    // );

    // console.log("Testnet Reward Tokens");
    // console.log("======================");

    // const rewardDeployment = Object.keys(allDeployments).filter((x) =>
    //   x.includes(TESTNET_REWARD_TOKEN_PREFIX)
    // );

    // rewardDeployment.forEach((key) =>
    //   console.log(key, allDeployments[key].address)
    // );

    // console.log(
    //   "Native Token Wrapper WETH9",
    //   (
    //     await deployments.get(
    //       poolConfig.WrappedNativeTokenSymbol
    //     )
    //   ).address
    // );
  }
    
  // Deploy price aggregator
  // await Bluebird.each(symbols, async (symbol) => {
  //   const price =
  //     symbol === "StkBlend"
  //       ? MOCK_CHAINLINK_AGGREGATORS_PRICES["BLEND"]
  //       : MOCK_CHAINLINK_AGGREGATORS_PRICES[symbol];
  //   if (!price) {
  //     throw `[ERROR] Missing mock price for asset ${symbol} at MOCK_CHAINLINK_AGGREGATORS_PRICES constant located at src/constants.ts`;
  //   }
    
  //   let aggregatorSymbol = `${symbol}${TESTNET_PRICE_AGGR_PREFIX}`;
  //   await deploy(aggregatorSymbol, {
  //     contract: "MockAggregator",
  //     from: deployer,
  //     args: [price],
  //   }).then((res) => {
  //     console.log("%s deployed to: %s, %s", aggregatorSymbol, res.address, res.newlyDeployed);
  //   });
  // });

};

//
export default deployFunction;
deployFunction.tags = ["mocks"];
