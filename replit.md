# Tahir AI Writer Platform

## Overview

A full-stack AI-powered WordPress content management platform. Users can manage WordPress sites, generate AI articles, auto-publish to WordPress, schedule posts, and track article history.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifact: tahir-ai-writer), Tailwind CSS, wouter routing
- **API framework**: Express 5 (artifact: api-server)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI Article Writing**: LongCat API (default key: ak_23V6tb6f04Vq4m030D2SA74N0EW1a)
- **AI Images**: Pollinations API (free, no key needed)

## Admin Credentials

- Email: tahirkhatri1927@gmail.com
- Password: tahir123@#

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/tahir-ai-writer run dev` — run frontend locally

## Project Structure

```
artifacts/
  api-server/         # Express 5 API server
    src/
      routes/         # auth, users, sites, folders, articles, generate, dashboard, settings
      lib/
        auth.ts       # JWT-like token auth, password hashing
        generator.ts  # Background article generation queue (5 concurrent)
  tahir-ai-writer/    # React + Vite frontend
    src/
      pages/          # login, dashboard, sites, generate, history, article-urls, failed-articles, users, settings
      components/     # layout (sidebar), UI components
lib/
  api-spec/           # OpenAPI spec (single source of truth)
  api-client-react/   # Generated React Query hooks
  api-zod/            # Generated Zod validation schemas
  db/
    src/schema/
      users.ts        # Users + permissions table
      sites.ts        # Sites + folders tables
      articles.ts     # Articles table
      settings.ts     # App settings table (LongCat API key etc.)
```

## Features

- **Authentication**: Session-based with JWT-like tokens stored in localStorage
- **Admin panel**: Full user management, password reset for any user, role-based access
- **Sites**: WordPress sites via application passwords, folder organization, pin/unpin, bulk operations, auto-connect
- **Generate**: Bulk keyword input, language selection (8 languages), word count, image source (Pollinations/URL), scheduled publishing, folder-based site selection
- **Background generation**: Queue with max 5 concurrent, persists across page refreshes
- **Article lifecycle**: queued → generating → published/draft/failed/scheduled
- **History & URLs**: Full article history with filtering, today's published URLs grouped by site
- **Settings (admin)**: LongCat API key/model management, custom APIs, generation defaults

## Models Available

- LongCat-Flash-Chat (default)
- LongCat-Flash-Thinking-2601

## Auth Flow

1. POST /api/auth/login → returns user + token
2. Token stored in localStorage as 'auth_token'
3. All API calls include `Authorization: Bearer <token>` header
4. GET /api/auth/me validates token on app load
