import { useEffect, useMemo, useState } from "react";
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  type PaletteMode,
  GlobalStyles,
} from "@mui/material";
import { alpha } from "@mui/material/styles";

const STORAGE_KEY = "lpn_color_mode";

const PALETTE = {
  primary: {
    main: "#0E9F6E", // Calming emerald (trust, growth)
    dark: "#0B7450",
    light: "#4FD1A1",
    contrastText: "#FFFFFF",
  },
  secondary: {
    main: "#1E3A8A", // Deep fintech navy (stability)
    light: "#3B82F6",
    dark: "#1E293B",
    contrastText: "#FFFFFF",
  },
  info: {
    main: "#0284C7", // Modern tech blue (clarity, alert)
    dark: "#0369A1",
    light: "#7DD3FC",
    contrastText: "#F0F9FF",
  },
  warning: {
    main: "#FBBF24", // Warm amber (preparedness)
    dark: "#B45309",
    light: "#FDE68A",
    contrastText: "#1A1A1A",
  },
  success: {
    main: "#16A34A",
    dark: "#166534",
    light: "#86EFAC",
    contrastText: "#FFFFFF",
  },
  error: {
    main: "#DC2626",
    dark: "#991B1B",
    light: "#FCA5A5",
    contrastText: "#FFFFFF",
  },
};

function buildTheme(mode: PaletteMode) {
  const isDark = mode === "dark";
  return createTheme({
    palette: {
      mode,
      primary: PALETTE.primary,
      secondary: PALETTE.secondary,
      info: PALETTE.info,
      warning: PALETTE.warning,
      success: PALETTE.success,
      error: PALETTE.error,
      background: {
        default: isDark ? "#0B0E11" : "#F8FAFC", // clean fintech off-white or graphite
        paper: isDark ? "#111827" : "#FFFFFF",
      },
      text: {
        primary: isDark ? "#E5E7EB" : "#111827",
        secondary: isDark ? "#9CA3AF" : "#374151",
      },
      divider: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
      action: {
        hover: alpha(PALETTE.primary.main, isDark ? 0.1 : 0.08),
        selected: alpha(PALETTE.primary.main, isDark ? 0.18 : 0.12),
        focus: alpha(PALETTE.primary.main, isDark ? 0.24 : 0.18),
        disabledOpacity: 0.38,
      },
    },
    typography: {
      fontFamily:
        "Inter, 'Public Sans', system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      h1: { fontWeight: 700, letterSpacing: -0.5 },
      h2: { fontWeight: 700, letterSpacing: -0.25 },
      h3: { fontWeight: 600 },
      h5: { fontWeight: 600 },
      button: { textTransform: "none", fontWeight: 600 },
      subtitle1: { fontWeight: 500 },
    },
    shape: { borderRadius: 12 },
    components: {
      MuiButton: {
        defaultProps: { variant: "contained", disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 12,
            fontWeight: 600,
            transition: "background-color .2s ease, box-shadow .2s ease",
          },
          containedPrimary: {
            backgroundColor: PALETTE.primary.main,
            color: PALETTE.primary.contrastText,
            "&:hover": { backgroundColor: PALETTE.primary.dark },
            "&:active": { backgroundColor: alpha(PALETTE.primary.dark, 0.9) },
          },
          outlinedPrimary: {
            borderColor: alpha(PALETTE.primary.main, 0.5),
            color: PALETTE.primary.main,
            "&:hover": {
              borderColor: PALETTE.primary.main,
              backgroundColor: alpha(PALETTE.primary.main, isDark ? 0.18 : 0.08),
            },
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: "primary" },
        styleOverrides: {
          root: {
            backgroundColor: isDark ? "#111827" : "#FFFFFF",
            color: isDark ? "#E5E7EB" : "#0F172A",
            borderBottom: `1px solid ${
              isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"
            }`,
          },
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            boxShadow: isDark
              ? "0 2px 10px rgba(0,0,0,0.6)"
              : "0 2px 10px rgba(0,0,0,0.05)",
          },
        },
      },
    },
  });
}

export default function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<PaletteMode>("light");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as PaletteMode | null;
    if (saved === "light" || saved === "dark") {
      setMode(saved);
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystem = () => setMode(mq.matches ? "dark" : "light");
    applySystem();
    mq.addEventListener("change", applySystem);
    return () => mq.removeEventListener("change", applySystem);
  }, []);

  useEffect(() => {
    document.documentElement.style.colorScheme = mode;
    window.dispatchEvent(new CustomEvent("color-mode-changed", { detail: { mode } }));
  }, [mode]);

  const theme = useMemo(() => buildTheme(mode), [mode]);

  const toggleMode = () => {
    setMode((m) => {
      const next = m === "light" ? "dark" : "light";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      return next;
    });
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          body: {
            backgroundColor: theme.palette.background.default,
            color: theme.palette.text.primary,
          },
        }}
      />
      <ColorToggleBridge onToggle={toggleMode} />
      {children}
    </ThemeProvider>
  );
}

function ColorToggleBridge({ onToggle }: { onToggle: () => void }) {
  useEffect(() => {
    const handler = () => onToggle();
    window.addEventListener("toggle-color-mode", handler as EventListener);
    return () => window.removeEventListener("toggle-color-mode", handler as EventListener);
  }, [onToggle]);
  return null;
}