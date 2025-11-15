import { CssBaseline } from "@mui/material";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import AppThemeProvider from "./theme/AppThemeProvider";
import LoginPage from "../src/pages/Login";
import OnboardingPage from "../src/pages/Onboarding";
import DashboardPage from "../src/pages/Dashboard";

export default function App() {
  return (
    <AppThemeProvider>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
        </Routes>
      </BrowserRouter>
    </AppThemeProvider>
  );
}
