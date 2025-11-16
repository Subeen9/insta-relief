import { useState, useRef, useEffect } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  TextField,
  Typography,
  Stack,
  Paper,
  CircularProgress,
  Chip,
  IconButton,
  Alert,
  Divider,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import PersonIcon from "@mui/icons-material/Person";
import FlashOnIcon from "@mui/icons-material/FlashOn";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  catastropheData?: any;
}

interface AIAssistantProps {
  functionUrl: string;
  onCatastrophePrepared?: (data: any) => void; // Callback to auto-fill dialog
}

export default function AIAssistant({ functionUrl, onCatastrophePrepared }: AIAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const quickActions = [
    { 
      label: "🌊 Trigger Flood", 
      query: "Trigger a flood catastrophe in zip code 70401 with $100 payout per user",
      icon: "🌊" 
    },
    { 
      label: "📊 Show Analytics", 
      query: "Show me analytics for all users" 
    },
    { 
      label: "💡 Smart Suggestions", 
      query: "Give me smart suggestions for catastrophe triggers" 
    },
    { 
      label: "📜 Recent Events", 
      query: "Show me the last 5 catastrophe events" 
    },
  ];

  const exampleTriggers = [
    "Trigger flood in zip 70401 with $100",
    "Send $150 hurricane relief to Louisiana users in zips 70401, 70408",
    "Payout $200 to all users in zip code 70405",
    "Create earthquake event for 70401 with $250 per person",
  ];

  const handleSendMessage = async (queryText?: string) => {
    const messageText = queryText || input.trim();
    
    if (!messageText || loading) return;

    const userMessage: Message = {
      role: "user",
      content: messageText,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch(functionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: messageText }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Check if AI prepared a catastrophe
      if (data.catastropheData && data.action === "TRIGGER_CATASTROPHE") {
        // Auto-fill the catastrophe dialog
        if (onCatastrophePrepared) {
          onCatastrophePrepared(data.catastropheData);
        }
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: data.response || "No response received",
        timestamp: new Date(),
        catastropheData: data.catastropheData,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error: any) {
      console.error("Error calling AI agent:", error);
      
      const errorMessage: Message = {
        role: "assistant",
        content: `Error: ${error.message}. Please check your Cloud Function URL.`,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleExecuteCatastrophe = (catastropheData: any) => {
    if (onCatastrophePrepared) {
      onCatastrophePrepared(catastropheData);
    }
  };

  return (
    <Card sx={{ height: "calc(100vh - 250px)", display: "flex", flexDirection: "column" }}>
      <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column", p: 0 }}>
        {/* Header */}
        <Box sx={{ p: 3, borderBottom: "1px solid", borderColor: "divider", background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <SmartToyIcon sx={{ color: "white" }} />
            <Typography variant="h6" sx={{ fontWeight: 600, color: "white" }}>
              AI Catastrophe Assistant
            </Typography>
            <Chip label="Auto-Fill Enabled" size="small" sx={{ backgroundColor: "rgba(255,255,255,0.2)", color: "white" }} />
          </Stack>
          <Typography variant="body2" sx={{ mt: 1, color: "rgba(255,255,255,0.9)" }}>
            Say "Trigger flood in zip 70401 with $100" and I'll auto-fill everything for you!
          </Typography>
        </Box>

        {/* Quick Actions & Examples */}
        {messages.length === 0 && (
          <Box sx={{ p: 3, borderBottom: "1px solid", borderColor: "divider", backgroundColor: "background.default" }}>
            <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600, display: "flex", alignItems: "center", gap: 1 }}>
              <FlashOnIcon fontSize="small" color="primary" />
              Quick Actions
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" gap={1} mb={3}>
              {quickActions.map((action, index) => (
                <Chip
                  key={index}
                  label={action.label}
                  onClick={() => handleSendMessage(action.query)}
                  clickable
                  color="primary"
                  variant="outlined"
                  size="medium"
                />
              ))}
            </Stack>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
              💬 Try These Natural Language Triggers:
            </Typography>
            <Stack spacing={1}>
              {exampleTriggers.map((example, index) => (
                <Paper
                  key={index}
                  sx={{
                    p: 1.5,
                    cursor: "pointer",
                    "&:hover": { backgroundColor: "action.hover" },
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                  onClick={() => handleSendMessage(example)}
                >
                  <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                    "{example}"
                  </Typography>
                </Paper>
              ))}
            </Stack>
          </Box>
        )}

        {/* Messages */}
        <Box
          sx={{
            flexGrow: 1,
            overflowY: "auto",
            p: 3,
            backgroundColor: "background.default",
          }}
        >
          {messages.length === 0 ? (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <SmartToyIcon sx={{ fontSize: 60, color: "text.disabled" }} />
              <Typography color="text.secondary" align="center" sx={{ maxWidth: 400 }}>
                <strong>I can auto-fill catastrophe forms!</strong>
                <br />
                Just tell me in plain English what catastrophe to trigger
              </Typography>
            </Box>
          ) : (
            <Stack spacing={2}>
              {messages.map((message, index) => (
                <Box key={index}>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: message.role === "user" ? "flex-end" : "flex-start",
                    }}
                  >
                    <Paper
                      elevation={message.role === "assistant" && message.catastropheData ? 3 : 1}
                      sx={{
                        p: 2,
                        maxWidth: "75%",
                        backgroundColor: message.role === "user" 
                          ? "primary.main" 
                          : message.catastropheData 
                            ? "#f0f7ff"
                            : "background.paper",
                        color: message.role === "user" ? "primary.contrastText" : "text.primary",
                        border: message.catastropheData ? "2px solid" : "none",
                        borderColor: message.catastropheData ? "primary.main" : "transparent",
                      }}
                    >
                      <Stack direction="row" spacing={1} alignItems="flex-start">
                        <Box sx={{ mt: 0.5 }}>
                          {message.role === "user" ? (
                            <PersonIcon fontSize="small" />
                          ) : (
                            <SmartToyIcon fontSize="small" color={message.catastropheData ? "primary" : "inherit"} />
                          )}
                        </Box>
                        <Box sx={{ flexGrow: 1 }}>
                          <Typography
                            variant="body2"
                            sx={{
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            {message.content}
                          </Typography>
                          <Typography
                            variant="caption"
                            sx={{
                              mt: 1,
                              display: "block",
                              opacity: 0.7,
                            }}
                          >
                            {message.timestamp.toLocaleTimeString()}
                          </Typography>
                        </Box>
                      </Stack>
                    </Paper>
                  </Box>

                  {/* Show catastrophe preview card */}
                  {message.catastropheData && (
                    <Box sx={{ display: "flex", justifyContent: "flex-start", mt: 1, ml: 6 }}>
                      <Paper
                        elevation={3}
                        sx={{
                          p: 2,
                          maxWidth: "70%",
                          backgroundColor: "success.light",
                          border: "2px solid",
                          borderColor: "success.main",
                        }}
                      >
                        <Stack spacing={2}>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <CheckCircleIcon color="success" />
                            <Typography variant="subtitle2" fontWeight={600}>
                              Catastrophe Ready to Execute
                            </Typography>
                          </Stack>

                          <Box sx={{ backgroundColor: "white", p: 2, borderRadius: 1 }}>
                            <Typography variant="caption" color="text.secondary" fontWeight={600}>
                              PRE-FILLED FORM DATA:
                            </Typography>
                            <Stack spacing={0.5} mt={1}>
                              <Typography variant="body2">
                                <strong>Type:</strong> {message.catastropheData.formData.type}
                              </Typography>
                              <Typography variant="body2">
                                <strong>Location:</strong> {message.catastropheData.formData.location}
                              </Typography>
                              <Typography variant="body2">
                                <strong>ZIP Codes:</strong> {message.catastropheData.formData.zipCodes}
                              </Typography>
                              <Typography variant="body2">
                                <strong>Amount:</strong> ${message.catastropheData.formData.amount}
                              </Typography>
                            </Stack>
                          </Box>

                          <Box sx={{ backgroundColor: "white", p: 2, borderRadius: 1 }}>
                            <Typography variant="caption" color="text.secondary" fontWeight={600}>
                              IMPACT ANALYSIS:
                            </Typography>
                            <Stack spacing={0.5} mt={1}>
                              <Typography variant="body2">
                                👥 <strong>{message.catastropheData.analysis.usersWithWallet}</strong> users will receive payment
                              </Typography>
                              <Typography variant="body2">
                                💰 <strong>${message.catastropheData.analysis.estimatedCost}</strong> total cost
                              </Typography>
                              <Typography variant="body2">
                                🪙 <strong>{message.catastropheData.analysis.estimatedSOL} SOL</strong> required
                              </Typography>
                            </Stack>
                          </Box>

                          <Button
                            variant="contained"
                            color="error"
                            size="large"
                            fullWidth
                            startIcon={<FlashOnIcon />}
                            onClick={() => handleExecuteCatastrophe(message.catastropheData)}
                            sx={{ fontWeight: 600 }}
                          >
                            Open Pre-Filled Dialog & Execute
                          </Button>

                          <Alert severity="info" sx={{ fontSize: "0.75rem" }}>
                            Clicking will auto-fill the catastrophe dialog with all this data. You just need to confirm and sign with Phantom!
                          </Alert>
                        </Stack>
                      </Paper>
                    </Box>
                  )}
                </Box>
              ))}
              {loading && (
                <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
                  <Paper elevation={1} sx={{ p: 2, backgroundColor: "background.paper" }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <CircularProgress size={16} />
                      <Typography variant="body2" color="text.secondary">
                        AI is preparing your catastrophe...
                      </Typography>
                    </Stack>
                  </Paper>
                </Box>
              )}
              <div ref={messagesEndRef} />
            </Stack>
          )}
        </Box>

        {/* Input */}
        <Box sx={{ p: 2, borderTop: "1px solid", borderColor: "divider", backgroundColor: "background.paper" }}>
          <Stack direction="row" spacing={1}>
            <TextField
              fullWidth
              placeholder='Try: "Trigger flood in zip 70401 with $100 payout"'
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={loading}
              multiline
              maxRows={3}
              variant="outlined"
              size="small"
            />
            <IconButton
              color="primary"
              onClick={() => handleSendMessage()}
              disabled={!input.trim() || loading}
              sx={{
                backgroundColor: "primary.main",
                color: "white",
                "&:hover": {
                  backgroundColor: "primary.dark",
                },
                "&:disabled": {
                  backgroundColor: "action.disabledBackground",
                },
              }}
            >
              <SendIcon />
            </IconButton>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}