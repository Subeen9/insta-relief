import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator, collection, addDoc } from "firebase/firestore";

const app = initializeApp({ projectId: 'insurance-1a234' });
const db = getFirestore(app);

connectFirestoreEmulator(db, 'localhost', 8081);

async function seedData() {
  try {
    const users = [
      {
        zip: '70401',
        status: 'ACTIVE',
        phone: '+13379444462',
        balance: 0,
        firstName: 'Niraj',
        lastName: 'Bhatta',
        email: 'niraj.bhatta@selu.edu',
        policyId: 'POL-70401-W8ZK7',
        isActivated: true,
        createdAt: '2025-11-11T01:14:03.006Z'
      },
      {
        zip: '70401',
        status: 'ACTIVE',
        phone: '+19856870746',
        balance: 0,
        firstName: 'Aakash',
        lastName: 'Poudel',
        email: 'aakash.poudel@selu.edu',
        policyId: 'POL-70401-232DE',
        isActivated: true,
        createdAt: '2025-11-11T19:36:09.646Z'
      }
    ];

    for (const user of users) {
      const docRef = await addDoc(collection(db, 'users'), user);
      console.log(`✅ Added ${user.firstName} ${user.lastName} with ID: ${docRef.id}`);
    }
    
    console.log(`\n🎉 Successfully seeded ${users.length} users!`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding data:', error);
    process.exit(1);
  }
}

seedData();