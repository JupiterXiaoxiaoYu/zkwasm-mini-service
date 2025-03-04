import BN from "bn.js";
import { ethers } from "ethers";
import { ServiceHelper, get_image_md5, modelBundle, get_chain_id } from "./utils/config.js";
import abiData from './utils/Proxy.json' assert { type: 'json' };
import mongoose from 'mongoose';
import { PaginationResult, QueryParams, Task, AutoSubmitStatus, Round1Status, Round1Info } from "zkwasm-service-helper";
import { U8ArrayUtil } from './utils/lib.js';
import { decodeWithdraw} from "./utils/convention.js";

export class Settlement {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private config: {
    rpcProvider: string;
    serverAdminKey: string;
    settlementContractAddress: string;
    mongoUri: string;
    settlerPrivateKey: string;
  };
  private constants: {
    proxyAddress: string;
    chainId: number;
  };

  constructor(config: {
    rpcProvider: string;
    serverAdminKey: string;
    settlementContractAddress: string;
    mongoUri: string;
    settlerPrivateKey: string;
  }) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcProvider);
    this.signer = new ethers.Wallet(config.settlerPrivateKey, this.provider);
    this.constants = {
      proxyAddress: config.settlementContractAddress,
      chainId: Number(get_chain_id()),
    };
  }

  private convertToBigUint64Array(combinedRoot: bigint): BigUint64Array {
    const result = new BigUint64Array(4);
    for (let i = 3; i >= 0; i--) {
      result[i] = combinedRoot & BigInt(2n ** 64n - 1n);
      combinedRoot = combinedRoot >> 64n;
    }
    return result;
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    retries: number = 3,
    delay: number = 2000
  ): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await operation();
      } catch (error: any) {
        if (i === retries - 1) throw error; // 如果是最后一次重试，则抛出错误
        
        console.log(`Operation failed, attempt ${i + 1}/${retries}. Retrying in ${delay/1000}s...`);
        console.log(`Error: ${error.message}`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        // 每次重试增加延迟时间
        delay *= 1.5;
      }
    }
    throw new Error('Unreachable code');
  }

  private async getMerkleArray(): Promise<BigUint64Array> {
    return this.withRetry(async () => {
      const proxy = new ethers.Contract(this.constants.proxyAddress, abiData.abi, this.provider);
      let proxyInfo = await proxy.getProxyInfo();
      console.log("Proxy Info:", proxyInfo);
      const oldRoot = proxyInfo.merkle_root;
      console.log("Type of oldRoot:", typeof oldRoot);
      console.log("Old Merkle Root:", oldRoot);
      console.log("Settle:Old Merkle Root in u64:", this.convertToBigUint64Array(oldRoot));
      return this.convertToBigUint64Array(oldRoot);
    });
  }

  private async getMerkle(): Promise<String> {
    return this.withRetry(async () => {
      const proxy = new ethers.Contract(this.constants.proxyAddress, abiData.abi, this.provider);
      let proxyInfo = await proxy.getProxyInfo();
      console.log("Proxy Info:", proxyInfo);
      const oldRoot = proxyInfo.merkle_root;
      console.log("Type of oldRoot:", typeof oldRoot);
      console.log("Old Merkle Root:", oldRoot);
      console.log("Settle:Old Merkle Root in u64:", this.convertToBigUint64Array(oldRoot));

      let bnStr = oldRoot.toString(10);
      let bn = new BN(bnStr, 10);
      let oldRootBeString = '0x' + bn.toString("hex", 64);

      console.log("Old Merkle Root(string):", oldRootBeString);
      return oldRootBeString;
    });
  }

  private async getTask(taskid: string, d_state: string|null): Promise<Task> {
    const queryParams: QueryParams = {
      id: taskid,
      tasktype: "Prove",
      taskstatus: d_state,
      user_address: null,
      md5: get_image_md5(),
      total: 1,
    };

    const response: PaginationResult<Task[]> = await ServiceHelper.loadTasks(queryParams);
    return response.data[0];
  }

  private async getTaskWithTimeout(taskId: string, timeout: number): Promise<Task | null> {
    return Promise.race([
      this.getTask(taskId, "Done"),
      new Promise(
        (resolve:(v:null)=>void, reject) => setTimeout(
          () => reject(new Error('load proof task Timeout exceeded')), timeout
        )
      )
    ]);
  }

  private async getWithdrawEventParameters(
    proxy: ethers.Contract,
    receipt: ethers.ContractTransactionReceipt
  ): Promise<any[]> {
    let r: any[] = [];
    try {
      const eventSignature = "event WithDraw(address l1token, address l1account, uint256 amount)";
      const iface = new ethers.Interface([eventSignature]);

      const logs = receipt.logs;
      logs.forEach(log => {
        try {
          const decoded = iface.parseLog(log);
          if (decoded) {
            const l1token = decoded.args.l1token;
            const l1account = decoded.args.l1account;
            const amount = decoded.args.amount;
            r.push({
              token: l1token,
              address: l1account,
              amount: amount,
            });
          }
        } catch (error) {
          console.error("Log does not match event signature:", error);
        }
      });
    } catch (error) {
      console.error('Error retrieving withdraw event parameters:', error);
    }
    return r;
  }

  private async prepareVerifyAttributesSingle(task: Task): Promise<ProofArgs> {
    let shadowInstances = task.shadow_instances;
    let batchInstances = task.batch_instances;
  
    let proofArr = new U8ArrayUtil(task.proof).toNumber();
    let auxArr = new U8ArrayUtil(task.aux).toNumber();
    let verifyInstancesArr =  shadowInstances.length === 0
      ? new U8ArrayUtil(batchInstances).toNumber()
      : new U8ArrayUtil(shadowInstances).toNumber();
    let instArr = new U8ArrayUtil(task.instances).toNumber();
    console.log("txData_orig:", task.input_context);
    let txData = new Uint8Array(task.input_context);
    console.log("txData:", txData);
    console.log("txData.length:", txData.length);
    return {
      txData: txData,
      proofArr: proofArr,
      verifyInstanceArr: verifyInstancesArr,
      auxArr: auxArr,
      instArr: instArr,
    }
  }

  private async prepareVerifyAttributesBatch(task: Task): Promise<ProofArgs> {
    let txData = new Uint8Array(task.input_context);
    const round_1_info_response = await ServiceHelper.queryRound1Info({
      task_id: task._id.$oid,
      chain_id: Number(this.constants.chainId),
      status: Round1Status.Batched,
      total: 1,
    }); 
  
    let shadowInstances = task.shadow_instances;
    let batchInstances = task.batch_instances;
  
    const round_1_output: Round1Info = round_1_info_response.data[0];
  
    let verifyInstancesArr = shadowInstances.length === 0
      ? new U8ArrayUtil(batchInstances).toNumber()
      : new U8ArrayUtil(shadowInstances).toNumber();
  
    let proofArr: string[] = [];
    for (const targetInstance of round_1_output.target_instances) {
      const siblingInstance = new U8ArrayUtil(new Uint8Array(targetInstance)).toNumber();
      proofArr.push(...siblingInstance);
    }
    
    const r1ShadowInstance = new U8ArrayUtil(new Uint8Array(round_1_output.shadow_instances!)).toNumber()[0];
    proofArr.push(r1ShadowInstance);
  
    let instArr = new U8ArrayUtil(task.instances).toNumber();
  
    const index = round_1_output.task_ids.findIndex(
      (id:any) => id === task._id["$oid"]
    );
  
    return {
      txData: txData,
      proofArr: proofArr,
      verifyInstanceArr: verifyInstancesArr,
      auxArr: [index.toString()],
      instArr: instArr,
    }
  }

  private async prepareVerifyAttributes(task: Task): Promise<ProofArgs> {
    if(task.proof_submit_mode == "Manual") {
      return await this.prepareVerifyAttributesSingle(task);
    } else {
      return await this.prepareVerifyAttributesBatch(task);
    }
  }

  private async trySettle() {
    return this.withRetry(async () => {
      let merkleRoot = await this.getMerkle();
      console.log("typeof :", typeof(merkleRoot[0]));
      console.log(merkleRoot);
      const proxy = new ethers.Contract(this.constants.proxyAddress, abiData.abi, this.signer);

      try {
        let record = await modelBundle.findOne({ merkleRoot: merkleRoot});
        if (record) {
          let taskId = record.taskId;
          let task = await this.getTaskWithTimeout(taskId, 60000);
          if (task!.proof_submit_mode == "Auto") {
            const isRegistered =
              task!.auto_submit_status === AutoSubmitStatus.RegisteredProof;

            if (!isRegistered) {
              console.log("waiting for proof to be registered ... ");
              return -1;
            }
          }

          // console.log('============')
          // console.log('here are the task',task)
          // console.log('============')

          let attributes = await this.prepareVerifyAttributes(task!);


          console.log('============')
          console.log('here are the attributes',attributes)
          console.log('============')


          const tx = await proxy.verify(
            attributes.txData,
            attributes.proofArr,
            attributes.verifyInstanceArr,
            attributes.auxArr,
            [attributes.instArr],
          );
          const receipt = await tx.wait();
          console.log("transaction:", tx.hash);
          console.log("receipt:", receipt);

          const r = decodeWithdraw(attributes.txData);
          const s = await this.getWithdrawEventParameters(proxy, receipt);
          const withdrawArray = [];
          let status = 'Done';
          if (r.length !== s.length) {
            status = 'Fail';
            console.error("Arrays have different lengths,",r,s);
          } else {
            for (let i = 0; i < r.length; i++) {
              const rItem = r[i];
              const sItem = s[i];

              if (rItem.address !== sItem.address || rItem.amount !== sItem.amount) {
                console.log("Crash(Need manual review):");
                console.error(`Mismatch found: ${rItem.address}:${rItem.amount} ${sItem.address}:${sItem.amount}`);
                while(1);
                status = 'Fail';
                break;
              } else {
                record.withdrawArray.push({
                  address: rItem.address,
                  amount: rItem.amount,
                });
              }
            }
          }
          record.settleTxHash = tx.hash;
          record.settleStatus = status;
          await record.save();
          console.log("Receipt verified");
        } else {
          console.log(`proof bundle ${merkleRoot} not found`);
        }
      } catch(e) {
        console.log("Exception happen in trySettle()");
        console.log(e);
      }
    });
  }

  async serve() {
    // Connect to MongoDB
    await mongoose.connect(this.config.mongoUri);
    console.log('Settlement service started - MongoDB connected at ', this.config.mongoUri);


    // Start monitoring and settlement
    while (true) {
      try {
        await this.trySettle();
      } catch (error) {
        console.error("Error during trySettle:", error);
      }
      await new Promise(resolve => setTimeout(resolve, 20000));
    }
  }
}

interface ProofArgs {
  txData: Uint8Array,
  proofArr: Array<string>,
  verifyInstanceArr: Array<string>,
  auxArr: Array<string>,
  instArr: Array<string>,
}
