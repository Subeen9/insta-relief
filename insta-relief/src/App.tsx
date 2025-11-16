import { CssBaseline } from "@mui/material";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import AppThemeProvider from "./theme/AppThemeProvider";
import OnboardingPage from "../src/pages/Onboarding";
import LoginPage from "../src/pages/Login";
import DashboardPage from "../src/pages/Dashboard"
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";



export default function App() {
  return (
    <AppThemeProvider>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<OnboardingPage />} />
          <Route path="/login" element={<LoginPage />} />
           <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/admin" element={<AdminLogin />} />
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
        </Routes>
      </BrowserRouter>
    </AppThemeProvider>
  );
}