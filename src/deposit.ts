import { ethers, EventLog } from "ethers";
import mongoose from 'mongoose';
import { PlayerConvention, ZKWasmAppRpc } from "zkwasm-minirollup-rpc";
import abiData from './utils/Proxy.json' assert { type: 'json' };

// Mongoose Schema for tracking deposit transactions
const txSchema = new mongoose.Schema({
  txHash: { type: String, required: true, unique: true },
  // Transaction state: pending -> in-progress -> completed/failed
  state: { type: String, enum: ['pending', 'in-progress', 'completed', 'failed'], default: 'pending' },
  timestamp: { type: Date, default: Date.now },
  l1token: { type: String, required: true }, // L1 token address
  address: { type: String, required: true },  // User's address
  nonce: { 
    type: BigInt, 
    required: false,
    get: function(value: any) {
      return BigInt.asUintN(64, value); 
    }
  },
  // Player IDs for the deposit
  pid_1: { 
    type: BigInt, 
    required: true,
    get: function(value: any) {
      return BigInt.asUintN(64, value);
    }
  },
  pid_2: { 
    type: BigInt, 
    required: true,
    get: function(value: any) {
      return BigInt.asUintN(64, value);
    }
  },
  amount: { 
    type: BigInt, 
    required: true,
    get: function(value: any) {
      return BigInt.asUintN(64, value);
    }
  },
  retryCount: { type: Number, default: 0 },     // Number of retry attempts
  lastRetryTime: { type: Date }                 // Timestamp of last retry
});

txSchema.set('toJSON', { getters: true });
txSchema.set('toObject', { getters: true });

const TxHash = mongoose.model('TxHash', txSchema);

export class Deposit {
  private rpc: ZKWasmAppRpc;
  private admin: PlayerConvention;
  private provider: ethers.JsonRpcProvider;
  private proxyContract: ethers.Contract;
  private isProcessingDeposit: boolean = false; 
  private config: {
    rpcProvider: string;
    serverAdminKey: string;
    settlementContractAddress: string;
    mongoUri: string;
    zkwasmRpcUrl?: string;
    withdrawOpcode: string;
    depositOpcode: string;
    startBlock?: number;
  };

  constructor(config: {
    rpcProvider: string;
    serverAdminKey: string;
    settlementContractAddress: string;
    mongoUri: string;
    zkwasmRpcUrl?: string;
    withdrawOpcode: string;
    depositOpcode: string;
    startBlock?: number;
  }) {
    this.config = config;
    this.rpc = new ZKWasmAppRpc(config.zkwasmRpcUrl || "http://localhost:3000");
    
    this.provider = new ethers.JsonRpcProvider(config.rpcProvider);
    
    // Convert string to BigInt
    const WITHDRAW = BigInt(config.withdrawOpcode);
    const DEPOSIT = BigInt(config.depositOpcode);

    console.log("OPCODES - WITHDRAW:", WITHDRAW, "DEPOSIT:", DEPOSIT);
    
    this.admin = new PlayerConvention(config.serverAdminKey, this.rpc, DEPOSIT, WITHDRAW);
    this.proxyContract = new ethers.Contract(config.settlementContractAddress, abiData.abi, this.provider);

    console.log('HTTP provider initialized');
  }

  private createCommand(nonce: bigint, command: bigint, params: Array<bigint>): BigUint64Array {
    const cmd = (nonce << 16n) + (BigInt(params.length + 1) << 8n) + command;
    let buf = [cmd];
    buf = buf.concat(params);
    const barray = new BigUint64Array(buf);
    return barray;
  }

  private async createPlayer(player: PlayerConvention) {
    try {
      const CREATE_PLAYER = 1n;
      let result = await this.rpc.sendTransaction(
        this.createCommand(0n, CREATE_PLAYER, []),
        player.processingKey
      );
      return result;
    } catch(e) {
      if(e instanceof Error) {
        console.log(e.message);
      }
      console.log("create Player error");
    }
  }

  private async findTxByHash(txHash: string) {
    return await TxHash.findOne({ txHash });
  }

  private async updateTxState(txHash: string, state: string) {
    try {
      await TxHash.updateOne(
        { 
          txHash,
          state: { $ne: 'completed' }
        }, 
        { state }
      );
      console.log(`Transaction state updated to: ${state} for txHash: ${txHash}`);
    } catch (error) {
      console.error(`Failed to update tx state for txHash ${txHash}: ${(error as Error).message}`);
    }
  }

