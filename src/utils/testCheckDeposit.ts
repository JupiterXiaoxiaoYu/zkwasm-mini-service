import { ZKWasmAppRpc, PlayerConvention, createCommand } from "zkwasm-minirollup-rpc";
import dotenv from 'dotenv';

dotenv.config();

const CMD_WITHDRAW = 6n;
const CMD_DEPOSIT = 7n;
const CMD_INSTALL_PLAYER = 1n;

class Player extends PlayerConvention {
  constructor(key: string, rpc: ZKWasmAppRpc) {
    super(key, rpc, CMD_DEPOSIT, CMD_WITHDRAW);
    this.processingKey = key;
    this.rpc = rpc;
  }
  async installPlayer() {
    try {
        let result = await this.rpc.sendTransaction(createCommand(0n, CMD_INSTALL_PLAYER, []), this.processingKey);
        return result;
    }
    catch (e) {
        if (e instanceof Error) {
            console.log(e.message);
        }
        console.log("installPlayer error at processing key:", this.processingKey);
    }
}
}

async function main() {
  try {
    const rpc = new ZKWasmAppRpc("http://127.0.0.1:3000");
    
    if (!process.env.SERVER_ADMIN_KEY) {
      throw new Error("SERVER_ADMIN_KEY not found in environment variables");
    }
    const admin = new Player(process.env.SERVER_ADMIN_KEY, rpc);
    
    console.log("Installing admin...");
    await admin.installPlayer();
    
    const nonce = await admin.getNonce();
    console.log("Got nonce:", nonce.toString());

    const pid_1 = 1n;
    const pid_2 = 2n;

    console.log("Executing deposit...");
    console.log("Parameters:", {
      pid_1: pid_1,
      pid_2: pid_2,
      tokenIndex: "0",
      amount: "1"
    });
    
    const depositResult = await admin.deposit(nonce, pid_1, pid_2, 0n, 1n);
    console.log("Deposit result:", depositResult);
    
    console.log("Checking deposit...");
    const checkResult = await admin.checkDeposit(nonce, pid_1, pid_2, 0n, 1n);
    console.log("Check deposit result:", JSON.stringify(checkResult));
    
    if (checkResult) {
      console.log("✅ Deposit check successful!");
    } else {
      console.log("❌ Deposit check failed!");
    }
    
  } catch (error) {
    console.error("Error occurred:", error);
    process.exit(1);
  }
}

main().catch(console.error);
