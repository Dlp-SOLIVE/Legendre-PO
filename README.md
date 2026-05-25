# Legendre UK Procurement System

Internal web application for creating, approving, printing, exporting, and tracking Purchase Orders for Legendre UK construction projects.

## Stack

- Vite React with TypeScript
- Supabase Auth and Supabase Postgres for all live data
- Netlify-ready static deployment
- Browser print/PDF output for A4 purchase orders

The app does not use browser storage, local files, or OneDrive as the live database. All suppliers, projects, staff, categories, settings, purchase orders, and line items are stored in Supabase.

## Install

```bash
npm install
npm run dev
```

## Supabase Setup

1. Create a Supabase project.
2. Open the Supabase SQL editor.
3. Run `supabase/migrations/20260525120000_initial_procurement_schema.sql`.
4. Optionally run `supabase/seed.sql` for starter cost categories.
5. In Supabase Auth, create the first internal user.
6. Add a matching staff row with admin access:

```sql
insert into public.staff_members (full_name, initials, email, role)
values ('Your Name', 'YN', 'you@example.com', 'admin')
on conflict (email) do update set role = excluded.role, is_active = true;
```

The staff email must match the Supabase Auth user email. Roles are:

- `admin`: manage suppliers, projects, staff, categories, settings, and POs
- `standard`: create, view, and update POs
- `viewer`: view and export records

## Environment Variables

Copy `.env.example` to `.env`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
SUPABASE_SERVICE_ROLE_KEY=server-side-service-role-key-for-invites
```

Use the browser-safe Supabase publishable/anon key for `VITE_SUPABASE_ANON_KEY`. The `SUPABASE_SERVICE_ROLE_KEY` is used only by the Netlify invite-user function. Never prefix the service role key with `VITE_`, and never use it in browser code.

## PO Numbering

PO numbers are generated in Supabase by a database trigger so duplicates cannot be created by the browser. The convention is:

```text
PROJECTCODE-YY-####
```

Example: `CDA-26-0001`.

The `purchase_orders.po_number` column has a unique constraint, and the per-project annual sequence is stored in `po_sequences`.

## Local Development

```bash
npm run dev
```

The app will show a setup screen if the Supabase environment variables are missing.

## Netlify Deployment

1. Push this repository to GitHub.
2. In Netlify, create a new site from the GitHub repository.
3. Use:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Add the same environment variables in Netlify:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Deploy.

`netlify.toml` includes the Vite build settings and a single-page-app redirect.

## Inviting Users

Admins can invite users from **Staff → Invite User**. The invite flow:

- Verifies the current signed-in user is an active `admin` in `staff_members`
- Sends a Supabase Auth invite email
- Creates or updates the matching staff record and role

This requires `SUPABASE_SERVICE_ROLE_KEY` to be configured in Netlify environment variables. Find it in Supabase under **Project Settings → API**. It must stay server-side only.

## GitHub Repository

This project is prepared for:

```bash
git remote add origin https://github.com/Peroxyde88/Legendre-PO.git
git add .
git commit -m "Build initial Legendre UK procurement system"
git push -u origin master
```

If you prefer a feature branch:

```bash
git switch -c codex/initial-procurement-system
git push -u origin codex/initial-procurement-system
```

## Purchase Order Printing

The PO preview recreates the supplied Legendre purchase order template structure:

- Legendre header and company details
- PO number, date, status, delivery date
- Supplier section
- Project/site section
- Line item table
- Totals section
- Invoice submission instructions
- Second-page driver leaflet / site delivery rules

Use the `Print / Save PDF` button in the preview modal and choose the browser's Save as PDF option.

## Assumptions

- Supabase Auth is used in the first version.
- Staff roles are managed in the `staff_members` table and matched to Auth users by email.
- The first admin is bootstrapped manually with SQL after creating a Supabase Auth user.
- The supplied PDF was used as a layout and text reference; the recreated template is HTML/CSS for clean browser printing.
- Approval workflow is status-based in this first version; detailed approval audit trails can be added later.
