/**
 * Configuration interface for both Deposit and Settlement services
 */
export interface Config {
  /** RPC provider URL for Ethereum network */
  rpcProvider: string;
  /** Admin key for the server */
  serverAdminKey: string;
  /** Settlement contract address */
  settlementContractAddress: string;
  /** MongoDB URI */
  mongoUri: string;
  /** Optional zkWasm RPC URL */
  zkwasmRpcUrl?: string;
  /** Private key for the settler (only required for Settlement service) */
  settlerPrivateKey?: string;
  /** Chain ID */
  chainId?: number;
  /** Withdraw opcode */
  withdrawOpcode: string;
  /** Deposit opcode */
  depositOpcode: string;
  /** Optional start block for historical event processing */
  startBlock?: number;
}


/**
 * Deposit service class that handles L1 to L2 token deposits
 */
import { Deposit } from './deposit.js';

/**
 * Settlement service class that handles L2 to L1 token settlements
 */
import { Settlement } from './settle.js';

import dotenv from 'dotenv';
import { 
  get_server_admin_key,
  get_chain_id,
  get_mongodb_uri,
  get_contract_addr,
  get_settle_private_account,
  get_zkwasm_rpc_url,
} from './utils/config.js';

dotenv.config();

const getConfig = (configOverride?: Partial<Config>): Config => {
  // Default config from environment variables
  const defaultConfig: Config = {
    rpcProvider: process.env.RPC_PROVIDER || "https://ethereum-sepolia-rpc.publicnode.com",
    serverAdminKey: get_server_admin_key(),
    settlementContractAddress: get_contract_addr(),
    mongoUri: get_mongodb_uri(),
    zkwasmRpcUrl: get_zkwasm_rpc_url(),
    settlerPrivateKey: get_settle_private_account(),
    chainId: Number(get_chain_id()),
    withdrawOpcode: "6",
    depositOpcode: "7",
    startBlock: process.env.START_BLOCK ? Number(process.env.START_BLOCK) : undefined,
  };  



  // Merge with override config if provided
  return {
    ...defaultConfig,
    ...configOverride
  };
};

// Example usage:
const main = async () => {
  // Use default config from env
  const defaultConfig = getConfig();

  // Start deposit service
  const deposit = new Deposit(defaultConfig);
  await deposit.serve();

  // Optionally start settlement service
  // const settlement = new Settlement(defaultConfig);
  // await settlement.serve();
};

// Check if file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

// Export for use as a module
export { getConfig };