  /**
   * Performs a deposit transaction with concurrency control
   * @param txHash Transaction hash
   * @param nonce Transaction nonce
   * @param pid_1 First player ID
   * @param pid_2 Second player ID
   * @param tokenIndex Token index in the contract
   * @param amountInEther Amount to deposit in ether
   */
  private async performDeposit(txHash: string, nonce: bigint, pid_1: bigint, pid_2: bigint, tokenIndex: bigint, amountInEther: bigint) {
    if (this.isProcessingDeposit) {
      console.error(`Fatal: Detected reentrant call in performDeposit for tx ${txHash}`);
      process.exit(1); 
    }

    console.log("performDeposit, txHash:", txHash, "nonce:", nonce, "pid_1:", pid_1, "pid_2:", pid_2, "tokenIndex:", tokenIndex, "amountInEther:", amountInEther);

    try {
      this.isProcessingDeposit = true;

      // Check if transaction is already completed
      const currentTx = await TxHash.findOne({ txHash });
      if (currentTx?.state === 'completed') {
        console.error("tx already completed, this shall not happen");
        process.exit(1);
      }

      // Perform the actual deposit
      const depositResult = await this.admin.deposit(nonce, pid_1, pid_2, tokenIndex, amountInEther);
      if (!depositResult) {
        await this.updateTxState(txHash, 'failed');
        throw new Error(`Deposit failed for transaction ${txHash}`);
      }
      
      // Update state to completed
      await this.updateTxState(txHash, 'completed');
      return true;
    } catch (error) {
      // Error handling with completion check
      console.error('Error during deposit:', error);
      const latestTx = await TxHash.findOne({ txHash });
      if (latestTx?.state === 'completed') {
        return true;
      }
      await this.updateTxState(txHash, 'failed');
      throw error;
    } finally {
      this.isProcessingDeposit = false;
    }
  }

  private async processTopUpEvent(event: EventLog) {
    console.log('======================');
    try {
      const decodedEvent = this.proxyContract.interface.parseLog({
        topics: event.topics,
        data: event.data
      });
      
      if (!decodedEvent) {
        console.error('Failed to decode event');
        throw new Error('Failed to decode event');
      }

      const [l1token, address, pid_1, pid_2, amount] = decodedEvent.args;

      console.log(`TopUp event received: pid_1=${pid_1.toString()}, pid_2=${pid_2.toString()}, amount=${amount/BigInt(10 ** 18)}, hash=${event.transactionHash}`);

      const tokens = await this.proxyContract.allTokens();
      const getTokenIndex = function(l1token: string, tokens: any) {
          let tokenindex: bigint | null = null;
          for (let i = 0; i < tokens.length; i++) {
            if (l1token === tokens[i].token_uid) {
              tokenindex = BigInt(i);
              break;
            }
          }
          return tokenindex;
      }

      const tokenindex = await getTokenIndex(l1token, tokens);
      
      if (tokenindex === null) {
        console.log('Skip: token not found in contract:', l1token);
        return;
      }

      let amountInEther = amount / BigInt(10 ** 18);

      let tx = await TxHash.findOne({ txHash: event.transactionHash });
      
      if (!tx) {
        console.log(`Transaction hash not found: ${event.transactionHash}`);
        
        if (amountInEther < 1n) {
          tx = new TxHash({
            txHash: event.transactionHash,
            state: 'completed',
            l1token,
            address,
            pid_1,
            pid_2,
            amount: amountInEther,
          });
          await tx.save();
          console.log(`Transaction with insufficient amount marked as completed: ${event.transactionHash}`);
          console.log("======================\n");
          return;
        }
        
        tx = new TxHash({
          txHash: event.transactionHash,
          state: 'pending',
          l1token,
          address,
          pid_1,
          pid_2,
          amount: amountInEther,
        });
        await tx.save();
        
        // Add processing logic for the new pending transaction
        try {
          const nonce: bigint = await this.admin.getNonce();
          if(nonce === null) {
            console.error("nonce is null, this shall not happen");
            process.exit(1);
          }
          console.log("using nonce:", nonce);
          tx.nonce = nonce;
          await tx.save();
        } catch (error) {
          console.error('Error during get nonce:', error);
          throw error;
        }
        
        try {
          tx.state = 'in-progress';
          await tx.save();
          await this.performDeposit(event.transactionHash, tx.nonce, pid_1, pid_2, tokenindex, amountInEther);
        } catch (error) {
          console.error('Error during deposit processing:', error);
          await this.updateTxState(event.transactionHash, 'failed');
          throw error;
        }

      } else { // tx is tracked
        if (tx.state === 'completed') {
          console.log(`Transaction ${event.transactionHash} already completed.`);
          console.log("======================\n");
          return;
        } else if (tx.state === 'pending') {
          try {
            try {
              const nonce: bigint = await this.admin.getNonce();
              if(nonce === null) {
                console.error("nonce is null, this shall not happen");
                process.exit(1);
              }
              tx.nonce = nonce;

              await tx.save();
            } catch (error) {
              console.error('Error during get nonce:', error);
              throw error;
            }

            if (amountInEther < 1n) {
              console.log("tx with insufficient amount, change state to completed");
              await this.updateTxState(event.transactionHash, 'completed');
              console.log("======================\n");
              return;
            }

            try {
              tx.state = 'in-progress';
              await tx.save();
              await this.performDeposit(event.transactionHash, tx.nonce, pid_1, pid_2, tokenindex, amountInEther);
            } catch (error) {
              console.error('Error during deposit processing:', error);
              await this.updateTxState(event.transactionHash, 'failed');
              throw error;
            }

          } catch (error) {
            throw error;
          }
        } else if (tx.state === 'in-progress' || tx.state === 'failed') {
          try {
            if (tx.nonce != null) {
              const checkResult: any = await this.admin.checkDeposit(tx.nonce, pid_1, pid_2, tokenindex, amountInEther);
              if (checkResult.data != null) {
                console.log("checkDeposit success, change state to completed, pid_1:", pid_1, "pid_2:", pid_2, "amount:", amountInEther, "data:", JSON.stringify(checkResult.data), "hash:", tx.txHash);
                await this.updateTxState(event.transactionHash, 'completed');
                console.log("======================\n");
                return;
              } else {
                console.log("checkDeposit failed, perform retry");
                // perform retry
                tx.retryCount += 1;
                tx.lastRetryTime = new Date();
                const newNonce: bigint = await this.admin.getNonce();
                if(newNonce === null) {
                  console.error("nonce is null, this shall not happen");
                  process.exit(1);
                }
                tx.nonce = newNonce;
                await tx.save();
                await this.performDeposit(event.transactionHash, tx.nonce, pid_1, pid_2, tokenindex, amountInEther);
              }
            } else {
              console.error("tx nonce is not set shall not happen");
              process.exit(1);
            }
          } catch (error) {
            console.error('Error handling in-progress/failed transaction:', error);
            throw error;
          }
        } else {
          // This should never happen
          console.error("Unexpected state of tracked deposit tx");
          process.exit(1);
        }
      }
    } catch (error) {
      throw error;
    }
    console.log('======================\n');
  }

