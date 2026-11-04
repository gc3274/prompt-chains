# Deconstructive Criticism Prompt Chains

A tool for building and testing the prompt chains behind [Deconstructive Criticism](https://github.com/gc3274/hw1) (live at [hw1-two.vercel.app](https://hw1-two.vercel.app)), the app where AI critics roast what you made, score it out of 10 and leave one real tip.

A prompt chain is the main app's roast pipeline: an ordered list of steps, each one call to a model, each step's answer feeding the next, with the last step writing the reviews. (The course schema calls these humor flavors.) This is a separate Next.js app on the same Supabase project and the same Google login as the main app and its [admin area](https://github.com/gc3274/hw6). Only profiles with `is_superadmin = true` get in.

Stack: Next.js 16.3.5 (App Router, `proxy.ts`), React 19, Tailwind 4, Supabase (`@supabase/ssr` for the session, `@supabase/supabase-js` for the service role), Gemini through `@google/genai`, and vitest.

## What it covers

| Requirement | Where |
|---|---|
| Create new prompt chains | `/prompt-chains/new`: a new chain starts as a copy of any chain (Duplicate on a chain's page picks it), with its own name, slug and description. It starts as a draft no roast uses |
| Create new prompt chain steps | `/prompt-chains/[id]/steps/new`: a step at any position, with its model, temperature, input (photo and text, or text only), output (text, or the reviews) and its system and user prompts |
| Edit prompt chain steps | `/prompt-chains/[id]/steps/[stepId]`, with a preview of the exact prompt it would send, filled in with a real topic's critics, terms and examples |
| Reorder the steps of a prompt chain | Move up and Move down on each step of `/prompt-chains/[id]`. A move runs in one transaction, so the steps never end up out of order |
| Generate media based on a prompt chain | `/generate`: pick a chain and a photo, and the chain runs on it for that topic's whole panel of critics, the way a post from the main app would. `/runs/[id]` then shows the reviews it wrote, and every step's model, prompts, answer, time, tokens and cost. **Run again** repeats it, so you can edit a step and compare |
| View the media a specific prompt chain made | `/media`: what the chains made, newest first. Each run that succeeded shows its photo, its chain, where it ran (App for the main app, Admin for Generate here or the admin), its topic and date, and each critic's review, score and tip. Pick a chain to see only its runs; **See what it made** on a chain's page opens it that way |

Also here:
- Edit a chain's details (`/prompt-chains/[id]/edit`), delete a chain or a step, and **Make default**.
- `/chain-mix`: the share of new roasts in the main app that each chain gets. Each roast picks a chain by these weights, and the default chain is the backup when a picked one can't run.
- `/runs`: every run of every chain, newest first, filtered by status, source and chain. That includes posts from the main app, so a chain's real runs can be compared with test runs.

Rules it keeps:
- **A run from Generate posts nothing.** Its reviews are never saved as roasts, so the photo's owner never sees them. They are read back from the run's log (`llm_responses`) on its page and under `/media`, which reads every run that way, from the main app too.
- **A run uses the chain you picked, or nothing.** Unlike a post from the main app, it never swaps in the default chain: a chain that can't run is refused, with what to fix.
- **Runs respect the main app's daily budget.** Their model calls count toward it (it is set in the admin under Limits & cost), so Generate refuses to run once it is used up, or when it can't be checked. They are logged as source `admin`, so they never use up anyone's daily posts.
- **A live chain must stay runnable.** A live chain is the default, or one with a share of the mix. A step change that would break it is refused, with the problems listed. To restructure one, duplicate it, change the copy (a draft, which saves in any state), test it under Generate, then make the copy the default.
- **Deletes that would break a run are refused, with the reason.** That covers the default chain, a chain with a share of the mix, and a chain's last step.
- **Edits apply to the very next roast in the main app.** It reads the chains and the mix fresh on every post.

The tables and SQL functions come from the main app's migrations [`20261028120000_prompt_chains_and_observability.sql`](https://github.com/gc3274/hw1/blob/main/supabase/migrations/20261028120000_prompt_chains_and_observability.sql) and [`20261104120000_editable_chains_limits_costs.sql`](https://github.com/gc3274/hw1/blob/main/supabase/migrations/20261104120000_editable_chains_limits_costs.sql). This app adds no tables of its own.

## Routes

| Route | Who | What |
|---|---|---|
| `/login` | Everyone (GET only) | Google sign-in. A signed-in admin goes on to `/`, anyone else signed in to `/not-authorized` |
| `/auth/callback` | Everyone (GET only) | OAuth code exchange, then `/` or `/not-authorized` by the flag |
| `/not-authorized` | Signed in | Your email, how to get access, and Sign out |
| `/` | Superadmin | Goes to `/prompt-chains` |
| `/prompt-chains`, `/prompt-chains/new`, `/prompt-chains/[id]`, `/prompt-chains/[id]/edit` | Superadmin | Chains: list, create, read, update, delete, make default |
| `/prompt-chains/[id]/steps/new`, `/prompt-chains/[id]/steps/[stepId]` | Superadmin | Steps: create and update. Move and delete are on the chain's page |
| `/chain-mix` | Superadmin | The mix, saved in one write |
| `/generate` | Superadmin | Run a chain on a photo. `maxDuration = 60` for the model calls |
| `/runs`, `/runs/[id]` | Superadmin | The run log, and one run's reviews and steps |
| `/media` | Superadmin | What each chain made: the photos and the reviews, filtered by chain |

## Access control

The same layers as the admin area:

1. **`proxy.ts`** runs on every request and method. A signed-out request goes to `/login`, and a signed-in one without the flag goes to `/not-authorized`; other methods get 401, 403 or 503. The decision table is `lib/gate.ts`.
2. **`app/(admin)/layout.tsx`** shows the side bar. It is UI only.
3. **Every page and every server action** opens with `await requireSuperadmin()` (`lib/dal.ts`), which validates the session with Supabase Auth and reads the flag fresh. This is the real gate, because server actions can be posted to any path.
4. **`adminDb()`** (`lib/supabase/admin.ts`) checks again before it builds the service-role client. Only `lib/data/*` and `app/(admin)/**/actions.ts` may import it.

The flag is never kept in the JWT, so revoking it takes effect on the next click. Users can't set it themselves; the first superadmin is set in the Supabase SQL editor (see the admin's README, [Won't the first admin be locked out?](https://github.com/gc3274/hw6#wont-the-first-admin-be-locked-out)). The tool has its own auth cookie, `sb-chains-auth-token`, so on localhost it never shares a session with the main app (:3000) or the admin (:3001).

`lib/architecture.test.ts` reads the source and fails the tests if:
- a page or action skips the gate;
- anything else imports the service client;
- the service key's name appears outside `lib/supabase/admin.ts`;
- anything renders raw HTML or uses `"use cache"`.

## Setup

1. **Migrations.** Run the main app's migrations in the Supabase SQL editor (role `postgres`), in order. This tool needs both prompt chain migrations above, including `20261104120000_editable_chains_limits_costs.sql`.
2. **Environment.** Copy `.env.example` to `.env.local` and fill it in. Never commit `.env.local`. The values are the same as the admin's:

   | Name | Notes |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Same as the main app |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as the main app. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` also works, and wins if both are set |
   | `SUPABASE_SERVICE_ROLE_KEY` | Server only: never give it a `NEXT_PUBLIC_` prefix. It is read only in `lib/supabase/admin.ts` |
   | `GEMINI_API_KEY` | Server only. The main app's key works; the apps then share its quota |

3. **Run it.** `npm install`, then `npm run dev`, and open [http://localhost:3002](http://localhost:3002). The tool always runs on port 3002, next to the main app on 3000 and the admin on 3001.
4. **Supabase redirect URLs.** Under Authentication → URL Configuration → Redirect URLs, add:
   - `http://localhost:3002/**`
   - the production domain, `https://<production-domain>/**`
   - the deployment URL pattern, `https://prompt-chains-*-gc3274-3854.vercel.app/**`

   The Site URL stays the main app. Google Cloud needs no change. If Google sign-in lands you on the main app instead of here, this URL is missing from the list.

## Deploy

1. Create the empty GitHub repo `gc3274/prompt-chains`, add it as `origin` and push `main`.
2. In Vercel, import it as a new project in the team `gc3274-3854` (framework Next.js, no settings changed).
3. Add the four environment variables. Set `SUPABASE_SERVICE_ROLE_KEY` for **Production only** and mark it **Sensitive**, so preview deployments fail closed.
4. Settings → Deployment Protection → Vercel Authentication: **Disabled**, so the URLs open without a Vercel login. Google sign-in and the superadmin flag still guard every page.
5. Add the production domain and the deployment URL pattern to the Supabase redirect URLs (Setup step 4).
6. Check in an Incognito window:
   - `/` goes to `/login`, and signing in as an admin lands on the chain list.
   - Another account lands on `/not-authorized`.
   - Generate runs a chain, and the run shows under Runs.

## Scripts and checks

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 3002 |
| `npm run build` / `npm start` | Production build, and a server for it on port 3002 |
| `npm run lint` | ESLint |
| `npm test` | vitest: the gate and the proxy, the chain and step rules, the chain runner and the Gemini caller, Generate's rules, the run log and the architecture guards |
| `npx next typegen && npx tsc --noEmit` | Type check (route types such as `PageProps` are generated) |

After a build, the service key must not be anywhere in the client bundle. This must print nothing:

```sh
grep -rlE "SUPABASE_SERVICE_ROLE_KEY|service_role|sb_secret_[A-Za-z0-9]" .next/static
```

## Known limits

- **A run can take up to a minute.** That is the model calls' 48 s budget plus the photo download, inside the route's 60 s limit. A run cut off by the platform stays `pending`, and shows as "unfinished" after two minutes.
- **Reviews are read back with today's panel.** If a critic is renamed or removed after a run, its review may no longer read back, and the page shows the raw answer under Steps instead.
- **Spend is a floor.** A call is priced by its model's row in the admin's Models page at the time it runs. Calls to a model without a price have no cost, so the budget can't see them.
- **Models and providers are managed in the admin**, not here. A step can only pick a model that is already there.
- **The source label can't tell this tool from the admin.** Both log their runs as `admin`, because the request log's source check allows only `app` and `admin`. A test run from here is the `admin` run that succeeded with 0 roasts saved.
- **Logs are kept forever** and include each run's prompts, which contain the uploader's note. Only superadmins can read them.
- **Copied code can drift.** Some files are copied from the main app. Each starts with a comment naming the main app commit it came from. They are `lib/roasts.ts`, `lib/chains.ts`, `lib/gemini.ts`, part of `lib/captions.ts`, the Supabase clients, and the sign-in and sign-out code, plus the tests of the chain runner and the Gemini caller.
