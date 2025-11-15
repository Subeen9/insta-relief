import { Container, Card, CardContent, Typography, Button, Stack } from "@mui/material";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";

export default function DashboardPage() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login");
  };

  return (
    <Container
      maxWidth="sm"
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        py: 4,
      }}
    >
      <Card sx={{ width: "100%", p: 4, borderRadius: 3 }}>
        <CardContent>
          <Typography
            variant="h4"
            align="center"
            sx={{ mb: 3, fontWeight: 700, color: "primary.main" }}
          >
            Dashboard
          </Typography>

          <Typography align="center" sx={{ mb: 4 }}>
            Your account has been created successfully.  
            This is your minimal dashboard.
          </Typography>

          <Stack spacing={2}>
            <Button
              fullWidth
              variant="contained"
              sx={{ borderRadius: 2, fontWeight: 600 }}
              onClick={() => alert("Feature coming soon!")}
            >
              View Policy Details
            </Button>

            <Button
              fullWidth
              variant="contained"
              color="success"
              sx={{ borderRadius: 2, fontWeight: 600 }}
              onClick={() => alert("Emergency Fund: Coming soon")}
            >
              Emergency Fund
            </Button>

            <Button
              fullWidth
              variant="outlined"
              sx={{ borderRadius: 2, fontWeight: 600 }}
              onClick={handleLogout}
            >
              Logout
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}
