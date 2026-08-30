# Kickbase Assistant — web app

Multi-tenant dashboard for the Kickbase automation in `../kickbase/` (the
Python CLI/bot). Every user connects their own Kickbase account and
Telegram, and sees the same reports that project's CLI prints — as a real
dashboard instead of chat replies. See `../supabase/` for the backend
(schema + Edge Functions) and the plan this was built from in this
session's conversation history for the full architecture rationale.

## Stack

Next.js (App Router, TypeScript) + Tailwind + shadcn/ui + Framer Motion +
Recharts, talking to Supabase (Postgres + Auth + Edge Functions + Cron +
Vault) via `@supabase/ssr`. No other infrastructure - deploys to Vercel.

## Setup

1. Create a Supabase project, then apply the schema:
   ```bash
   cd ../supabase
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
2. Copy the env template and fill in your project's API values (Project
   Settings → API in the Supabase dashboard):
   ```bash
   cp .env.local.example .env.local
   ```
   `NEXT_PUBLIC_*` values only - the `service_role` key never belongs in
   this app; it's an Edge Function secret only (`supabase secrets set`).
3. Install and run:
   ```bash
   npm install
   npm run dev
   ```

## Structure

- `src/lib/supabase/` — browser/server Supabase clients + the session-
  refresh middleware helper (`middleware.ts` at the repo root wires it in)
- `src/app/(dashboard)/` — the authenticated app shell (sidebar + topbar)
  and every report page; middleware redirects unauthenticated requests to
  `/login`
- `src/app/login`, `src/app/signup`, `src/app/auth/callback` — Supabase
  Auth email/password flow
- `src/components/ui/` — shadcn/ui primitives (generated, not hand-edited)
