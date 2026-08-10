# Architecture

## Overview

**xmcloud-extension-starter** is a Next.js 15 (App Router) application that demonstrates five Sitecore XM Cloud Marketplace extension points. It uses the `@sitecore-marketplace-sdk` for communication with the Sitecore host via `postMessage`, and integrates with Google Gemini for AI-powered ALT text generation.

## Tech Stack

| Layer        | Technology                        |
| ------------ | --------------------------------- |
| Framework    | Next.js 15 (App Router)           |
| UI           | React 19, TypeScript 5.9          |
| SDK          | @sitecore-marketplace-sdk/client   |
| XM Cloud SDK | @sitecore-marketplace-sdk/xmc      |
| AI           | Google Gemini (REST API)          |
| Styling      | Inline CSSProperties (no framework) |

## Directory Layout

```
src/
  app/
    layout.tsx                       # Root layout (<html>, <body>, <title>)
    custom-field-extension/page.tsx  # Custom field editor extension
    dashboard-widget-extension/page.tsx  # Dashboard widget extension
    fullscreen-extension/page.tsx    # Fullscreen overlay extension
    pages-contextpanel-extension/page.tsx  # Pages context panel (Media Inspector)
    standalone-extension/page.tsx    # Standalone page (Media Optimizer Dashboard)
  components/
    ApiKeyGate.tsx                   # Gemini API key prompt + provider (shared gate)
  utils/
    hooks/
      useMarketplaceClient.ts        # SDK initialization hook (singleton)
    apiKey.ts                        # localStorage helpers for the Gemini API key
    fieldTypes.ts                    # Shared GraphQL helpers & media field constants
    generateAltText.ts               # AI ALT text generation via Gemini
```

## Route Structure

Each extension point is a separate route under `src/app/`:

| Route                              | Extension Type       | Complexity |
| ---------------------------------- | -------------------- | ---------- |
| `/custom-field-extension`          | Custom Field Editor  | Simple     |
| `/dashboard-widget-extension`      | Dashboard Widget     | Simple     |
| `/fullscreen-extension`            | Fullscreen Overlay   | Simple     |
| `/standalone-extension`            | Standalone App       | Complex    |
| `/pages-contextpanel-extension`    | Pages Context Panel  | Complex    |

All pages are `'use client'` — the SDK communicates via `window.parent.postMessage`, which only works in the browser.

## Data Flow

```
Page mounts
  → useMarketplaceClient()           (creates/gets singleton ClientSDK)
    → client.query("application.context")
  → Extension-specific logic
    → GraphQL via client.mutate("xmc.authoring.graphql", ...)
      → search / getItem / updateItem
    → REST via fetch()                (Google Gemini for ALT text)
```

## Shared Modules

### `useMarketplaceClient.ts`
- Module-level singleton `ClientSDK` instance (lazy-initialized)
- Custom hook that manages `{ client, error, isLoading, isInitialized }` state
- Retry mechanism (3 attempts with exponential backoff)
- All five extension pages use this hook

### `fieldTypes.ts`
- Exports `MEDIA_DETAIL_FIELDS` (`Width`, `Height`, `Size`, `Extension`, `Alt`)
- `fetchAllItemFields()` — GraphQL query for all own fields of a Sitecore item
- `containsImageData()` — heuristic check for image references in field values
- `buildMediaDetailQuery()` — reusable GraphQL fragment builder

### `generateAltText.ts`
- `generateAltText(name, existingAltText, apiKey)` — calls Google Gemini (`gemini-2.5-flash-lite`) via REST; returns existing ALT text if already present (no-op)
- `generateStaticAltText(name)` — synchronous, API-key-free ALT generation; humanizes the item name (strips extension, splits `camelCase`/`kebab`/`snake`, drops leading numeric IDs) and returns `Image of <name>`
- Takes the caller-supplied Gemini API key (never read from the environment or bundled)
- The key is sent only in the `x-goog-api-key` request header to Google; it is never logged, put in URL parameters, or included in errors/analytics

