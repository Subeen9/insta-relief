import { initializeApp } from "firebase/app";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";



const firebaseConfig = {
  apiKey: process.env.VITE_API_KEY,
  authDomain: process.env.VITE_AUTH_DOMAIN,
  projectId: 'insurance-1a234',
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

// connect to local emulator
connectFunctionsEmulator(functions, "localhost", 5001);

const simulate = httpsCallable(functions, "disaster");

simulate({ zip: "70401" })
  .then((res) => {
    console.log("Response:", res.data);
  })
  .catch((err) => {
    console.error("Error:", err);
  });
