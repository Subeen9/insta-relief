import { CssBaseline } from "@mui/material";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppThemeProvider from "./theme/AppThemeProvider";
import OnboardingPage from "../src/pages/Onboarding";
import LoginPage from "../src/pages/Login";



export default function App() {
  return (
    <AppThemeProvider>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/Onboarding" element={<OnboardingPage />} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </BrowserRouter>
    </AppThemeProvider>
  );
}