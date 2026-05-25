alter function app_private.touch_updated_at() set search_path = app_private, public, pg_temp;
alter function app_private.set_po_status_timestamps() set search_path = app_private, public, pg_temp;

create index if not exists purchase_orders_requester_id_idx on public.purchase_orders(requester_id);
create index if not exists purchase_orders_approver_id_idx on public.purchase_orders(approver_id);
create index if not exists purchase_orders_category_id_idx on public.purchase_orders(category_id);
create index if not exists purchase_orders_created_by_idx on public.purchase_orders(created_by);

drop policy if exists "admins can manage suppliers" on public.suppliers;
create policy "admins can insert suppliers" on public.suppliers
for insert to authenticated with check (app_private.is_admin());
create policy "admins can update suppliers" on public.suppliers
for update to authenticated using (app_private.is_admin()) with check (app_private.is_admin());
create policy "admins can delete suppliers" on public.suppliers
for delete to authenticated using (app_private.is_admin());

drop policy if exists "admins can manage projects" on public.projects;
create policy "admins can insert projects" on public.projects
for insert to authenticated with check (app_private.is_admin());
create policy "admins can update projects" on public.projects
for update to authenticated using (app_private.is_admin()) with check (app_private.is_admin());
create policy "admins can delete projects" on public.projects
for delete to authenticated using (app_private.is_admin());

drop policy if exists "admins can manage staff" on public.staff_members;
create policy "admins can insert staff" on public.staff_members
for insert to authenticated with check (app_private.is_admin() or not app_private.has_staff());
create policy "admins can update staff" on public.staff_members
for update to authenticated using (app_private.is_admin() or not app_private.has_staff()) with check (app_private.is_admin() or not app_private.has_staff());
create policy "admins can delete staff" on public.staff_members
for delete to authenticated using (app_private.is_admin());

drop policy if exists "admins can manage cost categories" on public.cost_categories;
create policy "admins can insert cost categories" on public.cost_categories
for insert to authenticated with check (app_private.is_admin());
create policy "admins can update cost categories" on public.cost_categories
for update to authenticated using (app_private.is_admin()) with check (app_private.is_admin());
create policy "admins can delete cost categories" on public.cost_categories
for delete to authenticated using (app_private.is_admin());

drop policy if exists "admins can manage app settings" on public.app_settings;
create policy "admins can insert app settings" on public.app_settings
for insert to authenticated with check (app_private.is_admin());
create policy "admins can update app settings" on public.app_settings
for update to authenticated using (app_private.is_admin()) with check (app_private.is_admin());
create policy "admins can delete app settings" on public.app_settings
for delete to authenticated using (app_private.is_admin());

drop policy if exists "po sequence writes are internal admin only" on public.po_sequences;
create policy "admins can insert po sequences" on public.po_sequences
for insert to authenticated with check (app_private.is_admin());
create policy "admins can update po sequences" on public.po_sequences
for update to authenticated using (app_private.is_admin()) with check (app_private.is_admin());
create policy "admins can delete po sequences" on public.po_sequences
for delete to authenticated using (app_private.is_admin());
