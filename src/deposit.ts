import { ZKWasmAppRpc, PlayerConvention } from "zkwasm-minirollup-rpc";
import { ethers, EventLog } from "ethers";
import abiData from './utils/Proxy.json' assert { type: 'json' };
import mongoose from 'mongoose';

// Mongoose Schema and Model for saving tx hashes and state
const txSchema = new mongoose.Schema({
  txHash: { type: String, required: true, unique: true },
  state: { type: String, enum: ['pending', 'in-progress', 'completed', 'failed'], default: 'pending' },
  timestamp: { type: Date, default: Date.now },
  l1token: { type: String, required: true },
  address: { type: String, required: true },
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
  }
});

txSchema.set('toJSON', { getters: true });
txSchema.set('toObject', { getters: true });

const TxHash = mongoose.model('TxHash', txSchema);

export class Deposit {
  private rpc: ZKWasmAppRpc;
  private admin: PlayerConvention;
  private provider: ethers.JsonRpcProvider;
  private proxyContract: ethers.Contract;
  private config: {
    rpcProvider: string;
    serverAdminKey: string;
    settlementContractAddress: string;
    mongoUri: string;
    zkwasmRpcUrl?: string;
    withdrawOpcode: string;
    depositOpcode: string;
  };

  constructor(config: {
    rpcProvider: string;
    serverAdminKey: string;
    settlementContractAddress: string;
    mongoUri: string;
    zkwasmRpcUrl?: string;
    withdrawOpcode: string;
    depositOpcode: string;
  }) {
    this.config = config;
    this.rpc = new ZKWasmAppRpc(config.zkwasmRpcUrl || "http://localhost:3000");
    
    this.provider = new ethers.JsonRpcProvider(config.rpcProvider);
    
    // Convert string to BigInt
    const WITHDRAW = BigInt(config.withdrawOpcode);
    const DEPOSIT = BigInt(config.depositOpcode);
    
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
      await TxHash.updateOne({ txHash }, { state });
      console.log(`Transaction state updated to: ${state} for txHash: ${txHash}`);
    } catch (error) {
      console.error(`Failed to update tx state for txHash ${txHash}: ${(error as Error).message}`);
    }
  }

  private async processTopUpEvent(event: EventLog) {
    try {
      const decodedEvent = this.proxyContract.interface.parseLog({
        topics: event.topics,
        data: event.data
      });
      
      if (!decodedEvent) {
        console.error('Failed to decode event');
        return;
      }

      const [l1token, address, pid_1, pid_2, amount] = decodedEvent.args;

      console.log(`TopUp event received: pid_1=${pid_1.toString()}, pid_2=${pid_2.toString()}, amount=${amount.toString()} wei`);

      let tokenindex: bigint = -1n;
      const tokens = await this.proxyContract.allTokens();
      for (let i = 0; i < tokens.length; i++) {
        if (l1token === tokens[i].token_uid) {
          tokenindex = BigInt(i);
          break;
        }
      }
      
      if (tokenindex === -1n) {
        console.log('Skip: token not found in contract:', l1token);
        return;
      }

      let tx = await this.findTxByHash(event.transactionHash);
      
      if (!tx) {
        console.log(`Transaction hash not found: ${event.transactionHash}`);
        tx = new TxHash({
          txHash: event.transactionHash,
          state: 'pending',
          l1token,
          address,
          pid_1,
          pid_2,
          amount: amount / BigInt(10 ** 18),
        });
        await tx.save();
        console.log(`Transaction hash and details saved: ${event.transactionHash}`);
      } else {
        console.log(`TxHash ${event.transactionHash} already exists in the DB with state: ${tx.state}`);
      }

      if (tx && (tx.state === 'pending' || tx.state === 'failed')) {
        try {
          await this.updateTxState(event.transactionHash, 'in-progress');
          console.log('Transaction state updated to "in-progress".');

          let amountInEther = amount / BigInt(10 ** 18);
          console.log("Deposited amount (in ether): ", amountInEther);
          if (amountInEther < 1n) {
            console.error(`--------------Skip: Amount must be at least 1 Titan (in ether instead of wei) ${event.transactionHash}\n`);
          } else {
            const depositResult = await this.admin.deposit(pid_1, pid_2, tokenindex, amountInEther);
            if (!depositResult) {
              throw new Error(`Deposit failed for transaction ${event.transactionHash}`);
            }
            console.log("deposit params, pid_1:", pid_1, "pid_2:", pid_2, "tokenIndex:", tokenindex, "amount:", amountInEther);
            console.log(`------------------Deposit successful! ${event.transactionHash}\n`);
          }
          await this.updateTxState(event.transactionHash, 'completed');
        } catch (error) {
          console.error('Error during deposit:', error);
          await this.updateTxState(event.transactionHash, 'failed');
          throw error; // Re-throw the error to ensure it's properly handled
        }
      } else if (tx.state === 'in-progress'){
        while(1) {
          console.log("in-progress, something wrong happen, should manuel check retry or skip tx");
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } else {
        if (tx.state != 'completed') {
          while(1) {
            console.log("shouldn't arrive here");
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
    } catch (error) {
      console.error('Error processing TopUp event:', error);
      throw error; // Re-throw the error to ensure it's properly handled
    }
  }

  private async getHistoricalTopUpEvents() {
    try {
      console.log("get block number...");
      const latestBlock = await this.provider.getBlockNumber();
      const batchSize = 50000;
      const totalBlocksToScan = 200000;
      const startBlock = Math.max(0, latestBlock - totalBlocksToScan);
      
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
            console.log(`Processing historical event from tx: ${log.transactionHash}`);
            const tx = await this.findTxByHash(log.transactionHash);
            if (!tx || ['pending', 'failed'].includes(tx.state)) {
              await this.processTopUpEvent(log as EventLog);
            }
          }
        } catch (error) {
          console.error(`Error processing batch ${fromBlock}-${toBlock}:`, error);
          continue; // Continue processing the next batch
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
    
    // Connect to MongoDB
    await mongoose.connect(this.config.mongoUri, {
      dbName,
    });
    console.log('Deposit service started - MongoDB connected');

    // Initialize admin
    console.log("Installing admin...");
    await this.createPlayer(this.admin);

    // Process historical events first
    console.log("Processing historical TopUp events...");
    await this.getHistoricalTopUpEvents();

    console.log("Setting up polling for new events...");
    let lastProcessedBlock = await this.provider.getBlockNumber();
    
    setInterval(async () => {
      let retries = 3;
      while (retries > 0) {
        try {
          const currentBlock = await this.provider.getBlockNumber();
          if (currentBlock > lastProcessedBlock) {
            console.log(`Checking new blocks from ${lastProcessedBlock + 1} to ${currentBlock}`);
            
            const topUpEvent = abiData.abi.find(
              (item: any) => item.type === 'event' && item.name === 'TopUp'
            );
            if (!topUpEvent) {
              throw new Error('TopUp event not found in ABI');
            }
            const eventHash = ethers.id(`${topUpEvent.name}(${topUpEvent.inputs.map((input: any) => input.type).join(',')})`);
            
            const logs = await this.provider.getLogs({
              address: this.config.settlementContractAddress,
              topics: [eventHash],
              fromBlock: lastProcessedBlock + 1,
              toBlock: currentBlock
            });

            for (const log of logs) {
              console.log('New TopUp event detected:', log);
              await this.processTopUpEvent(log as EventLog);
            }

            lastProcessedBlock = currentBlock;
          }
          break; 
        } catch (error) {
          retries--;
          if (retries === 0) {
            console.error('Error polling for new events after all retries:', error);
          } else {
            console.log(`Retry attempt remaining: ${retries}`);
            await new Promise(resolve => setTimeout(resolve, 2000)); 
          }
        }
      }
    }, 30000); 


    console.log('Event polling setup successfully');
  }
}