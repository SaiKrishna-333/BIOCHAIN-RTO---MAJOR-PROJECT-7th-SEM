const vehicle = {
  id: 'VHC-1001',
  regNumber: 'KA01AB1234',
  chassisNumber: 'CHS-998877',
  engineNumber: 'ENG-774455',
  make: 'Hyundai',
  model: 'Creta',
  year: 2023,
  currentOwner: 'owner@biochain.com',
  state: 'KA',
  status: 'active',
  documents: {
    rc: true,
    insurance: true,
    puc: true,
    noDues: true,
  },
};

const rtoUsers = {
  KA: {
    email: 'ka.rto@biochain.com',
    name: 'Karnataka RTO Officer',
    stateCode: 'KA',
  },
  TN: {
    email: 'tn.rto@biochain.com',
    name: 'Tamil Nadu RTO Officer',
    stateCode: 'TN',
  },
};

const targetState = 'TN';

const generateVehiclePassport = (vehicleData) => {
  return {
    passportId: 'PPT-' + Date.now(),
    vehicle: {
      regNumber: vehicleData.regNumber,
      chassisNumber: vehicleData.chassisNumber,
      engineNumber: vehicleData.engineNumber,
      make: vehicleData.make,
      model: vehicleData.model,
      year: vehicleData.year,
      currentState: vehicleData.state,
    },
    ownership: {
      currentOwner: vehicleData.currentOwner,
      verified: true,
    },
    status: {
      current: vehicleData.status,
      stolen: false,
      blocked: false,
    },
    documents: vehicleData.documents,
    generatedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
};

const createTransferRequest = () => {
  return {
    requestId: 'ITR-' + Date.now(),
    vehicleId: vehicle.id,
    fromState: vehicle.state,
    toState: targetState,
    owner: vehicle.currentOwner,
    status: 'pending',
    sourceRTOApproval: { status: 'pending' },
    destinationRTOApproval: { status: 'pending' },
    newRegNumber: null,
  };
};

const simulateInterStateTransfer = () => {
  const passport = generateVehiclePassport(vehicle);
  const request = createTransferRequest();

  console.log('\n=== Interstate Vehicle Transfer Demo ===\n');
  console.log('1. Owner requests transfer');
  console.log(`   Owner: ${vehicle.currentOwner}`);
  console.log(`   Vehicle: ${vehicle.regNumber} from ${vehicle.state} to ${targetState}`);

  console.log('\n2. Vehicle validation');
  console.log(`   Ownership verified: ${vehicle.currentOwner}`);
  console.log(`   Vehicle status: ${vehicle.status}`);
  console.log(`   Theft/block status: false`);

  console.log('\n3. Passport generated');
  console.log(JSON.stringify({ passportId: passport.passportId, vehicle: passport.vehicle }, null, 2));

  console.log('\n4. Source RTO approval (Karnataka)');
  request.sourceRTOApproval = {
    status: 'approved',
    officer: rtoUsers.KA.email,
    remarks: 'NOC approved. Vehicle clear for transfer.'
  };
  request.status = 'source_rto_approved';
  console.log(`   Approver: ${rtoUsers.KA.email}`);
  console.log(`   Result: ${request.sourceRTOApproval.status}`);

  console.log('\n5. Destination RTO approval (Tamil Nadu)');
  request.destinationRTOApproval = {
    status: 'approved',
    officer: rtoUsers.TN.email,
    remarks: 'Registration accepted in destination state.'
  };
  request.newRegNumber = 'TN09CD9876';
  request.status = 'approved';
  console.log(`   Approver: ${rtoUsers.TN.email}`);
  console.log(`   New registration number: ${request.newRegNumber}`);

  console.log('\n6. Blockchain record');
  const blockchainTxn = {
    txHash: '0x' + Math.random().toString(16).slice(2, 66),
    explorerUrl: 'https://amoy.polygonscan.com/tx/' + '0x' + Math.random().toString(16).slice(2, 66),
    status: 'confirmed',
  };

  console.log(`   Transaction hash: ${blockchainTxn.txHash}`);
  console.log(`   Explorer link: ${blockchainTxn.explorerUrl}`);

  console.log('\n7. Final state');
  console.log(JSON.stringify({
    requestId: request.requestId,
    status: request.status,
    vehicleState: 'TN',
    newRegNumber: request.newRegNumber,
    blockchainRecord: blockchainTxn,
  }, null, 2));

  return {
    request,
    passport,
    blockchainTxn,
  };
};

simulateInterStateTransfer();
