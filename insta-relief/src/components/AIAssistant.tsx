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
  Skeleton,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import PersonIcon from "@mui/icons-material/Person";
import FlashOnIcon from "@mui/icons-material/FlashOn";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RefreshIcon from "@mui/icons-material/Refresh";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  catastropheData?: any;
}

interface AIAssistantProps {
  functionUrl: string;
  onCatastrophePrepared?: (data: any) => void;
}

export default function AIAssistant({ functionUrl, onCatastrophePrepared }: AIAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const messagesEndRef = useRef<any>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    fetchPlatformConfig();
  }, []);

  const fetchPlatformConfig = async () => {
    setLoadingConfig(true);
    try {
      const response = await fetch(functionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "Get platform configuration" }),
      });

      if (response.ok) await response.json();
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoadingConfig(false);
    }
  };

  const quickActions = [
    { label: "Show Analytics", query: "Show me detailed analytics for all users" },
    { label: "Recent Events", query: "Show me the last 5 catastrophe events" },
  ];

  const exampleTriggers = [
    "Trigger flood in zip 70401 with 100 dollars",
    "Send 150 hurricane relief to Louisiana users in zips 70401, 70408",
    "Payout 200 dollars to all users in zip code 70405",
    "Create earthquake event for 70401 with 250 dollars per person",
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: messageText }),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();

      if (data.catastropheData && data.action === "AUTO_CATASTROPHE_TRIGGERED") {
        onCatastrophePrepared?.(data.catastropheData);
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.response || "No response received",
          timestamp: new Date(),
          catastropheData: data.catastropheData,
        },
      ]);
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${error.message}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: any) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleExecuteCatastrophe = (catastropheData: any) => {
    onCatastrophePrepared?.(catastropheData);
  };

  return (
    <Card
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
      }}
    >
      <CardContent sx={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, p: 0 }}>
        <Box
          sx={{
            p: 3,
            borderBottom: "1px solid",
            borderColor: "divider",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <SmartToyIcon sx={{ color: "white" }} />
            <Typography variant="h6" sx={{ color: "white", fontWeight: 600 }}>
              AI Catastrophe Assistant
            </Typography>
            <Chip
              label="Auto-Fill Enabled"
              size="small"
              sx={{ backgroundColor: "rgba(255,255,255,0.2)", color: "white" }}
            />
            <Box sx={{ flexGrow: 1 }} />
            <IconButton size="small" sx={{ color: "white" }} onClick={fetchPlatformConfig}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Typography sx={{ mt: 1, color: "rgba(255,255,255,0.9)" }}>
            You can trigger catastrophes using natural language instructions.
          </Typography>
        </Box>

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            p: 3,
            backgroundColor: "background.default",
          }}
        >
          {messages.length === 0 ? (
            <>
              <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                Quick Actions
              </Typography>

              {loadingConfig ? (
                <Stack spacing={1}>
                  <Skeleton variant="rectangular" height={32} />
                  <Skeleton variant="rectangular" height={32} />
                </Stack>
              ) : (
                <Stack direction="row" spacing={1} flexWrap="wrap" mb={3}>
                  {quickActions.map((action, i) => (
                    <Chip
                      key={i}
                      label={action.label}
                      onClick={() => handleSendMessage(action.query)}
                      clickable
                      color="primary"
                      variant="outlined"
                    />
                  ))}
                </Stack>
              )}

              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
                Example Commands
              </Typography>

              <Stack spacing={1}>
                {exampleTriggers.map((example, i) => (
                  <Paper
                    key={i}
                    sx={{
                      p: 1.5,
                      cursor: "pointer",
                      "&:hover": { backgroundColor: "action.hover" },
                      border: "1px solid",
                      borderColor: "divider",
                    }}
                    onClick={() => handleSendMessage(example)}
                  >
                    <Typography sx={{ fontFamily: "monospace" }}>{example}</Typography>
                  </Paper>
                ))}
              </Stack>
            </>
          ) : (
            <Stack spacing={2}>
              {messages.map((message, idx) => (
                <Box key={idx}>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: message.role === "user" ? "flex-end" : "flex-start",
                    }}
                  >
                    <Paper
                      elevation={0}
                      sx={{
                        p: 2,
                        maxWidth: "75%",
                        backgroundColor: message.role === "user"
                          ? "primary.main !important"
                          : message.catastropheData
                          ? "#f0f7ff !important"
                          : "transparent !important",
                        color: message.role === "user" ? "white" : "text.primary",
                        border: message.catastropheData ? "2px solid" : "1px solid",
                        borderColor: message.catastropheData ? "primary.main" : "divider",
                        wordBreak: "break-word",
                        overflowWrap: "break-word",
                        backgroundImage: "none !important",
                      }}
                    >
                      <Stack direction="row" spacing={1}>
                        {message.role === "user" ? (
                          <PersonIcon sx={{ mt: 0.5, flexShrink: 0 }} />
                        ) : (
                          <SmartToyIcon
                            sx={{
                              mt: 0.5,
                              flexShrink: 0,
                              color: message.catastropheData ? "primary.main" : "inherit",
                            }}
                          />
                        )}

                        <Box sx={{ flex: 1, minWidth: 0, maxWidth: "100%" }}>
                          <Box 
                            component="div"
                            sx={{ 
                              wordBreak: "break-word",
                              overflowWrap: "break-word",
                              backgroundColor: 'transparent !important',
                              '& *': {
                                backgroundColor: 'transparent !important',
                                background: 'transparent !important',
                              },
                              '& p': {
                                backgroundColor: 'transparent !important',
                                background: 'transparent !important',
                              },
                              '& span': {
                                backgroundColor: 'transparent !important',
                                background: 'transparent !important',
                              },
                              '& div': {
                                backgroundColor: 'transparent !important',
                                background: 'transparent !important',
                              },
                            }}
                          >
                            {message.content
                              .replace(/[✅☑️✓]/g, '• ')
                              .replace(/\*\*/g, '')
                              .split('\n')
                              .map((line, i) => (
                                <Typography 
                                  key={i} 
                                  sx={{ 
                                    my: 0.25,
                                    backgroundColor: 'transparent !important',
                                    background: 'transparent !important',
                                  }}
                                >
                                  {line}
                                </Typography>
                              ))}
                          </Box>
                          <Typography 
                            variant="caption" 
                            sx={{ 
                              display: 'block', 
                              mt: 1,
                              backgroundColor: 'transparent !important',
                            }}
                          >
                            {message.timestamp.toLocaleTimeString()}
                          </Typography>
                        </Box>
                      </Stack>
                    </Paper>
                  </Box>

                  {message.catastropheData && (
                    <Box sx={{ mt: 1, ml: 6 }}>
                      <Paper
                        sx={{
                          p: 2,
                          maxWidth: "70%",
                          backgroundColor: "success.light",
                          border: "2px solid",
                          borderColor: "success.main",
                          wordBreak: "break-word",
                          overflowWrap: "break-word",
                        }}
                      >
                        <Stack spacing={2}>
                          <Stack direction="row" spacing={1}>
                            <CheckCircleIcon color="success" sx={{ flexShrink: 0 }} />
                            <Typography fontWeight={600}>Catastrophe Ready</Typography>
                          </Stack>

                          <Box 
                            sx={{ 
                              backgroundColor: "white", 
                              p: 2, 
                              borderRadius: 1,
                              wordBreak: "break-word",
                              overflowWrap: "break-word",
                            }}
                          >
                            <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
                              PRE-FILLED DATA
                            </Typography>
                            <Typography sx={{ wordBreak: "break-word" }}>
                              <strong>Type:</strong> {message.catastropheData.formData.type}
                            </Typography>
                            <Typography sx={{ wordBreak: "break-word" }}>
                              <strong>Location:</strong> {message.catastropheData.formData.location}
                            </Typography>
                            <Typography sx={{ wordBreak: "break-word" }}>
                              <strong>ZIP Codes:</strong> {message.catastropheData.formData.zipCodes}
                            </Typography>
                            <Typography sx={{ wordBreak: "break-word" }}>
                              <strong>Amount:</strong> {message.catastropheData.formData.amount} dollars
                            </Typography>
                          </Box>

                          <Box 
                            sx={{ 
                              backgroundColor: "white", 
                              p: 2, 
                              borderRadius: 1,
                              wordBreak: "break-word",
                              overflowWrap: "break-word",
                            }}
                          >
                            <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
                              IMPACT ANALYSIS
                            </Typography>
                            <Typography sx={{ wordBreak: "break-word" }}>
                              {message.catastropheData.analysis.usersWithWallet} users will receive payment
                            </Typography>
                            <Typography sx={{ wordBreak: "break-word" }}>
                              {message.catastropheData.analysis.estimatedCost} dollars total
                            </Typography>
                            <Typography sx={{ wordBreak: "break-word" }}>
                              {message.catastropheData.analysis.estimatedSOL} SOL required
                            </Typography>
                          </Box>

                          <Button
                            variant="contained"
                            color="error"
                            fullWidth
                            startIcon={<FlashOnIcon />}
                            onClick={() => handleExecuteCatastrophe(message.catastropheData)}
                          >
                            Execute Catastrophe
                          </Button>
                        </Stack>
                      </Paper>
                    </Box>
                  )}
                </Box>
              ))}

              {loading && (
                <Paper sx={{ p: 2, maxWidth: "75%" }}>
                  <Stack direction="row" spacing={1}>
                    <CircularProgress size={16} />
                    <Typography>AI is preparing your catastrophe...</Typography>
                  </Stack>
                </Paper>
              )}

              <div ref={messagesEndRef} />
            </Stack>
          )}
        </Box>

        <Box
          sx={{
            p: 2,
            borderTop: "1px solid",
            borderColor: "divider",
            backgroundColor: "background.paper",
          }}
        >
          <Stack direction="row" spacing={1}>
            <TextField
              fullWidth
              placeholder='Example: "Trigger flood in zip 70401 with 100 dollars"'
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={loading}
              multiline
              maxRows={3}
              size="small"
            />

            <IconButton
              color="primary"
              onClick={() => handleSendMessage()}
              disabled={!input.trim() || loading}
              sx={{
                backgroundColor: "primary.main",
                color: "white",
                "&:hover": { backgroundColor: "primary.dark" },
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