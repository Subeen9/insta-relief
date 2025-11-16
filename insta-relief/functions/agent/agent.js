exports.runClaudeAgent = async function (userQuery) {
  const msg = await client.messages.create({
    model: "claude-sonnet-4-5-20250929", // ✅ CORRECT MODEL
    max_tokens: 1000,
    tools,
    system: `You are the Admin Automation Agent.
You generate simulated disasters, validate users, and automate admin tasks.
NEVER produce real emergency alerts.`,
    messages: [
      {
        role: "user",
        content: userQuery
      }
    ]
  });

  const toolCall = msg.content?.find(x => x.type === "tool_use");

  if (!toolCall) {
    return msg.content;
  }

  const handler = toolHandlers[toolCall.name];
  const result = await handler(toolCall.input);

  const final = await client.messages.create({
    model: "claude-sonnet-4-5-20250929", // ✅ AND HERE TOO
    max_tokens: 800,
    tools,
    system: `You are the Admin Automation Agent.`,
    messages: [
      {
        role: "user",
        content: userQuery
      },
      {
        role: "assistant",
        content: msg.content
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: JSON.stringify(result)
          }
        ]
      }
    ]
  });

  return final.content;
};