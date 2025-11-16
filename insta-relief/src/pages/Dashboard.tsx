import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Stack,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Link,
  Chip,
} from "@mui/material";
import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Stack,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Link,
  Chip,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { doc, getDoc, collection, query, getDocs, orderBy } from "firebase/firestore";
import { signOut } from "firebase/auth";

interface UserData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  zip: string;
  policyId: string;
  balance: number;
  status: string;
  isActivated: boolean;
  walletAddress?: string;
}

interface Transaction {
  id: string;
  type: string;
  location: string;
  amount: number;
  amountSOL?: number;
  createdAt: string;
  status: string;
  signature?: string;
  explorerUrl?: string;
}

export default function DashboardPage() {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const navigate = useNavigate();

  const fetchTransactions = async (userZip: string) => {
    try {
      const catastrophesRef = collection(db, "catastrophes");
      const q = query(catastrophesRef, orderBy("createdAt", "desc"));
      const querySnapshot = await getDocs(q);
      
      const userTransactions: Transaction[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.zipCodes && data.zipCodes.includes(userZip)) {
          const payoutResult = data.payoutResults?.find(
            (r: any) => r.email === auth.currentUser?.email
          );
          
          userTransactions.push({
            id: doc.id,
            type: data.type,
            location: data.location,
            amount: data.amount,
            amountSOL: data.amountSOL,
            createdAt: data.createdAt,
            status: payoutResult?.success ? "Completed" : "Failed",
            signature: payoutResult?.signature,
            explorerUrl: payoutResult?.explorerUrl,
          });
        }
      });
      
      setTransactions(userTransactions);
    } catch (error) {
      console.error("Error fetching transactions:", error);
    }
  };

  useEffect(() => {
    const fetchUserData = async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        alert("Please log in first.");
        navigate("/login");
        return;
      }

      try {
        const docRef = doc(db, "users", currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data() as UserData;
          setUserData(data);
          await fetchTransactions(data.zip);
        } else {
          alert("User data not found.");
        }
      } catch (error) {
        console.error(error);
        alert("Failed to load user data.");
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [navigate]);

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login");
  };

  if (loading) {
    return (
      <Container
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress />
      </Container>
    );
  }

  if (!userData) return null;

  const isActive = userData.status === "ACTIVE";

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack spacing={4}>
        <Card
          sx={{
            p: 4,
            borderRadius: 4,
            backgroundColor: (theme) =>
              theme.palette.mode === "dark" ? "#0B0E11" : "#F8FAFC",
            boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
          }}
        >
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
              <Typography
                variant="h4"
                sx={{ fontWeight: 700, color: "primary.main" }}
              >
                Your Policy Dashboard
              </Typography>
              <Button variant="outlined" onClick={handleLogout}>
                Logout
              </Button>
            </Stack>

            <Stack spacing={1.2} sx={{ mb: 4 }} alignItems="center">
              <Typography variant="h6">
                {userData.firstName} {userData.lastName}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {userData.email}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                ZIP Code: {userData.zip}
              </Typography>
              {userData.walletAddress && (
                <Typography variant="body2" color="text.secondary">
                  Wallet: {userData.walletAddress.slice(0, 8)}...{userData.walletAddress.slice(-8)}
                </Typography>
              )}
            </Stack>

            <Box
              sx={{
                p: 3,
                borderRadius: 3,
                backgroundColor: isActive
                  ? "rgba(14,159,110,0.15)"
                  : "rgba(251,191,36,0.15)",
                textAlign: "center",
                mb: 2,
                transition: "0.3s ease",
              }}
            >
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 700,
                  color: isActive ? "success.main" : "warning.main",
                  mb: 1,
                }}
              >
                Status: {userData.status}
              </Typography>

              <Typography variant="body1" sx={{ mb: 0.5 }}>
                Policy ID:&nbsp;
                <strong style={{ color: "#1E3A8A" }}>{userData.policyId}</strong>
              </Typography>

              <Typography variant="body1">
                Emergency Fund Balance:&nbsp;
                <strong style={{ color: "#0E9F6E" }}>
                  ${userData.balance.toFixed(2)}
                </strong>
              </Typography>
            </Box>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
              Transaction History
            </Typography>
            
            {transactions.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No transactions yet. You'll see payouts here when catastrophes affect your area.
              </Typography>
            ) : (
              <TableContainer component={Paper} variant="outlined">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>Date</strong></TableCell>
                      <TableCell><strong>Event Type</strong></TableCell>
                      <TableCell><strong>Location</strong></TableCell>
                      <TableCell><strong>Amount (USD)</strong></TableCell>
                      <TableCell><strong>Amount (SOL)</strong></TableCell>
                      <TableCell><strong>Status</strong></TableCell>
                      <TableCell><strong>Blockchain</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {transactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell>
                          {new Date(tx.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>{tx.type}</TableCell>
                        <TableCell>{tx.location}</TableCell>
                        <TableCell>${tx.amount.toFixed(2)}</TableCell>
                        <TableCell>{tx.amountSOL ? tx.amountSOL.toFixed(4) : '0.0000'} SOL</TableCell>
                        <TableCell>
                          <Chip
                            label={tx.status}
                            color={tx.status === "Completed" ? "success" : "error"}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          {tx.explorerUrl ? (
                            <Link
                              href={tx.explorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              sx={{ fontSize: "0.875rem" }}
                            >
                              View on Explorer
                            </Link>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              N/A
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      </Stack>
    </Container>
  );
}