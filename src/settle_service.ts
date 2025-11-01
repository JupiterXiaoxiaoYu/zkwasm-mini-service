/**
 * Configuration interface for Settlement service
 */
export interface Config {
    /** RPC provider URL for Ethereum network */
    rpcProvider: string;
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
    /** Token precision (decimal places) for internal zkWASM representation
     * Default: 0 (integer, backward compatible)
     * Set to 6 for micro-unit precision (1 token = 1,000,000 base units)
     */
    tokenPrecision?: number;
  }
  
  /**
   * Settlement service class that handles L2 to L1 token settlements
   */
  import { Settlement } from './settle.js';
  
  import dotenv from 'dotenv';
  import { 
    get_chain_id,
    get_mongoose_db,
    get_contract_addr,
    get_settle_private_account,
    get_zkwasm_rpc_url,
  } from './utils/config.js';
  
  dotenv.config();
  
  const getConfig = (configOverride?: Partial<Config>): Config => {
    // Default config from environment variables
    const defaultConfig: Config = {
      rpcProvider: process.env.RPC_PROVIDER || "https://ethereum-sepolia-rpc.publicnode.com",
      settlementContractAddress: get_contract_addr(),
      mongoUri: get_mongoose_db(),
      zkwasmRpcUrl: get_zkwasm_rpc_url(),
      settlerPrivateKey: get_settle_private_account(),
      chainId: Number(get_chain_id()),
      tokenPrecision: process.env.TOKEN_PRECISION ? Number(process.env.TOKEN_PRECISION) : 0,
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
    // const deposit = new Deposit(defaultConfig);
    // await deposit.serve();

    // Optionally start settlement service
    if (!defaultConfig.settlerPrivateKey) {
      throw new Error('settlerPrivateKey is required for settlement service');
    }
    const settlement = new Settlement(defaultConfig as Required<Config>);
    await settlement.serve();
  };
  
  // Check if file is being run directly
  if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
  }
  
  // Export for use as a module
  export { getConfig };
  
  