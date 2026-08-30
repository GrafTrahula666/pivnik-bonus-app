# Customer runtime compatibility adapters — PREPARED, NOT ACTIVE

These files are intentionally **not imported** by the current PIVNIK VK/TG production runtime.

They are prepared for the pilot stage after explicit approval.

## venue-config-resolver.cjs

Reads the same PostgreSQL database directly from the existing customer backend.

Fallback contract:

```text
valid DB configuration -> use DB value
missing / invalid / query error -> existing legacy production value
```

There is no HTTP dependency on Admin Platform.

## telemetry-best-effort.cjs

Adds durable events with fire-and-forget error handling.

The primary customer action does not await the analytics insert.
A telemetry failure is logged and swallowed.

## Pilot rule

Integrate one adapter at a time into the existing customer repository and run VK + Telegram regression after every step.
Do not make the customer runtime import, boot, or call the Admin server.
