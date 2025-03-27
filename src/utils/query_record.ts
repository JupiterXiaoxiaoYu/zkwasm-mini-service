import mongoose from 'mongoose';
import { modelBundle } from "./config.js";

const mongoUri = "mongodb://localhost"; // Replace with your MongoDB URI
const taskId = "67a1e3f0e2dc2c324760d1de"; // Replace with the taskId you want to query

async function queryRecord(taskId: string) {
  try {
    // Connect to MongoDB
    await mongoose.connect(mongoUri);
    console.log('MongoDB connected successfully');

    // Query the record
    const record = await modelBundle.findOne({ taskId: taskId });
    
    if (record) {
      console.log('Record found:', {
        taskId: record.taskId,
        merkleRoot: record.merkleRoot,
        settleTxHash: record.settleTxHash,
        settleStatus: record.settleStatus,
        withdrawArray: record.withdrawArray
      });
      return record;
    } else {
      console.log('No record found for taskId:', taskId);
      return null;
    }

  } catch (error) {
    console.error('Error querying record:', error);
    throw error;
  } finally {
    // Close the MongoDB connection
    await mongoose.disconnect();
    console.log('MongoDB disconnected');
  }
}

async function queryLatestRecords() {
  try {
    // Connect to MongoDB
    await mongoose.connect(mongoUri);
    console.log('MongoDB connected successfully');

    // Query latest 10 records
    const records = await modelBundle.find({})
      .sort({ _id: -1 }) // Sort by _id in descending order, newest first
      .limit(10);
    
    console.log('\nLatest 10 records:');
    records.forEach((record, index) => {
      console.log(`\n${index + 1}. Record:`, {
        taskId: record.taskId,
        merkleRoot: record.merkleRoot,
        settleTxHash: record.settleTxHash,
        settleStatus: record.settleStatus,
        withdrawArray: record.withdrawArray
      });
    });

    return records;
  } catch (error) {
    console.error('Error querying latest records:', error);
    throw error;
  } finally {
    // Close the MongoDB connection
    await mongoose.disconnect();
    console.log('MongoDB disconnected');
  }
}

// Run queries
async function main() {
  // First query the specified taskId
  await queryRecord(taskId);
  
  // Then query the latest 10 records
  await queryLatestRecords();
}

main().catch(console.error);

// Example usage:
/*
const config = {
  mongoUri: "mongodb://localhost:27017/your_database"
};

async function main() {
  const query = new RecordQuery(config);
  const record = await query.queryByTaskId("your_task_id");
}

main().catch(console.error);
*/ 