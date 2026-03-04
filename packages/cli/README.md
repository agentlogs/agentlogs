# agentlogs

CLI for uploading and syncing AI coding agent transcripts to [AgentLogs](https://agentlogs.ai).

## Usage

```bash
# Authenticate
npx agentlogs login agentlogs.ai
npx agentlogs status
npx agentlogs logout

# Repository settings
npx agentlogs allow --public   # allow capture for current repo
npx agentlogs deny             # deny capture for current repo
npx agentlogs settings         # view/modify settings
```

For agent specific commands, see the [agent specific documentation](https://agentlogs.ai/docs/agents).

## License

FSL-1.1-Apache-2.0
