# Legendre Procurement System

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

- `admin`: approve users, assign project access, manage projects/staff/categories/settings, create suppliers, and create POs for any project
- `user`: create suppliers and create POs only for assigned projects

New users can request access from the sign-in screen. Their staff record is created as inactive until an admin opens the Staff page, activates the user, sets the role, and assigns one or more projects.

Users who forget their password can use the `Forgot password?` link on the sign-in screen. Supabase sends a reset email back to the app, where the user can choose a new password before signing in again.

## Environment Variables

Copy `.env.example` to `.env`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

Use the browser-safe Supabase publishable/anon key for `VITE_SUPABASE_ANON_KEY`. Never put a Supabase service role key in Netlify or Vite client variables.

## PO Numbering

PO numbers are generated in Supabase by a database trigger so duplicates cannot be created by the browser. The convention is:

```text
PROJECTCOSTCENTRE-SUPPLIERINITIALS-REQUESTERINITIALS-####
```

Example: `660-L-ER-0001`.

The project component uses the project cost centre code when available, falling back to the project code. The requester is assigned from the signed-in Supabase user's matching staff email, so users create POs under their own staff profile. The `purchase_orders.po_number` column has a unique constraint, and the per-project sequence is stored in `po_sequences`.

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
5. Deploy.

`netlify.toml` includes the Vite build settings, a single-page-app redirect, and a build ignore rule so Netlify only builds the `main` branch.

## Development Workflow

Use the `development` branch for work in progress. Netlify is configured to skip builds for branches other than `main`, so changes pushed to `development` will stay in GitHub until they are merged into `main`.

When a change is ready to publish, merge `development` into `main` and push `main`. Netlify will then build and deploy the production site.

## User Access

Supabase Auth handles sign-in, and the Staff page controls application access. New users create an account with email, name, initials, and password. Their staff request is inactive until an admin approves them, chooses `admin` or `user`, and assigns project access where required.

Password reset is handled by Supabase Auth. The reset link must redirect back to an allowed app URL, such as `http://localhost:5173` for local testing and the Netlify site URL for deployed testing.

- Admins can approve staff, assign projects, manage projects/categories/settings, create suppliers, and create POs for any project.
- Users can create suppliers and create POs only for projects assigned to them.

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
- Any signed-in Supabase Auth user has admin access for this first version.
- The first admin is bootstrapped manually with SQL after creating a Supabase Auth user.
- The supplied PDF was used as a layout and text reference; the recreated template is HTML/CSS for clean browser printing.
- Approval workflow is status-based in this first version; detailed approval audit trails can be added later.

