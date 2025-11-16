import { AppBar, Toolbar, Typography, Button } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";

export default function Navbar() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/");
  };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        background: "rgba(10, 15, 20, 0.75)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(16,185,129,0.25)", // green subtle line
        px: 2,
      }}
    >
      <Toolbar sx={{ display: "flex", justifyContent: "space-between" }}>
        
        {/* Brand */}
        <Typography
          variant="h6"
          sx={{
            fontWeight: 800,
            letterSpacing: 0.5,
            color: "#10B981",               // emerald green
            textShadow: "0 0 6px rgba(16,185,129,0.4)", // soft glow
          }}
        >
          InstaRelief
        </Typography>

        {/* Logout */}
        <Button
          variant="contained"
          onClick={handleLogout}
          sx={{
            textTransform: "none",
            fontWeight: 600,
            px: 2,
            backgroundColor: "#10B981",
            color: "#0B0F14",
            "&:hover": {
              backgroundColor: "#0EA370",
            },
            borderRadius: 2,
            boxShadow: "0 0 10px rgba(16,185,129,0.35)",
          }}
        >
          Logout
        </Button>
      </Toolbar>
    </AppBar>
  );
}
