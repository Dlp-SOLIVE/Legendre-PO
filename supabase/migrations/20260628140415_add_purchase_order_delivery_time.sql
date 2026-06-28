alter table public.purchase_orders
add column if not exists delivery_time text;
