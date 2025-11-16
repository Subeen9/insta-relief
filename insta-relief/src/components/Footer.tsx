import { Box, Typography } from "@mui/material";

export default function Footer() {
  return (
    <Box
      sx={{
        mt: 6,
        py: 2.5,
        textAlign: "center",
        color: "text.secondary",
        fontSize: "0.85rem",
        opacity: 0.75,
        borderTop: "1px solid rgba(16,185,129,0.25)", // soft green border
        backdropFilter: "blur(8px)",
      }}
    >
      <Typography sx={{ color: "#10B981", fontWeight: 500 }}>
        © {new Date().getFullYear()} InstaRelief — Built at Hack NYU
      </Typography>
    </Box>
  );
}
