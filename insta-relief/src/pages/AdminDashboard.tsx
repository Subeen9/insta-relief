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

interface UserData {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  zip: string;
  policyId: string;
  balance: number;
  status: string;
  isActivated: boolean;
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
  const navigate = useNavigate();

  useEffect(() => {
    const checkAdminAndFetchData = async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        navigate("/admin");
        return;
      }

      try {
        const idTokenResult = await currentUser.getIdTokenResult();
        if (!idTokenResult.claims.admin) {
          alert("Access denied. Admin privileges required.");
          await signOut(auth);
          navigate("/admin");
          return;
        }

        await fetchUsers();
        await fetchCatastrophes();
      } catch (error) {
        console.error(error);
        alert("Failed to verify admin status.");
        navigate("/admin");
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
    navigate("/admin");
  };

  const handleUpdateBalance = async (userId: string, newBalance: number) => {
    try {
      await updateDoc(doc(db, "users", userId), {
        balance: newBalance,
      });
      setMessage({ type: "success", text: "Balance updated successfully!" });
      await fetchUsers();
    } catch (error) {
      console.error(error);
      setMessage({ type: "error", text: "Failed to update balance." });
    }
  };

  const handleTriggerCatastrophe = async () => {
    if (!catastropheData.type || !catastropheData.location || !catastropheData.zipCodes || !catastropheData.amount) {
      setMessage({ type: "error", text: "Please fill all required fields." });
      return;
    }

    setSubmitting(true);
    try {
      const zipCodesArray = catastropheData.zipCodes.split(",").map((zip) => zip.trim());
      const amount = parseFloat(catastropheData.amount);

      // Create catastrophe record
      await addDoc(collection(db, "catastrophes"), {
        type: catastropheData.type,
        location: catastropheData.location,
        zipCodes: zipCodesArray,
        amount: amount,
        description: catastropheData.description,
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser?.email,
      });

      // Update balances for affected users
      const usersSnapshot = await getDocs(collection(db, "users"));
      const updatePromises: Promise<void>[] = [];

      usersSnapshot.forEach((userDoc) => {
        const userData = userDoc.data();
        if (zipCodesArray.includes(userData.zip)) {
          const newBalance = (userData.balance || 0) + amount;
          updatePromises.push(
            updateDoc(doc(db, "users", userDoc.id), {
              balance: newBalance,
            })
          );
        }
      });

      await Promise.all(updatePromises);

      setMessage({
        type: "success",
        text: `Catastrophe triggered! ${updatePromises.length} users affected.`,
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
    } catch (error) {
      console.error(error);
      setMessage({ type: "error", text: "Failed to trigger catastrophe." });
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
                      <TableCell>${user.balance.toFixed(2)}</TableCell>
                      <TableCell>
                        <Button
                          size="small"
                          onClick={() => {
                            const newBalance = prompt(
                              `Enter new balance for ${user.firstName} ${user.lastName}:`,
                              user.balance.toString()
                            );
                            if (newBalance !== null) {
                              handleUpdateBalance(user.id, parseFloat(newBalance));
                            }
                          }}
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

      {/* Catastrophe Trigger Dialog */}
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
            onClick={handleTriggerCatastrophe}
            variant="contained"
            color="error"
            disabled={submitting}
          >
            {submitting ? "Processing..." : "Trigger Event"}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}