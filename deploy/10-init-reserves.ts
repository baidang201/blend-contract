import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";
import { BigNumberish } from "ethers";
import hre from "hardhat";

import { 
  ZERO_BYTES_32, 
  ZERO_ADDRESS 
} from "../utils/constants";
import { config } from "dotenv";
import { 
  eBevmNetwork,
  eContractid, 
  eEthereumNetwork, 
  eNetwork, 
  IBlendConfiguration, 
  IReserveParams, 
  tEthereumAddress 
} from "../utils/types";
import { MARKET_NAME } from "../utils/env";
import { 
  ConfigNames, 
  getParamPerNetwork, 
  getReserveAddresses, 
  getTreasuryAddress, 
  loadPoolConfig, 
  savePoolTokens 
} from "../utils/market-config-helpers";
import { getDeployedContract } from "../utils/env-utils";
import { 
  ACL_MANAGER_ID,
  BTOKEN_IMPL_ID, 
  BTOKEN_PREFIX, 
  DELEGATION_AWARE_BTOKEN_IMPL_ID, 
  POOL_ADDRESSES_PROVIDER_ID, 
  POOL_CONFIGURATOR_IMPL_ID, 
  POOL_CONFIGURATOR_PROXY_ID, 
  POOL_DATA_PROVIDER, 
  RESERVES_SETUP_HELPER_ID, 
  STABLE_DEBT_PREFIX, 
  STABLE_DEBT_TOKEN_IMPL_ID, 
  VARIABLE_DEBT_PREFIX,
  VARIABLE_DEBT_TOKEN_IMPL_ID
} from "../utils/deploy-ids";
import { chunk } from "../utils/utils";
import Bluebird from "bluebird";
config({ path: "../.env" });

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;  
  const { save, deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  console.log("deployer: ", deployer);
  
    // 添加调试日志
    console.log("=== Debug init-reserves ===");
    const allDeployments = await deployments.all();
    console.log("Available deployments:", Object.keys(allDeployments));
    
    // 获取所有已部署的TestnetERC20合约
    const testnetTokens = Object.entries(allDeployments).filter(([name, deployment]) => {
      return deployment.abi && deployment.abi.some(item => 
        item.type === 'constructor' && item.inputs && 
        item.inputs.some(input => input.name === 'symbol')
      );
    });
    
    console.log("Found TestnetERC20 tokens:", testnetTokens.map(([name]) => name));
    
    // 尝试获取特定资产
    try {
      const usdt = await getDeployedContract("TestnetERC20", "USDT");
      console.log("USDT contract found at:", usdt.target);
    } catch (error) {
      console.log("Failed to find USDT contract:", error);
    }

  const network = (
    process.env.FORK ? process.env.FORK : hre.network.name
  ) as eNetwork;
  
  const poolConfig = loadPoolConfig(
    MARKET_NAME as ConfigNames
  ) as IBlendConfiguration;
  
  const provider = await getDeployedContract("PoolAddressesProvider", POOL_ADDRESSES_PROVIDER_ID);
  const poolDataProvider = await getDeployedContract("PoolDataProvider", POOL_DATA_PROVIDER);
  
  const poolProxy = await hre.ethers.getContractAt(
    "Pool", 
    await provider.getPool()
  );
  const poolConfiguratorProxy = await hre.ethers.getContractAt(
    "PoolConfigurator", 
    await provider.getPoolConfigurator()
  );
  const  aclManager = await hre.ethers.getContractAt(
    "ACLManager", 
    await provider.getACLManager()
  );

  //Deploy Reserver setup helper
  await deploy(RESERVES_SETUP_HELPER_ID, {
    contract: "ReservesSetupHelper",
    from: deployer,
    args: [],
  }).then((res) => {
    console.log("ReservesSetupHelper deployed to: ", res.address, res.newlyDeployed);
  });
  const ReservesSetupHelper = await deployments.get(RESERVES_SETUP_HELPER_ID);
  const reservesSetupHelper = await ethers.getContractAt(
    "ReservesSetupHelper",
    ReservesSetupHelper.address
  );

  const {
    BTokenNamePrefix,
    StableDebtTokenNamePrefix,
    VariableDebtTokenNamePrefix,
    SymbolPrefix,
    ReservesConfig,
    RateStrategies,
  } = poolConfig;

  // Deploy Rate Strategies
  for (const strategy in RateStrategies) {
    const strategyData = RateStrategies[strategy];
    const args = [
      provider.target,
      strategyData.optimalUsageRatio,
      strategyData.baseVariableBorrowRate,
      strategyData.variableRateSlope1,
      strategyData.variableRateSlope2,
      strategyData.stableRateSlope1,
      strategyData.stableRateSlope2,
      strategyData.baseStableRateOffset,
      strategyData.stableRateExcessOffset,
      strategyData.optimalStableToTotalDebtRatio,
    ];
    await deploy(`ReserveStrategy-${strategyData.name}`, {
      contract: "DefaultReserveInterestRateStrategy",
      from: deployer,
      args: args,
    }).then((res) => {
      console.log(`ReserveStrategy-${strategyData.name} deployed to: `, res.address, res.newlyDeployed);
    });
  }

  // Deploy Reserves BTokens
  const treasuryAddress = await getTreasuryAddress(poolConfig, network);
  const incentivesController = await deployments.get("RewardsControllerProxy");
  
  const reservesAssets = getParamPerNetwork(poolConfig.ReserveAssets, network);
  if (reservesAssets === undefined) {
    throw Error("Reserve assets not found");
  }
  if (network === eEthereumNetwork.hardhat || network === eBevmNetwork.testnet || network === eEthereumNetwork.localhost) {
    for (const asset in reservesAssets) {
      if (reservesAssets[asset] === ZERO_ADDRESS) {
        reservesAssets[asset] = (await deployments.get(asset)).address;
      }
    }
  }
  
  const initChunks = 3;
  let reserveTokens: string[] = [];
  let reserveInitDecimals: string[] = [];
  let reserveSymbols: string[] = [];
  let initInputParams: {
    bTokenImpl: string;
    stableDebtTokenImpl: string;
    variableDebtTokenImpl: string;
    underlyingAssetDecimals: BigNumberish;
    interestRateStrategyAddress: string;
    underlyingAsset: string;
    treasury: string;
    incentivesController: string;
    underlyingAssetName: string;
    bTokenName: string;
    bTokenSymbol: string;
    variableDebtTokenName: string;
    variableDebtTokenSymbol: string;
    stableDebtTokenName: string;
    stableDebtTokenSymbol: string;
    params: string;
  }[] = [];

  let strategyAddresses: Record<string, tEthereumAddress> = {};
  let strategyAddressPerAsset: Record<string, string> = {};
  let bTokenType: Record<string, string> = {};
  let delegationAwareBTokenImplementationAddress = "";
  let bTokenImplementationAddress = "";
  let stableDebtTokenImplementationAddress = "";
  let variableDebtTokenImplementationAddress = "";
  
  stableDebtTokenImplementationAddress = (
    await hre.deployments.get(STABLE_DEBT_TOKEN_IMPL_ID)
  ).address;
  variableDebtTokenImplementationAddress = (
    await hre.deployments.get(VARIABLE_DEBT_TOKEN_IMPL_ID)
  ).address;
  bTokenImplementationAddress = (
    await hre.deployments.get(BTOKEN_IMPL_ID)
    ).address;

  const delegatedAwareReserves = Object.entries(ReservesConfig).filter(
    ([_, { bTokenImpl }]) => bTokenImpl === eContractid.DelegationAwareBToken
  ) as [string, IReserveParams][];

  if (delegatedAwareReserves.length > 0) {
    delegationAwareBTokenImplementationAddress = (
      await hre.deployments.get(DELEGATION_AWARE_BTOKEN_IMPL_ID)
    ).address;
  }

  const reserves = Object.entries(ReservesConfig).filter(
    ([_, { bTokenImpl }]) =>
      bTokenImpl === eContractid.DelegationAwareBToken ||
      bTokenImpl === eContractid.BToken
  ) as [string, IReserveParams][];

  for (let [symbol, params] of reserves) {
    let tokenAddress : string;
    if (network === eEthereumNetwork.hardhat || network === eBevmNetwork.testnet || network === eEthereumNetwork.localhost) {
      tokenAddress = (await hre.deployments.get(symbol)).address;
    } else {
      tokenAddress = reservesAssets[symbol];
    }

    const poolReserve = await poolProxy.getReserveData(tokenAddress);

    if (poolReserve.bTokenAddress !== ZERO_ADDRESS) {
      console.log(`- Skipping init of ${symbol} due is already initialized`);
      continue;
    }
    const { strategy, bTokenImpl, reserveDecimals } = params;
    if (!strategyAddresses[strategy.name]) {
      // Strategy does not exist, load it
      strategyAddresses[strategy.name] = (
        await hre.deployments.get(`ReserveStrategy-${strategy.name}`)
      ).address;
    }
    strategyAddressPerAsset[symbol] = strategyAddresses[strategy.name];
    console.log(
      "Strategy address for asset %s: %s",
      symbol,
      strategyAddressPerAsset[symbol]
    );

    if (bTokenImpl === eContractid.BToken) {
      bTokenType[symbol] = "generic";
    } else if (bTokenImpl === eContractid.DelegationAwareBToken) {
      bTokenType[symbol] = "delegation aware";
    }

    reserveInitDecimals.push(reserveDecimals);
    reserveTokens.push(tokenAddress);
    reserveSymbols.push(symbol);
  }

  for (let i = 0; i < reserveSymbols.length; i++) {
    let bTokenToUse: string;
    if (bTokenType[reserveSymbols[i]] === "generic") {
      bTokenToUse = bTokenImplementationAddress;
    } else {
      bTokenToUse = delegationAwareBTokenImplementationAddress;
    }

    initInputParams.push({
      bTokenImpl: bTokenToUse,
      stableDebtTokenImpl: stableDebtTokenImplementationAddress,
      variableDebtTokenImpl: variableDebtTokenImplementationAddress,
      underlyingAssetDecimals: reserveInitDecimals[i],
      interestRateStrategyAddress: strategyAddressPerAsset[reserveSymbols[i]],
      underlyingAsset: reserveTokens[i],
      treasury: treasuryAddress,
      // incentivesController: incentivesController.address,  not used
      incentivesController: ZERO_ADDRESS,
      underlyingAssetName: reserveSymbols[i],
      bTokenName: `Blend ${reserveSymbols[i]}`,
      bTokenSymbol: `b${reserveSymbols[i]}`,
      variableDebtTokenName: `Blend Variable Debt ${reserveSymbols[i]}`,
      variableDebtTokenSymbol: `variableDebt${SymbolPrefix}${reserveSymbols[i]}`,
      stableDebtTokenName: `Blend Stable Debt ${reserveSymbols[i]}`,
      stableDebtTokenSymbol: `stableDebt${SymbolPrefix}${reserveSymbols[i]}`,
      params: "0x10",
    });
  }

  // Deploy init reserves per chunks
  const chunkedSymbols = chunk(reserveSymbols, initChunks);
  const chunkedInitInputParams = chunk(initInputParams, initChunks);
  
  console.log(
    `- Reserves initialization in ${chunkedInitInputParams.length} txs`
  );
  for (
    let chunkIndex = 0;
    chunkIndex < chunkedInitInputParams.length;
    chunkIndex++
  ) {
    let tx = await poolConfiguratorProxy.initReserves(chunkedInitInputParams[chunkIndex]);
    await tx.wait().then(() => {
      console.log(
        `  - Reserve ready for: ${chunkedSymbols[chunkIndex].join(", ")}`,
        `\n    - Tx hash: ${tx.hash}`
      );
    });
  }

  deployments.log(`[Deployment] Initialized all reserves`);

  // Configure reserves By Helper
  const tokens: string[] = [];
  const symbols: string[] = [];

  const inputParams: {
    asset: string;
    baseLTV: BigNumberish;
    liquidationThreshold: BigNumberish;
    liquidationBonus: BigNumberish;
    reserveFactor: BigNumberish;
    borrowCap: BigNumberish;
    supplyCap: BigNumberish;
    stableBorrowingEnabled: boolean;
    borrowingEnabled: boolean;
    flashLoanEnabled: boolean;
  }[] = [];

  for (const [
    assetSymbol,
    {
      baseLTVAsCollateral,
      liquidationBonus,
      liquidationThreshold,
      reserveFactor,
      borrowCap,
      supplyCap,
      stableBorrowRateEnabled,
      borrowingEnabled,
      flashLoanEnabled,
    },
  ] of Object.entries(ReservesConfig) as [string, IReserveParams][]) {
    if (reservesAssets[assetSymbol] === ZERO_ADDRESS) {
      console.log(
        `- Skipping init of ${assetSymbol} due token address is not set at markets config`
      );
      continue;
    }
    if (baseLTVAsCollateral === "-1") continue;

    const assetAddressIndex = Object.keys(reservesAssets).findIndex(
      (value) => value === assetSymbol
    );
    const [, tokenAddress] = (
      Object.entries(reservesAssets) as [string, string][]
    )[assetAddressIndex];
    const { usageAsCollateralEnabled: alreadyEnabled } =
      await poolDataProvider.getReserveConfigurationData(tokenAddress);

    if (alreadyEnabled) {
      console.log(
        `- Reserve ${assetSymbol} is already enabled as collateral, skipping`
      );
      continue;
    }
    // Push data

    inputParams.push({
      asset: tokenAddress,
      baseLTV: baseLTVAsCollateral,
      liquidationThreshold,
      liquidationBonus,
      reserveFactor,
      borrowCap,
      supplyCap,
      stableBorrowingEnabled: stableBorrowRateEnabled,
      borrowingEnabled: borrowingEnabled,
      flashLoanEnabled: flashLoanEnabled,
    });

    tokens.push(tokenAddress);
    symbols.push(assetSymbol);
  }
  if (tokens.length) {
    // Set bTokenAndRatesDeployer as temporal admin
    const aclAdmin = await hre.ethers.getSigner(
      await provider.getACLAdmin()
    );
    
    await aclManager
    .connect(aclAdmin)
    .addRiskAdmin(reservesSetupHelper.target);

    // Deploy init per chunks
    const enableChunks = 20;
    const chunkedSymbols = chunk(symbols, enableChunks);
    const chunkedInputParams = chunk(inputParams, enableChunks);
    const poolConfiguratorAddress = await provider.getPoolConfigurator();

    console.log(`- Configure reserves in ${chunkedInputParams.length} txs`);
    for (
      let chunkIndex = 0;
      chunkIndex < chunkedInputParams.length;
      chunkIndex++
    ) {
      let tx = await reservesSetupHelper.configureReserves(
        poolConfiguratorAddress,
        chunkedInputParams[chunkIndex]
      );
      await tx.wait();
      console.log(
        `  - Init for: ${chunkedSymbols[chunkIndex].join(", ")}`,
        `\n    - Tx hash: ${tx.hash}`
      );
    }
    // Remove ReservesSetupHelper from risk admins
    
    let tx = await aclManager
    .connect(aclAdmin)
    .removeRiskAdmin(reservesSetupHelper.target);
    await tx.wait();
    
  }

  // Save BToken and Debt tokens artifacts
  const bTokenArtifact = await hre.deployments.getExtendedArtifact("BToken");
  const variableDebtTokenArtifact = await hre.deployments.getExtendedArtifact(
    "VariableDebtToken"
  );
  const stableDebtTokenArtifact = await hre.deployments.getExtendedArtifact(
    "StableDebtToken"
  );
  Bluebird.each(Object.keys(reservesAssets), async (tokenSymbol) => {
    const { bTokenAddress, variableDebtTokenAddress, stableDebtTokenAddress } =
    await poolDataProvider.getReserveTokensAddresses(reservesAssets[tokenSymbol]);

    await hre.deployments.save(`${tokenSymbol}${BTOKEN_PREFIX}`, {
      address: bTokenAddress,
      ...bTokenArtifact,
    });
    await hre.deployments.save(`${tokenSymbol}${VARIABLE_DEBT_PREFIX}`, {
      address: variableDebtTokenAddress,
      ...variableDebtTokenArtifact,
    });
    await hre.deployments.save(`${tokenSymbol}${STABLE_DEBT_PREFIX}`, {
      address: stableDebtTokenAddress,
      ...stableDebtTokenArtifact,
    });
  });

  deployments.log(`[Deployment] Configured all reserves`);
};
export default deployFunction;
deployFunction.tags = ["init-reserves"];
deployFunction.dependencies = ["core", "token", "incentives", "treasury"];