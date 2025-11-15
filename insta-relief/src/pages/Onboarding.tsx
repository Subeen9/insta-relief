import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  Container,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { generatePolicyId } from "../../utils/generatePolicyId";

export default function OnboardingPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [zip, setZip] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const validateWalletAddress = (address: string): boolean => {
    if (address.length < 32 || address.length > 44) {
      return false;
    }
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
    return base58Regex.test(address);
  };

  const handleSignUp = async () => {
    if (!firstName || !lastName || !email || !password || !phone || !zip || !walletAddress) {
      alert("Please fill all fields.");
      return;
    }

    if (!validateWalletAddress(walletAddress)) {
      alert("Invalid Solana wallet address. Please check and try again.");
      return;
    }

    setLoading(true);
    try {
      const formattedPhone = phone.trim().replace(/\D/g, "");

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;

      const policyId = generatePolicyId(zip);

      await setDoc(doc(db, "users", user.uid), {
        firstName,
        lastName,
        email,
        phone: formattedPhone,
        zip,
        walletAddress,
        policyId,
        isActivated: true,
        status: "ACTIVE",
        balance: 0,
        createdAt: new Date().toISOString(),
      });

      alert("Account created successfully!");
      navigate("/dashboard");
    } catch (error: any) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container
      maxWidth="sm"
      sx={{ minHeight: "100vh", display: "flex", alignItems: "center" }}
    >
      <Card sx={{ width: "100%", p: 4, borderRadius: 3 }}>
        <CardContent>
          <Typography
            variant="h4"
            align="center"
            sx={{ mb: 3, fontWeight: 700, color: "primary.main" }}
          >
            Get Protected
          </Typography>
          <Stack spacing={3}>
            <Stack direction="row" spacing={2}>
              <TextField
                label="First Name"
                fullWidth
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
              <TextField
                label="Last Name"
                fullWidth
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </Stack>
            <TextField
              label="Email Address"
              fullWidth
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField
              label="Password"
              type="password"
              fullWidth
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <TextField
              label="Phone Number"
              fullWidth
              placeholder="e.g. 2255557890"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <TextField
              label="ZIP Code"
              fullWidth
              value={zip}
              onChange={(e) => setZip(e.target.value)}
            />
            <TextField
              label="Solana Wallet Address (Devnet)"
              fullWidth
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              placeholder="e.g., FiRnroaThU3w642sKZnNj84xW5b3J2nJCLhV3W3oxy9d"
              helperText="Your Solana Devnet wallet address where you'll receive payouts"
            />

            <Button
              fullWidth
              variant="contained"
              disabled={loading}
              onClick={handleSignUp}
              sx={{ fontWeight: 600, borderRadius: 2, py: 1.2 }}
            >
              {loading ? "Creating..." : "Sign Up"}
            </Button>

            <Button
              fullWidth
              variant="outlined"
              onClick={() => navigate("/login")}
              sx={{ borderRadius: 2 }}
            >
              Already have an account? Login
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}