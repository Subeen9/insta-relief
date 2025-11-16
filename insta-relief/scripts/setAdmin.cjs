

const admin = require('firebase-admin');
const path = require('path');

try {
  const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  
  console.log(' Firebase Admin initialized successfully');
} catch (error) {
  process.exit(1);
}

/**
 * Set admin for a user
 */
async function setAdmin(email) {
  try {
    
    const user = await admin.auth().getUserByEmail(email);
    
    await admin.auth().setCustomUserClaims(user.uid, { admin: true });
    console.log(`Admin  set successfully!`);
    
    const userRecord = await admin.auth().getUser(user.uid);
    console.log('\n User details:');
    console.log(`   - UID: ${userRecord.uid}`);
    console.log(`   - Email: ${userRecord.email}`);
    console.log(`   - Custom claims:`, userRecord.customClaims);
    console.log('  You must sign out and sign back in for changes to take effect!');
    
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.error(` Error: No user found with email ${email}`);
      console.error('  Make sure the user has created an account first');
    } else {
      console.error(' Error setting admin claim:', error.message);
    }
    process.exit(1);
  }
}

/**
 * Remove admin  from a user
 */
async function removeAdmin(email) {
  try {
    
    const user = await admin.auth().getUserByEmail(email);
    
    await admin.auth().setCustomUserClaims(user.uid, { admin: false });
    console.log(` Admin removed successfully!`);
    
  } catch (error) {
    console.error('Error removing admin claim:', error.message);
    process.exit(1);
  }
}

/**
 * List all admin users
 */
async function listAdmins() {
  try {
    
    let admins = [];
    const listUsersResult = await admin.auth().listUsers(1000);
    
    listUsersResult.users.forEach((userRecord) => {
      if (userRecord.customClaims && userRecord.customClaims.admin === true) {
        admins.push({
          email: userRecord.email,
          uid: userRecord.uid,
          created: userRecord.metadata.creationTime
        });
      }
    });
    
    if (admins.length === 0) {
      console.log('No admin users found.');
    } else {
      console.log(`Found ${admins.length} admin(s):\n`);
      admins.forEach((admin, index) => {
        console.log(`${index + 1}. ${admin.email}`);
        console.log(`   UID: ${admin.uid}`);
        console.log(`   Created: ${admin.created}\n`);
      });
    }
    
  } catch (error) {
    process.exit(1);
  }
}


const args = process.argv.slice(2);
const command = args[0];
const email = args[1];

if (!command) {
  console.log(`
Firebase Admin User Management Script

Usage:
  node scripts/setAdmin.js add <email>      - Grant admin privileges
  node scripts/setAdmin.js remove <email>   - Remove admin privileges
  node scripts/setAdmin.js list             - List all admins
  `);
  process.exit(0);
}

if (command === 'list') {
  listAdmins().then(() => process.exit());
} else if (command === 'add' && email) {
  setAdmin(email).then(() => process.exit());
} else if (command === 'remove' && email) {
  removeAdmin(email).then(() => process.exit());
} else {
  console.log('Run without arguments to see usage instructions');
  process.exit(1);
}