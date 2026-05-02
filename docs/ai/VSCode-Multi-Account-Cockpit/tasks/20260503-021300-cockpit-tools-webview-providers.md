# Task: Cockpit Tools Webview Providers

- Version: `20260503-021300-cockpit-tools-webview-providers`
- Date: `2026-05-03`
- Base commit: `948f9e7`

## Goal

Keep the Cockpit Tools webview visually aligned with the expanded provider list already supported by the backend account aggregator.

## Scope

- update the webview description so it no longer implies a fixed 4-provider set
- add provider color mappings for newly supported Cockpit Tools providers

## Files

- `src/view/webview/cockpit_tools.js`

## Validation

- `npx eslint src/view/webview/cockpit_tools.js`
