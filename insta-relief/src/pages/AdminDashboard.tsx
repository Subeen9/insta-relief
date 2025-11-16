import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Chip,
  Paper,
  Alert,
  CircularProgress,
  Tab,
  Tabs,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  query,
  orderBy,
} from "firebase/firestore";
import { signOut } from "firebase/auth";
import AdminWalletConnect from "../components/AdminWalletConnect";
import AIAssistant from "../components/AIAssistant";
import { sendSol, getProvider } from "../lib/solana";
import { convertUSDtoSOL } from "../lib/priceService";
import NoaaMap from "../components/NoaaMap";

interface UserData {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  zip: string;
  policyId: string;
  balance?: number;
  status: string;
  isActivated: boolean;
  walletAddress?: string;
}

interface Catastrophe {
  id: string;
  type: string;
  location: string;
  zipCodes: string[];
  amount: number;
  description: string;
  createdAt: string;
  createdBy: string;
}

// ⚠️ IMPORTANT: Ensure this URL is correct for your environment (Deployed or Emulator)
const SIMULATE_DISASTER_URL = "https://simulatedisaster-eelyy5nzaa-uc.a.run.app";

export default function AdminDashboard() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [catastrophes, setCatastrophes] = useState<Catastrophe[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabValue, setTabValue] = useState(0);
  const [openCatastropheDialog, setOpenCatastropheDialog] = useState(false);
  const [catastropheData, setCatastropheData] = useState({
    type: "",
    location: "",
    zipCodes: "",
    amount: "",
    description: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [processingStatus, setProcessingStatus] = useState<{
    show: boolean;
    current: number;
    total: number;
    currentUser?: string;
  }>({ show: false, current: 0, total: 0 });
  const [paymentConfirmDialog, setPaymentConfirmDialog] = useState<{
    open: boolean;
    user?: UserData;
    amountUSD?: number;
    amountSOL?: number;
    newBalance?: number;
  }>({ open: false });
  const [balanceInputDialog, setBalanceInputDialog] = useState<{
    open: boolean;
    user?: UserData;
  }>({ open: false });
  const [newBalanceInput, setNewBalanceInput] = useState("");
  const navigate = useNavigate();

  const AI_FUNCTION_URL = "https://adminagent-eelyy5nzaa-uc.a.run.app";
  useEffect(() => {
    const checkAdminAndFetchData = async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        navigate("/login");
        return;
      }

      try {
        const idTokenResult = await currentUser.getIdTokenResult();
        if (!idTokenResult.claims.admin) {
          navigate("/dashboard");
          return;
        }

        await fetchUsers();
        await fetchCatastrophes();
      } catch (error) {
        console.error(error);
        alert("Failed to verify admin status.");
        navigate("/login");
      } finally {
        setLoading(false);
      }
    };

    checkAdminAndFetchData();
  }, [navigate]);

  const fetchUsers = async () => {
    try {
      const usersSnapshot = await getDocs(collection(db, "users"));
      const usersData: UserData[] = [];
      usersSnapshot.forEach((doc) => {
        usersData.push({ id: doc.id, ...doc.data() } as UserData);
      });
      setUsers(usersData);
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  };

  const fetchCatastrophes = async () => {
    try {
      const q = query(collection(db, "catastrophes"), orderBy("createdAt", "desc"));
      const catastrophesSnapshot = await getDocs(q);
      const catastrophesData: Catastrophe[] = [];
      catastrophesSnapshot.forEach((doc) => {
        catastrophesData.push({ id: doc.id, ...doc.data() } as Catastrophe);
      });
      setCatastrophes(catastrophesData);
    } catch (error) {
      console.error("Error fetching catastrophes:", error);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login");
  };

  const handleUpdateBalance = async (userId: string, newBalance: number) => {
    const user = users.find(u => u.id === userId);
    
    if (!user) {
      setMessage({ type: "error", text: "User not found." });
      return;
    }

    const currentBalance = user.balance ?? 0;
    const difference = newBalance - currentBalance;

    if (difference === 0) {
      setMessage({ type: "error", text: "No balance change detected." });
      return;
    }

    // If decreasing balance, just update database
    if (difference < 0) {
      try {
        await updateDoc(doc(db, "users", userId), {
          balance: newBalance,
        });
        setMessage({ type: "success", text: `Balance decreased by $${Math.abs(difference).toFixed(2)}` });
        await fetchUsers();
      } catch (error) {
        console.error(error);
        setMessage({ type: "error", text: "Failed to update balance." });
      }
      return;
    }

    // If increasing balance, check wallet and send SOL
    if (!user.walletAddress) {
      setMessage({ type: "error", text: "User has no connected wallet address. Cannot send SOL." });
      return;
    }

    const provider = getProvider();
    if (!provider || !provider.publicKey) {
      setMessage({ type: "error", text: "Please connect your Phantom wallet first!" });
      return;
    }

    try {
      // Convert USD to SOL
      const conversion = await convertUSDtoSOL(difference, 2);
      const amountSOL = conversion.solAmount;

      setPaymentConfirmDialog({
        open: true,
        user,
        amountUSD: difference,
        amountSOL,
        newBalance,
      });
    } catch (error: any) {
      console.error(error);
      setMessage({ type: "error", text: `Failed to prepare payment: ${error.message}` });
    }
  };
const handleConfirmPayment = async () => {
  if (!paymentConfirmDialog.user || !paymentConfirmDialog.amountSOL) return;

  const { user, amountUSD, amountSOL, newBalance } = paymentConfirmDialog;

  try {
    setSubmitting(true);
    setPaymentConfirmDialog({ open: false });

    const { signature, explorerUrl } = await sendSol(
      user.walletAddress!,
      amountSOL
    );

    console.log(`Sent ${amountSOL.toFixed(4)} SOL to ${user.email}`, explorerUrl);

    await updateDoc(doc(db, "users", user.id), {
      balance: newBalance,
      lastPayout: new Date().toISOString(),
      lastPayoutAmount: amountUSD,
      status: "PAID",
    });

    setMessage({ 
      type: "success", 
      text: `Successfully sent ${amountSOL.toFixed(4)} SOL ($${amountUSD?.toFixed(2)})! View transaction: ${explorerUrl}` 
    });

    await fetchUsers();
  } catch (error: any) {
    console.error("Payment error:", error);
    
    if (error.message?.includes("cancelled") || error.message?.includes("rejected")) {
      setMessage({ 
        type: "error", 
        text: "Transaction cancelled by user." 
      });
    } else {
      setMessage({ 
        type: "error", 
        text: `Failed to send payment: ${error.message}. Balance was not updated.` 
      });
    }
  } finally {
    setSubmitting(false);
  }
};
  const handleAIPreparedCatastrophe = (aiData: any) => {
    console.log("AI prepared catastrophe data:", aiData);
    
    setCatastropheData({
      type: aiData.formData.type,
      location: aiData.formData.location,
      zipCodes: aiData.formData.zipCodes,
      amount: aiData.formData.amount,
      description: aiData.formData.description || "",
    });
    
    setOpenCatastropheDialog(true);
    
    setMessage({
      type: "success",
      text: `AI auto-filled catastrophe form! ${aiData.analysis?.usersWithWallet || 0} users ready. Review and confirm to execute.`,
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleConfirmTrigger = () => {
    const zipCodesArray = catastropheData.zipCodes.split(",").map((zip) => zip.trim());
    const affectedCount = users.filter(u => zipCodesArray.includes(u.zip) && u.walletAddress).length;
    
    if (affectedCount === 0) {
      setMessage({ type: "error", text: "No users will be affected by these ZIP codes." });
      return;
    }

    const confirmed = window.confirm(
      `CONFIRM CATASTROPHE TRIGGER\n\n` +
      `This will send real cryptocurrency to ${affectedCount} user(s).\n\n` +
      `Type: ${catastropheData.type}\n` +
      `Location: ${catastropheData.location}\n` +
      `Amount per user: $${catastropheData.amount} (${parseFloat(catastropheData.amount) / 100} SOL)\n\n` +
      `Do you want to proceed?`
    );

    if (confirmed) {
      handleTriggerCatastrophe();
    }
  };

  // ==========================================================
  // 🆕 NEW: Function to call the existing simulateDisaster endpoint
  // ==========================================================
// AdminDashboard.tsx: New function signature
const callSimulateDisaster = async (zip: string, eventType: string) => {
    try {
        // We include the &event=... parameter in the URL.
        const response = await fetch(
            // Uses template literal to insert the event type
            `${SIMULATE_DISASTER_URL}?zip=${zip}&severity=PAYOUT_CONFIRMED&event=${eventType}`
        ); 
        if (!response.ok) {
            console.error("❌ Failed to trigger backend email (HTTP Error):", await response.text());
        } else {
            console.log(`✅ Confirmation email triggered for ${eventType}.`);
        }
    } catch (error) {
        console.error("❌ Network error triggering simulateDisaster:", error);
    }
};

// 3. Update the call inside handleTriggerCatastrophe
// Use the type from the catastropheData state



  // ==========================================================
  // 🔄 MODIFIED: Payout Logic (Swapped Firestore Update)
  // ==========================================================

  const handleTriggerCatastrophe = async () => {
    if (!catastropheData.type || !catastropheData.location || !catastropheData.zipCodes || !catastropheData.amount) {
      setMessage({ type: "error", text: "Please fill all required fields." });
      return;
    }

    const provider = getProvider();
    if (!provider || !provider.publicKey) {
      setMessage({ type: "error", text: "Please connect your Phantom wallet first!" });
      return;
    }

    setSubmitting(true);
    try {
      const zipCodesArray = catastropheData.zipCodes.split(",").map((zip) => zip.trim());
      const amountUSD = parseFloat(catastropheData.amount);
      const conversion = await convertUSDtoSOL(amountUSD, 2); 
      const amountSOL = conversion.solAmount;
      const exchangeRate = conversion.exchangeRate;
      const usersSnapshot = await getDocs(collection(db, "users"));
      const affectedUsers: any[] = [];
      
      usersSnapshot.forEach((userDoc) => {
        const userData = userDoc.data();
        if (zipCodesArray.includes(userData.zip) && userData.walletAddress) {
          affectedUsers.push({
            id: userDoc.id,
            ...userData,
          });
        }
      });

      if (affectedUsers.length === 0) {
        setMessage({ type: "error", text: "No users with wallet addresses found in affected ZIP codes." });
        setSubmitting(false);
        return;
      }

      const estimatedTotalSOL = affectedUsers.length * amountSOL;

      const payoutResults = [];
      for (let i = 0; i < affectedUsers.length; i++) {
        const user = affectedUsers[i];
        
        setProcessingStatus({
          show: true,
          current: i + 1,
          total: affectedUsers.length,
          currentUser: user.email,
        });

        try {
          // 1. Send SOL via Solana network
          const { signature, explorerUrl } = await sendSol(
            user.walletAddress,
            amountSOL
          );

          // 2. 📧 TRIGGER EMAIL CONFIRMATION *WHILE STATUS IS ACTIVE*
          // Pass both the user's ZIP and the catastrophe type
await callSimulateDisaster(user.zip, catastropheData.type);

          // 3. Update Firestore Status *AFTER* email call
          await updateDoc(doc(db, "users", user.id), {
            balance: (user.balance ?? 0) + amountUSD,
            status: "PAID",
            lastPayout: new Date().toISOString(),
            lastPayoutAmount: amountUSD,
          });

          payoutResults.push({
            userId: user.id,
            email: user.email,
            success: true,
            signature,
            explorerUrl,
          });

        } catch (error: any) {
          payoutResults.push({
            userId: user.id,
            email: user.email,
            success: false,
            error: error.message,
          });
        }
      }

      setProcessingStatus({ show: false, current: 0, total: 0 });

      await addDoc(collection(db, "catastrophes"), {
        type: catastropheData.type,
        location: catastropheData.location,
        zipCodes: zipCodesArray,
        amount: amountUSD,
        amountSOL: amountSOL,
        exchangeRate: exchangeRate,
        priceTimestamp: conversion.timestamp,
        description: catastropheData.description,
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser?.email,
        payoutResults: payoutResults,
        totalAffected: affectedUsers.length,
        successfulPayouts: payoutResults.filter(r => r.success).length,
        failedPayouts: payoutResults.filter(r => !r.success).length,
      });

      const successCount = payoutResults.filter(r => r.success).length;
      const failCount = payoutResults.filter(r => !r.success).length;

      setMessage({
        type: successCount > 0 ? "success" : "error",
        text: `Catastrophe triggered! ${successCount} successful payouts, ${failCount} failed. Check console for details.`,
      });

      setOpenCatastropheDialog(false);
      setCatastropheData({
        type: "",
        location: "",
        zipCodes: "",
        amount: "",
        description: "",
      });
      
      await fetchUsers();
      await fetchCatastrophes();
    } catch (error: any) {
      console.error(error);
      setMessage({ type: "error", text: "Failed to trigger catastrophe: " + error.message });
      setProcessingStatus({ show: false, current: 0, total: 0 });
    } finally {
      setSubmitting(false);
    }
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

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, color: "primary.main" }}>
          Admin Dashboard
        </Typography>
        <Stack direction="row" spacing={2}>
          <Button
            variant="contained"
            color="error"
            onClick={() => setOpenCatastropheDialog(true)}
            sx={{ fontWeight: 600 }}
          >
            Trigger Catastrophe
          </Button>
          <Button variant="outlined" onClick={handleLogout}>
            Logout
          </Button>
        </Stack>
      </Stack>

      <AdminWalletConnect />

      {message && (
        <Alert
          severity={message.type}
          onClose={() => setMessage(null)}
          sx={{ mb: 3 }}
        >
          {message.text}
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
          <Tab label={`Users (${users.length})`} />
          <Tab label={`Catastrophes (${catastrophes.length})`} />
          <Tab label="🤖 AI Assistant" />
          <Tab label ="Live Map"/>
        </Tabs>
      </Box>

      {tabValue === 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
              User Management
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell><strong>Name</strong></TableCell>
                    <TableCell><strong>Email</strong></TableCell>
                    <TableCell><strong>Policy ID</strong></TableCell>
                    <TableCell><strong>ZIP</strong></TableCell>
                    <TableCell><strong>Status</strong></TableCell>
                    <TableCell><strong>Balance</strong></TableCell>
                    <TableCell><strong>Wallet</strong></TableCell>
                    <TableCell><strong>Actions</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        {user.firstName} {user.lastName}
                      </TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{user.policyId}</TableCell>
                      <TableCell>{user.zip}</TableCell>
                      <TableCell>
                        <Chip
                          label={user.status}
                          color={user.status === "ACTIVE" ? "success" : "warning"}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>${(user.balance ?? 0).toFixed(2)}</TableCell>
                      <TableCell>
                        {user.walletAddress ? (
                          <Chip label="Connected" color="success" size="small" />
                        ) : (
                          <Chip label="No Wallet" color="default" size="small" />
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="small"
                          onClick={() => {
                            setBalanceInputDialog({ open: true, user });
                            setNewBalanceInput((user.balance ?? 0).toString());
                          }}
                          disabled={submitting}
                        >
                          Update Balance
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {tabValue === 1 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
              Catastrophe History
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell><strong>Type</strong></TableCell>
                    <TableCell><strong>Location</strong></TableCell>
                    <TableCell><strong>ZIP Codes</strong></TableCell>
                    <TableCell><strong>Amount</strong></TableCell>
                    <TableCell><strong>Description</strong></TableCell>
                    <TableCell><strong>Created By</strong></TableCell>
                    <TableCell><strong>Date</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {catastrophes.map((cat) => (
                    <TableRow key={cat.id}>
                      <TableCell>{cat.type}</TableCell>
                      <TableCell>{cat.location}</TableCell>
                      <TableCell>{cat.zipCodes.join(", ")}</TableCell>
                      <TableCell>${cat.amount.toFixed(2)}</TableCell>
                      <TableCell>{cat.description}</TableCell>
                      <TableCell>{cat.createdBy}</TableCell>
                      <TableCell>
                        {new Date(cat.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {tabValue === 2 && (
        <AIAssistant
          functionUrl={AI_FUNCTION_URL}
          onCatastrophePrepared={handleAIPreparedCatastrophe}
        />
      )}
      {tabValue ==3 &&(
        <Card>
          <CardContent>
            <NoaaMap/>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={openCatastropheDialog}
        onClose={() => setOpenCatastropheDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Trigger Catastrophe Event</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Catastrophe Type"
              fullWidth
              placeholder="e.g., Hurricane, Flood, Wildfire"
              value={catastropheData.type}
              onChange={(e) =>
                setCatastropheData({ ...catastropheData, type: e.target.value })
              }
            />
            <TextField
              label="Location"
              fullWidth
              placeholder="e.g., Louisiana Coast"
              value={catastropheData.location}
              onChange={(e) =>
                setCatastropheData({ ...catastropheData, location: e.target.value })
              }
            />
            <TextField
              label="Affected ZIP Codes"
              fullWidth
              placeholder="e.g., 70403, 70401, 70402"
              helperText="Comma-separated list of ZIP codes"
              value={catastropheData.zipCodes}
              onChange={(e) =>
                setCatastropheData({ ...catastropheData, zipCodes: e.target.value })
              }
            />
            <TextField
              label="Disbursement Amount per User"
              fullWidth
              type="number"
              placeholder="e.g., 500"
              value={catastropheData.amount}
              onChange={(e) =>
                setCatastropheData({ ...catastropheData, amount: e.target.value })
              }
            />
            <TextField
              label="Description"
              fullWidth
              multiline
              rows={3}
              placeholder="Optional: Additional details about the catastrophe"
              value={catastropheData.description}
              onChange={(e) =>
                setCatastropheData({ ...catastropheData, description: e.target.value })
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCatastropheDialog(false)}>Cancel</Button>
          <Button
            onClick={handleConfirmTrigger}
            variant="contained"
            color="error"
            disabled={submitting}
          >
            {submitting ? "Processing..." : "Trigger Event"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={processingStatus.show} maxWidth="sm" fullWidth>
        <DialogContent>
          <Stack spacing={2} alignItems="center" sx={{ py: 3 }}>
            <CircularProgress size={60} />
            <Typography variant="h6">
              Processing Blockchain Transactions
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sending payment {processingStatus.current} of {processingStatus.total}
            </Typography>
            {processingStatus.currentUser && (
              <Typography variant="caption" color="text.secondary">
                To: {processingStatus.currentUser}
              </Typography>
            )}
            <Typography variant="caption" color="warning.main">
              Please don't close this window
            </Typography>
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog 
        open={balanceInputDialog.open} 
        onClose={() => setBalanceInputDialog({ open: false })}
        maxWidth="xs" 
        fullWidth
      >
        <DialogTitle>Update Balance</DialogTitle>
        
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="User"
              value={`${balanceInputDialog.user?.firstName} ${balanceInputDialog.user?.lastName}`}
              fullWidth
              disabled
            />
            <TextField
              label="Current Balance"
              value={`$${(balanceInputDialog.user?.balance ?? 0).toFixed(2)}`}
              fullWidth
              disabled
            />
            <TextField
              label="New Balance"
              type="number"
              fullWidth
              autoFocus
              value={newBalanceInput}
              onChange={(e) => setNewBalanceInput(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  const newBalance = parseFloat(newBalanceInput);
                  if (!isNaN(newBalance) && balanceInputDialog.user) {
                    handleUpdateBalance(balanceInputDialog.user.id, newBalance);
                    setBalanceInputDialog({ open: false });
                  }
                }
              }}
            />
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setBalanceInputDialog({ open: false })}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              const newBalance = parseFloat(newBalanceInput);
              if (!isNaN(newBalance) && balanceInputDialog.user) {
                handleUpdateBalance(balanceInputDialog.user.id, newBalance);
                setBalanceInputDialog({ open: false });
              }
            }}
            variant="contained"
          >
            Update
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog 
        open={paymentConfirmDialog.open} 
        onClose={() => !submitting && setPaymentConfirmDialog({ open: false })}
        maxWidth="sm" 
        fullWidth
      >
        <DialogTitle>Confirm SOL Payment</DialogTitle>
        
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 3 }}>
            This will send real cryptocurrency. This action cannot be undone.
          </Alert>

          <Stack spacing={2}>
            <TextField
              label="Recipient"
              value={`${paymentConfirmDialog.user?.firstName} ${paymentConfirmDialog.user?.lastName}`}
              fullWidth
              disabled
            />
            <TextField
              label="Email"
              value={paymentConfirmDialog.user?.email || ""}
              fullWidth
              disabled
            />
            <TextField
              label="Wallet Address"
              value={paymentConfirmDialog.user?.walletAddress || ""}
              fullWidth
              disabled
            />
            <TextField
              label="Amount (USD)"
              value={`$${paymentConfirmDialog.amountUSD?.toFixed(2)}`}
              fullWidth
              disabled
            />
            <TextField
              label="Amount (SOL)"
              value={`${paymentConfirmDialog.amountSOL?.toFixed(4)} SOL`}
              fullWidth
              disabled
            />
            <TextField
              label="New Balance"
              value={`$${paymentConfirmDialog.newBalance?.toFixed(2)}`}
              fullWidth
              disabled
            />
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button 
            onClick={() => setPaymentConfirmDialog({ open: false })} 
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmPayment}
            variant="contained"
            color="error"
            disabled={submitting}
          >
            {submitting ? "Sending..." : "Confirm Payment"}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}