  private async getHistoricalTopUpEvents() {
    try {
      console.log("get block number...");
      const latestBlock = await this.provider.getBlockNumber();
      const batchSize = 25000;
      const totalBlocksToScan = 200000;
      
      // Use configured startBlock if available, otherwise calculate from totalBlocksToScan
      let startBlock: number;
      if (this.config.startBlock !== undefined) {
        if (this.config.startBlock > latestBlock) {
          console.log(`Configured startBlock (${this.config.startBlock}) is greater than latest block (${latestBlock}), skipping historical processing`);
          return;
        }
        startBlock = this.config.startBlock;
      } else {
        startBlock = Math.max(0, latestBlock - totalBlocksToScan);
      }
      
      console.log(`Starting historical scan - Latest block: ${latestBlock}`);
      console.log(`Scanning from block ${startBlock} to ${latestBlock}`);
      
      // Get event signature
      const topUpEvent = abiData.abi.find(
        (item: any) => item.type === 'event' && item.name === 'TopUp'
      );
      if (!topUpEvent) {
        throw new Error('TopUp event not found in ABI');
      }
      const eventSignature = `${topUpEvent.name}(${topUpEvent.inputs.map((input: any) => input.type).join(',')})`;
      const eventHash = ethers.id(eventSignature);
      console.log('Using event hash:', eventHash);

      // Process blocks in batches
      for (let fromBlock = startBlock; fromBlock < latestBlock; fromBlock += batchSize) {
        const toBlock = Math.min(fromBlock + batchSize - 1, latestBlock);
        console.log(`Querying events from block ${fromBlock} to ${toBlock}`);
        
        try {
          const logs = await this.provider.getLogs({
            address: this.config.settlementContractAddress,
            topics: [eventHash],
            fromBlock,
            toBlock
          });

          console.log(`Found ${logs.length} historical TopUp events in this batch.`);
          
          for (const log of logs) {
            try {
              console.log(`**Processing historical event from tx: ${log.transactionHash}**`);
              const tx = await this.findTxByHash(log.transactionHash);
              if (!tx || ['pending', 'in-progress', 'failed'].includes(tx.state)) {
                await this.processTopUpEvent(log as EventLog);
              } else {
                console.log("tx already processed, skip tx:", log.transactionHash);
              }
            } catch (error) {
              console.error(`Error processing individual event ${log.transactionHash}:`, error);
              // Continue with next event even if current one fails
              console.log('======================\n');
              continue;
            }
          }
        } catch (error) {
          console.error(`Error processing batch ${fromBlock}-${toBlock}:`, error);
          // Continue with next batch even if current one fails
          continue;
        }
      }
      
      console.log('Historical TopUp events processing completed.');
    } catch (error) {
      console.error('Error retrieving historical TopUp events:', error);
    } finally {
      console.log('Historical event processing finished, setting up real-time listeners...');
    }
  }

