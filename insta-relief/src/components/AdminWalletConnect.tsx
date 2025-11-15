import { useEffect, useState } from "react";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { ensureConnected, getProvider, getBalance } from "../lib/solana";

export default function AdminWalletConnect() {
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if already connected
    const provider = getProvider();
    if (provider?.publicKey) {
      const address = provider.publicKey.toString();
      setWalletAddress(address);
      loadBalance(address);
    }
  }, []);

  const loadBalance = async (address: string) => {
    const bal = await getBalance(address);
    setBalance(bal);
  };

  const handleConnect = async () => {
    try {
      setLoading(true);
      const publicKey = await ensureConnected();
      const address = publicKey.toString();
      setWalletAddress(address);
      await loadBalance(address);
    } catch (error: any) {
      console.error("Error connecting wallet:", error);
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await getProvider()?.disconnect();
      setWalletAddress("");
      setBalance(0);
    } catch (error: any) {
      console.error("Error disconnecting wallet:", error);
    }
  };

  return (
    <Box
      sx={{
        p: 2,
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        backgroundColor: "background.paper",
      }}
    >
      <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
        Admin Wallet (Payer)
      </Typography>

      {!walletAddress ? (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            Connect your Phantom wallet to send payouts
          </Typography>
          <Button
            variant="contained"
            onClick={handleConnect}
            disabled={loading}
            sx={{ alignSelf: "flex-start" }}
          >
            {loading ? "Connecting..." : "Connect Phantom"}
          </Button>
        </Stack>
      ) : (
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Connected Wallet:
            </Typography>
            <Chip
              label={`${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}`}
              size="small"
              sx={{ ml: 1 }}
            />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Balance:
            </Typography>
            <Typography
              component="span"
              sx={{ ml: 1, fontWeight: 600, color: "success.main" }}
            >
              {balance.toFixed(4)} SOL
            </Typography>
          </Box>
          <Button
            variant="outlined"
            size="small"
            onClick={handleDisconnect}
            sx={{ alignSelf: "flex-start" }}
          >
            Disconnect
          </Button>
        </Stack>
      )}
    </Box>
  );
}