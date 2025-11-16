import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
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
  TablePagination,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
} from "@mui/material";

import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import {
  doc,
  getDoc,
  collection,
  query,
  getDocs,
  orderBy,
  updateDoc,
  addDoc,
} from "firebase/firestore";

// layout
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

// icons
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";

// solana + pricing
import { getProvider, sendSol } from "../lib/solana";
import { convertUSDtoSOL } from "../lib/priceService";

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
  exchangeRate?: number;
}

interface MessageState {
  type: "success" | "error";
  text: string;
  explorerUrl?: string;
}

export default function DashboardPage() {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  // Pagination
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // Withdraw state
  const [withdrawDialog, setWithdrawDialog] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [message, setMessage] = useState<MessageState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    amountUSD?: number;
    amountSOL?: number;
  }>({ open: false });

  const navigate = useNavigate();

  // ---------- Pagination handlers ----------
  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const paginatedData = transactions.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );

  // ---------- Firestore fetches ----------
  const fetchTransactions = async (userZip: string) => {
    try {
      const catastrophesRef = collection(db, "catastrophes");
      const q = query(catastrophesRef, orderBy("createdAt", "desc"));
      const querySnapshot = await getDocs(q);

      const userTransactions: Transaction[] = [];
      querySnapshot.forEach((d) => {
        const data = d.data();
        if (data.zipCodes && data.zipCodes.includes(userZip)) {
          const payoutResult = data.payoutResults?.find(
            (r: any) => r.email === auth.currentUser?.email
          );

          userTransactions.push({
            id: d.id,
            type: data.type,
            location: data.location,
            amount: data.amount,
            amountSOL: data.amountSOL,
            exchangeRate: data.exchangeRate,
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

  const fetchUserData = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      navigate("/");
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
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        navigate("/");
        return;
      }
      await fetchUserData();
    });

    return () => unsubscribe();
  }, [navigate]);

  // ---------- Withdraw logic ----------
  const handleWithdrawClick = () => {
    if (!userData?.walletAddress) {
      setMessage({
        type: "error",
        text: "No wallet connected. Please update your profile with a Solana wallet address.",
      });
      return;
    }

    if ((userData?.balance || 0) < 10) {
      setMessage({
        type: "error",
        text: "Minimum withdrawal amount is $10.00",
      });
      return;
    }

    setWithdrawDialog(true);
  };

  const handleWithdrawSubmit = async () => {
    const amount = parseFloat(withdrawAmount);

    if (isNaN(amount) || amount <= 0) {
      setMessage({ type: "error", text: "Please enter a valid amount" });
      return;
    }

    if (amount < 10) {
      setMessage({ type: "error", text: "Minimum withdrawal is $10.00" });
      return;
    }

    if (amount > 1000) {
      setMessage({
        type: "error",
        text: "Maximum withdrawal is $1,000.00 per transaction",
      });
      return;
    }

    if (amount > (userData?.balance || 0)) {
      setMessage({ type: "error", text: "Insufficient balance" });
      return;
    }

    try {
      const conversion = await convertUSDtoSOL(amount, 2);
      setConfirmDialog({
        open: true,
        amountUSD: amount,
        amountSOL: conversion.solAmount,
      });
      setWithdrawDialog(false);
    } catch (error: any) {
      console.error(error);
      setMessage({
        type: "error",
        text: `Failed to prepare withdrawal: ${error.message}`,
      });
    }
  };

  const handleConfirmWithdraw = async () => {
    if (!confirmDialog.amountUSD || !confirmDialog.amountSOL || !userData) return;

    const provider = getProvider();
    if (!provider || !provider.publicKey) {
      setMessage({
        type: "error",
        text: "Please connect Phantom wallet to withdraw",
      });
      setConfirmDialog({ open: false });
      return;
    }

    try {
      setWithdrawing(true);
      setConfirmDialog({ open: false });

      // Send SOL to the user's wallet
      const { signature, explorerUrl } = await sendSol(
        userData.walletAddress!,
        confirmDialog.amountSOL
      );

      const newBalance = userData.balance - confirmDialog.amountUSD;

      // Update user balance in Firestore
      await updateDoc(doc(db, "users", auth.currentUser!.uid), {
        balance: newBalance,
        lastWithdrawal: new Date().toISOString(),
      });

      // Log withdrawal transaction
      await addDoc(collection(db, "withdrawals"), {
        userId: auth.currentUser!.uid,
        email: userData.email,
        amountUSD: confirmDialog.amountUSD,
        amountSOL: confirmDialog.amountSOL,
        walletAddress: userData.walletAddress,
        status: "completed",
        signature,
        explorerUrl,
        createdAt: new Date().toISOString(),
        oldBalance: userData.balance,
        newBalance,
      });

      setMessage({
        type: "success",
        text: `Successfully withdrew $${confirmDialog.amountUSD.toFixed(
          2
        )}! SOL has been sent to your wallet.`,
        explorerUrl,
      });

      setWithdrawAmount("");

      // Refresh user data & transactions
      await fetchUserData();
    } catch (error: any) {
      console.error("Withdrawal error:", error);

      if (
        error.message?.includes("cancelled") ||
        error.message?.includes("rejected")
      ) {
        setMessage({
          type: "error",
          text: "Transaction cancelled. Your balance has not been changed.",
        });
      } else {
        setMessage({
          type: "error",
          text: `Withdrawal failed: ${error.message}`,
        });
      }
    } finally {
      setWithdrawing(false);
    }
  };

  // ---------- Loading / null checks ----------
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

  const isActive =
    userData.status === "ACTIVE" ||
    userData.status === "PAID" ||
    userData.status === "Paid";

  // ============================================================
  //                        RENDER
  // ============================================================
  return (
    <>
      <Navbar />

      <Container maxWidth="lg" sx={{ py: 5 }}>
        <Stack spacing={4}>
          {/* Global alert (withdraw status, errors, etc.) */}
          {message && (
            <Alert
              severity={message.type}
              onClose={() => setMessage(null)}
              sx={{
                borderRadius: 3,
                backgroundColor:
                  message.type === "success"
                    ? "rgba(16,185,129,0.1)"
                    : "rgba(239,68,68,0.1)",
                border:
                  message.type === "success"
                    ? "1px solid rgba(16,185,129,0.4)"
                    : "1px solid rgba(239,68,68,0.5)",
                color: "#E5E7EB",
              }}
              action={
                message.explorerUrl ? (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() =>
                      window.open(message.explorerUrl, "_blank")
                    }
                  >
                    View Transaction
                  </Button>
                ) : undefined
              }
            >
              {message.text}
            </Alert>
          )}

          {/* HERO POLICY CARD */}
          <Card
            sx={{
              borderRadius: 6,
              px: { xs: 3, md: 6 },
              py: { xs: 4, md: 5 },
              background:
                "radial-gradient(circle at top, #1f2937 0, #020617 55%)",
              boxShadow: "0 26px 60px rgba(0,0,0,0.75)",
              border: "1px solid rgba(15, 185, 129, 0.25)",
            }}
          >
            <CardContent sx={{ p: 0 }}>
              {/* Top Row */}
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", md: "center" }}
                sx={{ mb: 4 }}
              >
                <Typography
                  variant="h4"
                  sx={{
                    fontWeight: 900,
                    letterSpacing: 0.5,
                    color: "#E5E7EB",
                  }}
                >
                  Policy Dashboard
                </Typography>

                <Chip
                  icon={<ShieldOutlinedIcon sx={{ fontSize: 18 }} />}
                  label={userData.status.toUpperCase()}
                  color={isActive ? "success" : "warning"}
                  sx={{
                    fontWeight: 700,
                    px: 1,
                    backgroundColor: isActive
                      ? "rgba(16,185,129,0.16)"
                      : "rgba(245,158,11,0.18)",
                  }}
                />
              </Stack>

              {/* User Info + Wallet */}
              <Stack
                direction={{ xs: "column", md: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", md: "center" }}
                spacing={3}
                sx={{ mb: 4 }}
              >
                <Box>
                  <Typography
                    variant="h5"
                    sx={{ fontWeight: 700, color: "#F9FAFB", mb: 0.5 }}
                  >
                    {userData.firstName} {userData.lastName}
                  </Typography>

                  <Typography
                    variant="body2"
                    sx={{ color: "rgba(148,163,184,0.9)", mb: 0.3 }}
                  >
                    {userData.email}
                  </Typography>

                  <Stack
                    direction="row"
                    spacing={1.5}
                    alignItems="center"
                    sx={{ color: "rgba(148,163,184,0.9)" }}
                  >
                    <LocationOnOutlinedIcon sx={{ fontSize: 18 }} />
                    <Typography variant="body2">
                      ZIP Code: <strong>{userData.zip}</strong>
                    </Typography>
                  </Stack>
                </Box>

                {userData.walletAddress && (
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{
                      px: 2,
                      py: 1.2,
                      borderRadius: 999,
                      backgroundColor: "rgba(15,23,42,0.85)",
                      border: "1px solid rgba(148,163,184,0.35)",
                    }}
                  >
                    <AccountBalanceWalletOutlinedIcon
                      sx={{ fontSize: 20, color: "#10B981" }}
                    />
                    <Typography
                      variant="body2"
                      sx={{ color: "rgba(209,213,219,0.95)" }}
                    >
                      {userData.walletAddress.slice(0, 6)}...
                      {userData.walletAddress.slice(-6)}
                    </Typography>
                  </Stack>
                )}
              </Stack>

              {/* Status + Balance + Withdraw CTA */}
              <Box
                sx={{
                  mt: 1,
                  p: { xs: 2.5, md: 3 },
                  borderRadius: 4,
                  background:
                    "linear-gradient(135deg, rgba(15,23,42,0.95), rgba(15,118,110,0.35))",
                  border: "1px solid rgba(15,185,129,0.5)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  gap: 0.6,
                }}
              >
                <Typography
                  variant="subtitle1"
                  sx={{ fontWeight: 700, color: "#FACC15" }}
                >
                  Status:&nbsp;
                  <span style={{ color: "#FACC15" }}>
                    {userData.status.toUpperCase()}
                  </span>
                </Typography>

                <Typography variant="body2" sx={{ color: "#CBD5F5" }}>
                  Policy ID:&nbsp;
                  <Link
                    sx={{
                      color: "#60A5FA",
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    {userData.policyId}
                  </Link>
                </Typography>

                <Typography variant="body1" sx={{ mt: 0.5 }}>
                  Emergency Fund Balance:&nbsp;
                  <span
                    style={{
                      color: "#10B981",
                      fontWeight: 800,
                      fontSize: "1.25rem",
                    }}
                  >
                    ${userData.balance.toFixed(2)}
                  </span>
                </Typography>

                {/* Withdraw CTA */}
                <Box sx={{ mt: 2 }}>
                  {userData.walletAddress && userData.balance >= 10 && (
                    <Button
                      variant="contained"
                      size="large"
                      startIcon={<AccountBalanceWalletIcon />}
                      onClick={handleWithdrawClick}
                      disabled={withdrawing}
                      sx={{
                        textTransform: "none",
                        fontWeight: 700,
                        px: 3,
                        borderRadius: 999,
                        backgroundColor: "#10B981",
                        color: "#020617",
                        boxShadow: "0 0 16px rgba(16,185,129,0.5)",
                        "&:hover": {
                          backgroundColor: "#0EA370",
                          boxShadow: "0 0 24px rgba(16,185,129,0.7)",
                        },
                      }}
                    >
                      {withdrawing ? "Processing..." : "Withdraw Funds"}
                    </Button>
                  )}

                  {!userData.walletAddress && (
                    <Alert
                      severity="info"
                      sx={{
                        mt: 2,
                        borderRadius: 2,
                        backgroundColor: "rgba(59,130,246,0.12)",
                        border: "1px solid rgba(59,130,246,0.4)",
                      }}
                    >
                      Connect a Solana wallet to withdraw your funds.
                    </Alert>
                  )}

                  {userData.walletAddress && userData.balance < 10 && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 2 }}
                    >
                      Minimum withdrawal: $10.00
                    </Typography>
                  )}
                </Box>
              </Box>
            </CardContent>
          </Card>

          {/* TRANSACTION HISTORY */}
          <Card
            sx={{
              borderRadius: 6,
              background:
                "linear-gradient(145deg, rgba(15,23,42,1), rgba(15,23,42,0.95))",
              boxShadow: "0 18px 40px rgba(0,0,0,0.8)",
              border: "1px solid rgba(30,64,175,0.5)",
            }}
          >
            <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
              <Typography
                variant="h6"
                sx={{ mb: 2.5, fontWeight: 700, color: "#E5E7EB" }}
              >
                Transaction History
              </Typography>

              {transactions.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No transactions yet. You’ll see payouts here when catastrophes
                  affect your area.
                </Typography>
              ) : (
                <>
                  <TableContainer
                    component={Paper}
                    variant="outlined"
                    sx={{
                      backgroundColor: "rgba(15,23,42,0.98)",
                      borderRadius: 4,
                      border: "1px solid rgba(31,41,55,0.8)",
                      overflow: "hidden",
                    }}
                  >
                    <Table size="small">
                      <TableHead>
                        <TableRow
                          sx={{
                            "& th": {
                              backgroundColor: "rgba(15,23,42,1)",
                              color: "#9CA3AF",
                              fontWeight: 700,
                              fontSize: "0.8rem",
                              borderBottom:
                                "1px solid rgba(55,65,81,0.7)",
                            },
                          }}
                        >
                          <TableCell>Date</TableCell>
                          <TableCell>Event Type</TableCell>
                          <TableCell>Location</TableCell>
                          <TableCell>Amount (USD)</TableCell>
                          <TableCell>Amount (SOL)</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Explorer</TableCell>
                          <TableCell>Exchange Rate</TableCell>
                        </TableRow>
                      </TableHead>

                      <TableBody>
                        {paginatedData.map((tx) => (
                          <TableRow
                            key={tx.id}
                            sx={{
                              "&:nth-of-type(odd)": {
                                backgroundColor:
                                  "rgba(15,23,42,0.92)",
                              },
                              "&:hover": {
                                backgroundColor:
                                  "rgba(30,64,175,0.25)",
                                transition: "0.2s ease",
                                cursor: "pointer",
                                boxShadow:
                                  tx.status === "Completed"
                                    ? "0 0 12px rgba(16,185,129,0.35)"
                                    : "0 0 12px rgba(239,68,68,0.35)",
                              },
                              "& td": {
                                borderBottomColor:
                                  "rgba(31,41,55,0.6)",
                                fontSize: "0.85rem",
                                paddingY: 1.2,
                              },
                            }}
                          >
                            <TableCell>
                              {new Date(
                                tx.createdAt
                              ).toLocaleDateString()}
                            </TableCell>
                            <TableCell>{tx.type}</TableCell>
                            <TableCell>{tx.location}</TableCell>
                            <TableCell>
                              ${tx.amount.toFixed(2)}
                            </TableCell>
                            <TableCell>
                              {tx.amountSOL
                                ? tx.amountSOL.toFixed(4)
                                : "0.0000"}{" "}
                              SOL
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={tx.status}
                                color={
                                  tx.status === "Completed"
                                    ? "success"
                                    : "error"
                                }
                                size="small"
                                sx={{
                                  fontSize: "0.7rem",
                                  fontWeight: 700,
                                  px: 1,
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              {tx.explorerUrl ? (
                                <Link
                                  href={tx.explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  sx={{
                                    fontSize: "0.78rem",
                                    color: "#60A5FA",
                                  }}
                                >
                                  View
                                </Link>
                              ) : (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  N/A
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell>
                              {tx.exchangeRate
                                ? `$${tx.exchangeRate.toFixed(
                                    2
                                  )}/SOL`
                                : "N/A"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  {/* Pagination Controls */}
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "flex-end",
                      p: 1.5,
                      backgroundColor: "rgba(15,23,42,0.95)",
                      borderTop: "1px solid rgba(55,65,81,0.5)",
                    }}
                  >
                    <TablePagination
                      component="div"
                      count={transactions.length}
                      page={page}
                      rowsPerPage={rowsPerPage}
                      onPageChange={handleChangePage}
                      onRowsPerPageChange={handleChangeRowsPerPage}
                      rowsPerPageOptions={[5, 10, 20, 50]}
                      sx={{
                        color: "#9CA3AF",
                        "& .MuiSelect-icon": {
                          color: "#9CA3AF",
                        },
                      }}
                    />
                  </Box>
                </>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Container>

      {/* Withdraw Dialog */}
      <Dialog
        open={withdrawDialog}
        onClose={() => !withdrawing && setWithdrawDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Withdraw Funds</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <Alert severity="info">
              Funds will be sent as SOL to your connected Solana wallet.
            </Alert>

            <TextField
              label="Available Balance"
              value={`$${userData.balance.toFixed(2)}`}
              fullWidth
              disabled
            />

            <TextField
              label="Wallet Address"
              value={userData.walletAddress || ""}
              fullWidth
              disabled
            />

            <TextField
              label="Withdrawal Amount (USD)"
              type="number"
              fullWidth
              autoFocus
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="Enter amount (min: $10, max: $1000)"
              helperText="Minimum: $10.00 | Maximum: $1,000.00 per transaction"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleWithdrawSubmit();
                }
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWithdrawDialog(false)}>Cancel</Button>
          <Button
            onClick={handleWithdrawSubmit}
            variant="contained"
            disabled={!withdrawAmount || withdrawing}
          >
            Continue
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Withdrawal Dialog */}
      <Dialog
        open={confirmDialog.open}
        onClose={() => !withdrawing && setConfirmDialog({ open: false })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Confirm Withdrawal</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 3 }}>
            This will send SOL to your wallet. This action cannot be undone.
          </Alert>

          <Stack spacing={2}>
            <TextField
              label="Withdrawal Amount (USD)"
              value={`$${confirmDialog.amountUSD?.toFixed(2)}`}
              fullWidth
              disabled
            />
            <TextField
              label="You will receive (SOL)"
              value={
                confirmDialog.amountSOL
                  ? `${confirmDialog.amountSOL.toFixed(4)} SOL`
                  : ""
              }
              fullWidth
              disabled
              helperText="Includes 2% buffer for price volatility"
            />
            <TextField
              label="Destination Wallet"
              value={userData.walletAddress || ""}
              fullWidth
              disabled
            />
            <TextField
              label="New Balance"
              value={`$${(
                (userData.balance || 0) -
                (confirmDialog.amountUSD || 0)
              ).toFixed(2)}`}
              fullWidth
              disabled
            />
          </Stack>

          <Alert severity="info" sx={{ mt: 2 }}>
            You will need to approve this transaction in your Phantom wallet.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setConfirmDialog({ open: false })}
            disabled={withdrawing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmWithdraw}
            variant="contained"
            color="primary"
            disabled={withdrawing}
          >
            {withdrawing ? "Processing..." : "Confirm & Withdraw"}
          </Button>
        </DialogActions>
      </Dialog>

      <Footer />
    </>
  );
}
