import { useState, useEffect } from "react";
import {
  Button,
  Card,
  CardContent,
  Container,
  Stack,
  TextField,
  Typography,
  Alert,
  CircularProgress
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import { signInWithEmailAndPassword } from "firebase/auth";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();


  useEffect(() => {
  const checkAuth = async () => {
    const currentUser = auth.currentUser;
    if (currentUser) {
      try {
        const idTokenResult = await currentUser.getIdTokenResult();
        if (idTokenResult.claims.admin) {
          navigate("/admin/dashboard");
        } else {
          navigate("/dashboard");
        }
      } catch (error) {
        console.error(error);
      }
    }
    setChecking(false);
  };

  checkAuth();
}, [navigate]);

  const handleAdminLogin = async () => {
    setLoading(true);
    setError("");
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      // Get the ID token with custom claims
      const idTokenResult = await userCredential.user.getIdTokenResult();
      
      // Check if user has admin claim
  if (idTokenResult.claims.admin) {
  navigate("/admin/dashboard");
} else {
  setError("Access denied. Admin privileges required.");
  await auth.signOut();
  navigate("/dashboard");  
}
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

   if (checking) {
    return (
      <Container
        maxWidth="sm"
        sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <CircularProgress />
      </Container>
    );
  }
  
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAdminLogin();
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
            sx={{ mb: 1, fontWeight: 700, color: "primary.main" }}
          >
            Admin Portal
          </Typography>
          <Typography
            variant="body2"
            align="center"
            color="text.secondary"
            sx={{ mb: 3 }}
          >
            Authorized personnel only
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          <Stack spacing={3}>
            <TextField
              label="Admin Email"
              fullWidth
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyPress={handleKeyPress}
            />
            <TextField
              label="Password"
              type="password"
              fullWidth
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={handleKeyPress}
            />
            <Button
              fullWidth
              variant="contained"
              disabled={loading}
              onClick={handleAdminLogin}
              sx={{ fontWeight: 600, borderRadius: 2, py: 1.2 }}
            >
              {loading ? "Authenticating..." : "Login as Admin"}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}