### `apiKey.ts`
- `loadStoredApiKey()` / `storeApiKey()` / `clearStoredApiKey()`
- Stores the Gemini API key in `localStorage` under `media-optimizer:gemini-api-key` (opt-in only)
- All reads/writes are wrapped in try/catch; failures are silent (key stays in memory for the session)

### `ApiKeyGate.tsx`
- Shared gate wrapping both ALT-generating pages (Standalone and Pages Context Panel)
- Shows a setup form when no generation method is chosen:
  - **API key path** — masked input + "Remember API key on this device" checkbox with a privacy warning
  - **Static path** — "Don't have an API key — use static ALT generation" (uses `generateStaticAltText`, nothing is stored or sent)
- Unchecked = key kept in memory for the session only and re-asked on the next launch
- Checked = key persisted to `localStorage` for this device
- Exposes `useApiKey()` (`mode` = `'api' | 'static'`, `apiKey`, `hasStoredKey`, `clearSavedKey`) and a "Clear saved API key" control in each page's header

## SDK Communication

The `ClientSDK` from `@sitecore-marketplace-sdk/client` uses a `window.parent` postMessage bridge:

```
Extension (iframe)  ←→  Sitecore Host (parent window)
       client.query() / client.mutate() / client.setValue()
```

This means:
- The extension runs inside a Sitecore-hosted iframe
- All SDK calls are asynchronous (return Promises)
- The host provides `application.context`, `xmc.xmapp.listSites`, `xmc.authoring.graphql`, etc.

## State Management

No global state library. Each page manages its own state with:
- `useState` for UI state (items, filters, action states)
- `useEffect` for initialization and subscriptions
- `useMemo` / `useCallback` for derived values and stable references
- A module-level singleton for the SDK client instance

## Key Patterns

1. **Retry on initialization** — `useMarketplaceClient` retries SDK connect with exponential backoff
2. **Action state tracking** — Complex pages track per-item action state (`idle | working | done | failed`)
3. **Inline styles** — All styling is done via `const styles: Record<string, CSSProperties>` objects at the bottom of each component file
4. **GraphQL via SDK** — All Sitecore data operations use `client.mutate('xmc.authoring.graphql', { query, variables })`
5. **Real-time context** — The Pages Context Panel page subscribes to `pages.context` with `subscribe: true` for live updates on page changes

## Extension Specifics

### Custom Field (`custom-field-extension`)
- Reads existing field value from context
- Offers 3 preset options
- Writes with `client.setValue()` then closes via `client.closeApp()`

### Dashboard Widget (`dashboard-widget-extension`)
- Simplest extension — just displays `application.context` fields
- Wrapped in a bordered card

### Fullscreen (`fullscreen-extension`)
- Similar to Dashboard Widget — displays context fields
- Demonstrates fullscreen iframe embedding

### Standalone (`standalone-extension` — Media Optimizer)
- Full media auditing dashboard
- Searches entire Media Library via GraphQL `search` mutation with offset pagination: a count query (`pageSize: 1`) reads `totalCount`, then all pages are fetched in parallel batches (`pageSize: 250`, `skip` offsets, concurrency 5) and merged/deduped by item ID — no 1500-item cap; falls back to a single `pageSize: 1000` query if `totalCount` is not exposed
- Computes optimization score per item (ALT text, file size, aspect ratio, format)
- Supports filtering and per-item actions (generate ALT, copy path, open editor)

### Pages Context Panel (`pages-contextpanel-extension` — Page Media Inspector)
- Inspects currently selected page in XM Cloud Pages
- Extracts media references from: page fields, rendering data sources, direct item fields
- Shows per-image analysis with score, issues, and ALT generation
- Subscribes to real-time page context changes

## External Dependencies

```
@sitecore-marketplace-sdk/client    — ClientSDK, ApplicationContext types
@sitecore-marketplace-sdk/xmc       — XMC module registration
next                                — Framework + Metadata types
react / react-dom                   — UI
```

Dev: `eslint`, `typescript`, `@types/react`, `@types/node`, `eslint-config-next`.