  async serve() {
    const dbName = `${this.config.settlementContractAddress}_deposit`;
    
    await mongoose.connect(this.config.mongoUri, {
      dbName,
    });
    console.log('Deposit service started - MongoDB connected');

    console.log("Installing admin...");
    await this.createPlayer(this.admin);

    console.log("Processing historical TopUp events...");
    await this.getHistoricalTopUpEvents();

    console.log("Setting up polling for new events...");
    let lastProcessedBlock = await this.provider.getBlockNumber();
    let isProcessing = false; 
    
    const poll = async () => {
        if (isProcessing) {
            console.log("[Poll] Previous polling still in progress, skipping this round");
            console.log("======================\n");
            return;
        }

        console.log("======================");
        console.log("[Poll] Starting new polling round...");
        isProcessing = true;
        try {
            let retries = 3;
            while (retries > 0) {
                try {
                    const currentBlock = await this.provider.getBlockNumber();
                    console.log(`[Poll] Current block: ${currentBlock}, Last processed block: ${lastProcessedBlock}`);
                    
                    if (currentBlock > lastProcessedBlock) {
                        console.log(`[Poll] Processing blocks from ${lastProcessedBlock + 1} to ${currentBlock} (${currentBlock - lastProcessedBlock} blocks)`);
                        
                        const topUpEvent = abiData.abi.find(
                          (item: any) => item.type === 'event' && item.name === 'TopUp'
                        );
                        if (!topUpEvent) {
                          throw new Error('TopUp event not found in ABI');
                        }
                        const eventHash = ethers.id(`${topUpEvent.name}(${topUpEvent.inputs.map((input: any) => input.type).join(',')})`);
                        
                        // Process in smaller batches to avoid exceeding provider limits
                        const maxBatchSize = 25000;
                        let processedLogs: EventLog[] = [];
                        
                        for (let fromBlock = lastProcessedBlock + 1; fromBlock <= currentBlock; fromBlock += maxBatchSize) {
                            const toBlock = Math.min(fromBlock + maxBatchSize - 1, currentBlock);
                            console.log(`[Poll] Querying batch from block ${fromBlock} to ${toBlock}`);
                            
                            const batchLogs = await this.provider.getLogs({
                                address: this.config.settlementContractAddress,
                                topics: [eventHash],
                                fromBlock,
                                toBlock
                            });
                            
                            processedLogs = [...processedLogs, ...batchLogs as EventLog[]];
                        }

                        console.log(`[Poll] Found ${processedLogs.length} TopUp events in new blocks`);

                        for (const log of processedLogs) {
                          console.log(`[Poll] Processing event from block ${log.blockNumber}, tx: ${log.transactionHash}`);
                          await this.processTopUpEvent(log as EventLog);
                        }

                        console.log(`[Poll] Successfully updated lastProcessedBlock from ${lastProcessedBlock} to ${currentBlock}`);
                        lastProcessedBlock = currentBlock;
                    } else {
                        console.log(`[Poll] No new blocks to process`);
                    }
                    break;
                } catch (error) {
                    retries--;
                    console.error(`[Poll] Error during polling: ${error}`);
                    if (retries === 0) {
                        console.error('[Poll] Failed after all retry attempts');
                    } else {
                        console.log(`[Poll] Retry attempt ${3 - retries} of 3 after 2 seconds`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }
        } finally {
            console.log("[Poll] Polling round completed");
            console.log("======================\n");
            isProcessing = false;
        }
    };

    const scheduleNextPoll = () => {
        setTimeout(async () => {
            await poll();
            scheduleNextPoll();
        }, 30000);
    };

    scheduleNextPoll();
    console.log('Event polling setup successfully');
  }
}
