const admin = require('firebase-admin');
const path = require('path');

try {
  const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function setAdmin(email) {
  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(user.uid, { admin: true });
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.error(`No user found with email ${email}`);
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}

async function removeAdmin(email) {
  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(user.uid, { admin: false });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

async function listAdmins() {
  try {
    const listUsersResult = await admin.auth().listUsers(1000);
    const admins = [];

    listUsersResult.users.forEach((userRecord) => {
      if (userRecord.customClaims && userRecord.customClaims.admin === true) {
        admins.push({
          email: userRecord.email,
          uid: userRecord.uid,
          created: userRecord.metadata.creationTime
        });
      }
    });

  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const command = args[0];
const email = args[1];

if (command === 'list') {
  listAdmins().then(() => process.exit());
} else if (command === 'add' && email) {
  setAdmin(email).then(() => process.exit());
} else if (command === 'remove' && email) {
  removeAdmin(email).then(() => process.exit());
} else {
  process.exit(1);
}
