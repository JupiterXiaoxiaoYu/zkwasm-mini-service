import BN from "bn.js";

interface ProofArgs {
  txData: Uint8Array;
  proofArr: Array<string>;
  verifyInstanceArr: Array<string>;
  auxArr: Array<string>;
  instArr: Array<string>;
}

/**
 * Extract merkle_root from attributes based on contract logic
 * The contract calculates merkle_root as:
 * merkle_root = (instances[0][0] << 192) + (instances[0][1] << 128) + (instances[0][2] << 64) + instances[0][3]
 */
export function extractMerkleRoot(attributes: ProofArgs): string {
  const instArr = attributes.instArr;
  
  // Ensure we have at least 4 elements
  if (instArr.length < 4) {
    throw new Error('instArr must have at least 4 elements to calculate merkle_root');
  }

  // Convert string numbers to BN for precise arithmetic
  const inst0 = new BN(instArr[0], 10);
  const inst1 = new BN(instArr[1], 10);
  const inst2 = new BN(instArr[2], 10);
  const inst3 = new BN(instArr[3], 10);

  // Calculate merkle_root using the same formula as the contract
  // merkle_root = (instances[0][0] << 192) + (instances[0][1] << 128) + (instances[0][2] << 64) + instances[0][3]
  const merkleRoot = inst0.shln(192)
    .add(inst1.shln(128))
    .add(inst2.shln(64))
    .add(inst3);

  // Convert to hex string with 0x prefix and pad to 64 characters (32 bytes)
  return '0x' + merkleRoot.toString('hex', 64);
}

/**
 * Extract new merkle_root from attributes based on contract logic
 * The contract calculates new_merkle_root as:
 * new_merkle_root = (instances[0][4] << 192) + (instances[0][5] << 128) + (instances[0][6] << 64) + instances[0][7]
 */
export function extractNewMerkleRoot(attributes: ProofArgs): string {
  const instArr = attributes.instArr;
  
  // Ensure we have at least 8 elements
  if (instArr.length < 8) {
    throw new Error('instArr must have at least 8 elements to calculate new_merkle_root');
  }

  // Convert string numbers to BN for precise arithmetic
  const inst4 = new BN(instArr[4], 10);
  const inst5 = new BN(instArr[5], 10);
  const inst6 = new BN(instArr[6], 10);
  const inst7 = new BN(instArr[7], 10);

  // Calculate new_merkle_root using the same formula as the contract
  const newMerkleRoot = inst4.shln(192)
    .add(inst5.shln(128))
    .add(inst6.shln(64))
    .add(inst7);

  // Convert to hex string with 0x prefix and pad to 64 characters (32 bytes)
  return '0x' + newMerkleRoot.toString('hex', 64);
}

/**
 * Extract SHA256 hash from attributes based on contract logic
 * The contract calculates sha_pack as:
 * sha_pack = (instances[0][8] << 192) + (instances[0][9] << 128) + (instances[0][10] << 64) + instances[0][11]
 */
export function extractShaHash(attributes: ProofArgs): string {
  const instArr = attributes.instArr;
  
  // Ensure we have at least 12 elements
  if (instArr.length < 12) {
    throw new Error('instArr must have at least 12 elements to calculate sha_pack');
  }

  // Convert string numbers to BN for precise arithmetic
  const inst8 = new BN(instArr[8], 10);
  const inst9 = new BN(instArr[9], 10);
  const inst10 = new BN(instArr[10], 10);
  const inst11 = new BN(instArr[11], 10);

  // Calculate sha_pack using the same formula as the contract
  const shaPack = inst8.shln(192)
    .add(inst9.shln(128))
    .add(inst10.shln(64))
    .add(inst11);

  // Convert to hex string with 0x prefix and pad to 64 characters (32 bytes)
  return '0x' + shaPack.toString('hex', 64);
}

// Example usage function
export function demonstrateExtraction() {
  const attributes: ProofArgs = {
    txData: new Uint8Array([0]),
    proofArr: [
      '8616847292436121506225116886879389241408148387227531726144069501485748063696',
      '5944414084717638220207938580894927542561920377599712196916101891423488647917',
      '9394151760810956454082831204594861363155626796585262211044175337230561037069',
      '9572072379454671757175694479777308928773235021491543469020653750099920366813',
      '359502339310372794448080946641052292564451251855355852389544175089385597120',
      '18650440475011187345786013936781156087169751133808380324036509780693719904447',
      '13510015538112865969384824230165999801092404750643980025860133685479958923620',
      '13043161287223862017616437051153496980988032395187919785264077825262604585137',
      '13662589686195534049327551177786419260433395812793813907314819464508818340045',
      '12127496010745675543031737939500306266515118434902576965954570596546147764295',
      '7137158877616352982522040630207941888425911572218794450059723278525918350921',
      '16633272954083664385998539764977021933844702071802718992906054914872879916417',
      '21340717893279803317536350619876050278897515376548583569474913803193940769860'
    ],
    verifyInstanceArr: [
      '4199904769602509889033946710690172922508734067591181219452106015687690490079',
      '20802211221328652177297684105900349675903871727769100358936662153',
      '36368877865316281906989611993215952142350462122277898956492965051',
      '9356484595748762740153221808653096147207497'
    ],
    auxArr: ['1'],
    instArr: [
      '910400006888094404',
      '18142358643817710901',
      '11743083299358509370',
      '557062474596129021',
      '15610985209716397462',
      '14566187743782344128',
      '5237131197396905609',
      '288166984414608746',
      '16406829232824261652',
      '11167788843400149284',
      '2859295262623109964',
      '11859553537011923029'
    ]
  };

  console.log('Extracting values from attributes...');
  console.log('Current merkle_root:', extractMerkleRoot(attributes));
  console.log('New merkle_root:', extractNewMerkleRoot(attributes));
  console.log('SHA256 hash:', extractShaHash(attributes));
}

// Run demonstration if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateExtraction();
} 