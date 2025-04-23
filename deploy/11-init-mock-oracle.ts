import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { config } from "dotenv";
import { getBaseURI, getDeployedContract, getDeployedContractWithDefaultName } from "../utils/env-utils";
import { MOCK_CHAINLINK_AGGREGATORS_PRICES, RESERVE_TOKENS } from "../utils/constants";
import { ConfigNames, getReserveAddresses, getSymbolsByPrefix, isIncentivesEnabled, loadPoolConfig } from "../utils/market-config-helpers";
import { eBevmNetwork, eEthereumNetwork, eNetwork } from "../utils/types";
import { FAUCET_OWNABLE_ID, ORACLE_ID, POOL_ADDRESSES_PROVIDER_ID, TESTNET_PRICE_AGGR_PREFIX, TESTNET_REWARD_TOKEN_PREFIX } from "../utils/deploy-ids";
import Bluebird from "bluebird";
import { MARKET_NAME } from "../utils/env";
import { MockAggregator__factory } from "../typechain-types";
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

  if (network != eEthereumNetwork.hardhat && network != eBevmNetwork.testnet && network != 'localhost') {
    console.log(
      "[Deployment] Skipping testnet token setup at production market"
    );
    // Early exit if is not a testnet market
    return;
  }

  let tx;

  const reservesConfig = poolConfig.ReservesConfig;
  const reserveSymbols = Object.keys(reservesConfig);
  if (reserveSymbols.length === 0) {
    console.warn(
      "Market Config does not contain ReservesConfig. Skipping testnet token setup."
    );
    return;
  }

  let symbols = reserveSymbols;
  let mockTokens : string[] = [];
  let mockAggregators  : string[] = [];

  // Deploy price aggregator
  await Bluebird.each(symbols, async (symbol) => {
    const price =
      symbol === "StkBlend"
        ? MOCK_CHAINLINK_AGGREGATORS_PRICES["BLEND"]
        : MOCK_CHAINLINK_AGGREGATORS_PRICES[symbol];
    if (!price) {
      throw `[ERROR] Missing mock price for asset ${symbol} at MOCK_CHAINLINK_AGGREGATORS_PRICES constant located at src/constants.ts`;
    }

    const Asset = await deployments.get(symbol);
    mockTokens.push(Asset.address);

    let aggregatorSymbol = `${symbol}${TESTNET_PRICE_AGGR_PREFIX}`;
    await deploy(aggregatorSymbol, {
      contract: "MockAggregator",
      from: deployer,
      args: [price],
    }).then((res) => {
      console.log("%s deployed to: %s, %s", aggregatorSymbol, res.address, res.newlyDeployed);
    });
    const Aggregator = await deployments.get(aggregatorSymbol);
    mockAggregators.push(Aggregator.address);
  });
  
  const oracle = await getDeployedContract("ProtocolOracle", ORACLE_ID);
  tx = await oracle.setAssetSources(mockTokens, mockAggregators);
  await tx.wait().then(() => {
    console.log("Asset set price source");
  });

  console.log("mockTokens: ", mockTokens);
  console.log("mockAggregators: ", mockAggregators);

};

export default deployFunction;
deployFunction.tags = ["init-mock-oracle"];
deployFunction.dependencies = ["core", "mock"];
