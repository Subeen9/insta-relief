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
import { signOut, onAuthStateChanged } from "firebase/auth";

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
}

export default function DashboardPage() {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const navigate = useNavigate();

  const fetchTransactions = async (userZip: string) => {
    try {
      const catastrophesRef = collection(db, "catastrophes");
      const q = query(catastrophesRef, orderBy("createdAt", "desc"));
      const querySnapshot = await getDocs(q);

      const userTx: Transaction[] = [];

      querySnapshot.forEach((doc) => {
        const data = doc.data();

        if (data.zipCodes && data.zipCodes.includes(userZip)) {
          const payoutResult = data.payoutResults?.find(
            (r: any) => r.email === auth.currentUser?.email
          );

          let status = "N/A";
          if (payoutResult) status = payoutResult.success ? "Completed" : "Failed";

          userTx.push({
            id: doc.id,
            type: data.type,
            location: data.location,
            amount: data.amount,
            amountSOL: data.amountSOL,
            createdAt: data.createdAt,
            status,
          });
        }
      });

      // Sort after filtering
      userTx.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setTransactions(userTx);
    } catch (error) {
      console.error("Error fetching transactions:", error);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
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
      } catch (err) {
        console.error(err);
        alert("Failed to load user data.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
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
        {/* TOP CARD */}
        <Card
          sx={{
            p: 4,
            borderRadius: 4,
            background:
              "linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)",
            color: "white",
            boxShadow: "0 8px 30px rgba(0,0,0,0.3)",
          }}
        >
          <CardContent>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 3 }}
            >
              <Typography variant="h4" sx={{ fontWeight: 800 }}>
                Policy Dashboard
              </Typography>

              <Button variant="outlined" onClick={handleLogout} sx={{ color: "white", borderColor: "white" }}>
                Logout
              </Button>
            </Stack>

            <Stack spacing={1.5} sx={{ mb: 3 }}>
              <Typography variant="h6">
                {userData.firstName} {userData.lastName}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                {userData.email}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                ZIP Code: {userData.zip}
              </Typography>
            </Stack>

            <Box
              sx={{
                p: 3,
                borderRadius: 3,
                textAlign: "center",
                backgroundColor: isActive ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)",
                backdropFilter: "blur(6px)",
              }}
            >
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 700,
                  color: isActive ? "#10B981" : "#F59E0B",
                  mb: 1,
                }}
              >
                Status: {userData.status}
              </Typography>

              <Typography variant="body1">
                Policy ID:{" "}
                <strong>{userData.policyId}</strong>
              </Typography>

              <Typography variant="body1">
                Emergency Fund Balance:{" "}
                <strong style={{ color: "#10B981" }}>
                  ${userData.balance.toFixed(2)}
                </strong>
              </Typography>
            </Box>
          </CardContent>
        </Card>

        {/* TRANSACTION HISTORY */}
        <Card
          sx={{
            borderRadius: 4,
            p: 2,
            backgroundColor: (theme) =>
              theme.palette.mode === "dark" ? "#0B0E11" : "#F8FAFC",
            boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
          }}
        >
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>
              Transaction History
            </Typography>

            {transactions.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No transactions yet. When a catastrophe affects your ZIP code, funds will appear here.
              </Typography>
            ) : (
              <TableContainer component={Paper} sx={{ borderRadius: 3 }}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>Date</strong></TableCell>
                      <TableCell><strong>Event</strong></TableCell>
                      <TableCell><strong>Location</strong></TableCell>
                      <TableCell><strong>Amount (USD)</strong></TableCell>
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

                        <TableCell>
                          <Chip
                            label={tx.status}
                            color={
                              tx.status === "Completed"
                                ? "success"
                                : tx.status === "Failed"
                                ? "error"
                                : "default"
                            }
                            size="small"
                          />
                        </TableCell>

                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            N/A
                          </Typography>
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
