import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { User } from './models/User.js';
import { generateDID } from './services/didService.js';
import { enrollFingerprint, getUserBiometricTemplate } from './services/biometricService.js';

dotenv.config({ quiet: true });

const users = [
  {
    name: 'Dealer Demo',
    email: 'dealer@biochain.com',
    password: 'dealer123',
    role: 'dealer',
    phone: '9876543210',
    address: 'Bengaluru',
    state: 'Karnataka',
    district: 'Bengaluru Urban',
    dealerDetails: {
      businessName: 'BioChain Dealer Demo',
      gstin: '29ABCDE1234F1Z2',
      tin: 'TIN1001',
      showroomAddress: 'Bengaluru',
      contactPerson: 'Dealer Demo',
      contactPhone: '9876543210',
      contactEmail: 'dealer@biochain.com',
      phone: '9876543210',
      licenseNumber: 'DL-1001',
    },
  },
  {
    name: 'Owner Demo',
    email: 'owner@biochain.com',
    password: 'owner123',
    role: 'owner',
    phone: '9876543211',
    address: 'Bengaluru',
    state: 'Karnataka',
    district: 'Bengaluru Urban',
    aadhaarNumber: '123456789012',
    dlNumber: 'KA1234567890',
  },
  {
    name: 'Karnataka RTO Demo',
    email: 'ka.rto@biochain.com',
    password: 'ka123',
    role: 'rto',
    phone: '9876543212',
    address: 'Bengaluru',
    state: 'Karnataka',
    district: 'Bengaluru Urban',
    rtoDetails: {
      stateCode: 'KA',
      stateName: 'Karnataka',
      district: 'Bengaluru Urban',
      rtoOfficeCode: 'KA-01',
      rtoOfficeName: 'Bangalore Central RTO',
      designation: 'RTO Officer',
      employeeId: 'KA-EMP-001',
      officeAddress: 'Bengaluru',
      jurisdiction: 'Bengaluru Urban',
    },
  },
  {
    name: 'Tamil Nadu RTO Demo',
    email: 'tn.rto@biochain.com',
    password: 'tn123',
    role: 'rto',
    phone: '9876543213',
    address: 'Chennai',
    state: 'Tamil Nadu',
    district: 'Chennai',
    rtoDetails: {
      stateCode: 'TN',
      stateName: 'Tamil Nadu',
      district: 'Chennai',
      rtoOfficeCode: 'TN-01',
      rtoOfficeName: 'Chennai RTO',
      designation: 'RTO Officer',
      employeeId: 'TN-EMP-001',
      officeAddress: 'Chennai',
      jurisdiction: 'Chennai',
    },
  },
  {
    name: 'Police Demo',
    email: 'police@biochain.com',
    password: 'police123',
    role: 'police',
    phone: '9876543214',
    address: 'Bengaluru',
    state: 'Karnataka',
    district: 'Bengaluru Urban',
    badgeNumber: 'POL-1001',
  },
];

const ensureBiometricEnrolment = async (user) => {
  // The id on the account is only a pointer; the enrolment has to exist in the
  // durable store. Accounts seeded before it did - or whose template was dropped
  // with the session - are re-enrolled here, so a pointer never dangles.
  if (user.fingerprintTemplateId) {
    const existing = await getUserBiometricTemplate(user._id.toString());
    if (existing) return false;
  }
  try {
    const templateId = await enrollFingerprint(user._id.toString(), null);
    user.fingerprintTemplateId = templateId;
    user.biometricData = { fingerprint: templateId, lastEnrolled: new Date() };
    return true;
  } catch (err) {
    console.log(`  biometric enrollment skipped for ${user.email}: ${err.message}`);
    return false;
  }
};

const giveIdentity = async (user) => {
  // Mirrors what registration does for a real account: a stored fingerprint
  // template and a decentralized identifier. Demo accounts created before those
  // steps existed are topped up here, so a reviewer sees the same identity
  // features on a demo login as on a freshly registered one. Idempotent - an
  // account that already has both is left untouched.
  let changed = await ensureBiometricEnrolment(user);

  if (!user.did?.identifier) {
    try {
      const didData = await generateDID(user._id.toString(), user.role);
      user.did = {
        identifier: didData.did,
        biochainDid: didData.biochainDid,
        document: didData.didDocument,
        createdAt: new Date(),
      };
      if (!user.blockchainWalletAddress) user.blockchainWalletAddress = didData.address;
      changed = true;
    } catch (err) {
      console.log(`  DID generation skipped for ${user.email}: ${err.message}`);
    }
  }

  if (changed) {
    await user.save();
    console.log(`  identity completed for ${user.email}: DID ${user.did?.identifier || '-'}`);
  }
};

const seedUsers = async () => {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/biochain_rto';

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB for demo seeding');

  // Idempotent: skip users that already exist (never delete live demo data)
  const emails = users.map((u) => u.email);
  const existing = await User.find({ email: { $in: emails } });
  const existingEmails = new Set(existing.map((u) => u.email));

  for (const userData of users) {
    if (existingEmails.has(userData.email)) {
      console.log(`Skipped existing demo user: ${userData.email}`);
      continue;
    }
    const passwordHash = await bcrypt.hash(userData.password, 10);
    const user = new User({
      ...userData,
      passwordHash,
    });

    await user.save();
    console.log(`Created demo user: ${userData.email}`);
    await giveIdentity(user);
  }

  // Backfill accounts seeded by an earlier version of this script.
  for (const user of existing) {
    await giveIdentity(user);
  }

  // Accounts created by another route (a test run, a live registration) are not
  // part of the demo list, but a dangling fingerprint pointer on one of them
  // would make biometric checks fail in silence. Heal every account, not only
  // the seeded five.
  for (const user of await User.find({})) {
    if (existingEmails.has(user.email)) continue;
    if (await ensureBiometricEnrolment(user)) {
      await user.save();
      console.log(`  fingerprint enrolment restored for ${user.email}`);
    }
  }

  // Any account left by an older seed with a blank string in a unique-indexed
  // identity field is repaired here, so the index can stay in place and still
  // mean what it says. One field at a time: a single $unset covering all of them
  // would wipe the real value on another field of the same account.
  for (const field of ['rtoDetails.employeeId', 'aadhaarNumber', 'dlNumber', 'did.identifier', 'did.biochainDid']) {
    const res = await mongoose.connection.db.collection('users').updateMany(
      { [field]: { $in: ['', '   '] } },
      { $unset: { [field]: '' } },
    );
    if (res.modifiedCount) {
      console.log(`Cleared blank ${field} on ${res.modifiedCount} account(s) so the unique index stays meaningful`);
    }
  }

  console.log('Demo users seed complete');
  await mongoose.disconnect();
  process.exit(0);
};

seedUsers().catch((err) => {
  console.error('Demo seed failed:', err);
  process.exit(1);
});
