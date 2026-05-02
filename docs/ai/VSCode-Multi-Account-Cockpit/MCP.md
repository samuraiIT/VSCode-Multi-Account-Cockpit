# MCP Notes

- Requested by user: use Context7 or other MCP if available.
- Session state at task start:
  - MCP resources: unavailable
  - MCP resource templates: unavailable
- Fallback used: direct local repository inspection and parallel sub-agents.

## 20260502-232100-context7-mcp-setup

- Source of truth used: `C:\Диск D\!project_Windows\docs\mcp\MCP_RemoteSSH_Ubuntu_Auto_Setup.md`
- Global Codex MCP config updated via CLI, not by ad-hoc TOML editing:
  - `codex mcp add context7 --url https://mcp.context7.com/mcp`
- Result:
  - `codex mcp list` shows `context7` as `enabled`
  - transport: `streamable_http`
  - auth: `OAuth`
- Config location:
  - `C:\Users\rooot\.codex\config.toml`
- Runtime caveat:
  - the currently running agent session did not hot-reload the newly added MCP server
  - direct MCP developer tools in this session still report `unknown MCP server 'context7'`
  - the configuration is ready for new Codex sessions and CLI runs started after the change
- Fresh-process verification:
  - a new `codex exec` process successfully reported `CONTEXT7_USED`
  - it confirmed that `@modelcontextprotocol/sdk` now recommends `registerTool` over legacy `tool()`
