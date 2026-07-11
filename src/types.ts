export type AppRole = "admin" | "user" | "standard" | "viewer";
export type PurchaseOrderStatus = "draft" | "validated";

export type Supplier = {
  id: string;
  supplier_name: string;
  account_code: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  vat_number: string | null;
  notes: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type Project = {
  id: string;
  project_name: string;
  project_code: string;
  adj_code: string | null;
  is_consortium?: boolean;
  consortium_share?: number;
  site_address: string | null;
  cost_centre_code: string | null;
  default_delivery_address: string | null;
  site_contact_name: string | null;
  site_contact_phone: string | null;
  default_vehicle_requirements: string | null;
  default_offloading_instructions: string | null;
  default_delivery_instructions: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type StaffMember = {
  id: string;
  full_name: string;
  initials: string | null;
  email: string;
  phone: string | null;
  role: AppRole;
  is_active: boolean;
  authority_limit: number | null;
  created_at?: string;
  updated_at?: string;
};

export type StaffProjectAccess = {
  id: string;
  staff_member_id: string;
  project_id: string;
  created_at?: string;
};

export type CostCategory = {
  id: string;
  expense_type: string;
  category_name: string;
  category_code: string;
  description: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type AppSetting = {
  setting_key: string;
  setting_value: Record<string, unknown>;
  description: string | null;
  created_at?: string;
  updated_at?: string;
};

export type PurchaseOrderLineItem = {
  id?: string;
  purchase_order_id?: string;
  sort_order: number;
  item_ref: string | null;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  discount_pct: number;
  vat_rate: number;
  category_id: string | null;
  line_total?: number;
  line_vat?: number;
  gross_total?: number;
  category?: CostCategory | null;
};

export type PurchaseOrder = {
  id: string;
  po_number: string;
  project_id: string;
  supplier_id: string;
  requester_id: string | null;
  category_id: string | null;
  status: PurchaseOrderStatus;
  po_date: string;
  delivery_date: string | null;
  delivery_time: string | null;
  payment_terms: string | null;
  invoice_project_code: string | null;
  delivery_address: string | null;
  supplier_contact_name: string | null;
  supplier_email: string | null;
  supplier_phone: string | null;
  supplier_address: string | null;
  site_contact: string | null;
  vehicle_requirements: string | null;
  offloading_instructions: string | null;
  delivery_instructions: string | null;
  include_driver_leaflet: boolean;
  include_terms_conditions: boolean;
  subtotal: number;
  vat_total: number;
  grand_total: number;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
  supplier?: Supplier | null;
  project?: Project | null;
  requester?: StaffMember | null;
  category?: CostCategory | null;
  line_items?: PurchaseOrderLineItem[];
};

export type DeliveryNoteLine = {
  id: string;
  delivery_note_id: string;
  line_item_id: string;
  quantity_received: number;
};

export type DeliveryNote = {
  id: string;
  purchase_order_id: string;
  guia_number: string | null;
  delivery_date: string;
  attachment_url: string | null;
  notes: string | null;
  created_at?: string;
  lines?: DeliveryNoteLine[];
};

export type SupplierInvoiceLine = {
  id: string;
  invoice_id: string;
  line_item_id: string;
  quantity_invoiced: number;
  unit_price_invoiced: number;
};

export type SupplierInvoice = {
  id: string;
  purchase_order_id: string;
  invoice_number: string | null;
  invoice_date: string;
  attachment_url: string | null;
  notes: string | null;
  created_at?: string;
  lines?: SupplierInvoiceLine[];
};

export type LineReconciliation = {
  line_item_id: string;
  purchase_order_id: string;
  project_id: string;
  po_number: string;
  po_date: string;
  description: string;
  category_id: string | null;
  qty_ordered: number;
  po_price: number;
  qty_received: number;
  qty_invoiced: number;
  value_received: number;
  value_invoiced: number;
  accrual_value: number;
  qty_outstanding: number;
  avg_price_invoiced: number | null;
  price_divergence: boolean;
};

export type AccrualByProjectMonth = {
  project_id: string;
  project_name: string;
  month: string;
  category_id: string | null;
  expense_type: string | null;
  category_name: string | null;
  category_code: string | null;
  value_received: number;
  value_invoiced: number;
  accrual_value: number;
};

export type ConsortiumReinvoicing = {
  project_id: string;
  project_name: string;
  consortium_share: number;
  month: string;
  value_invoiced: number;
  redebito: number;
  ja_refaturado: boolean;
  reinvoiced_at: string | null;
  redebito_registado: number | null;
};

export type ReferenceData = {
  suppliers: Supplier[];
  projects: Project[];
  staff: StaffMember[];
  projectAccess: StaffProjectAccess[];
  categories: CostCategory[];
  settings: AppSetting[];
};

export type DashboardFilters = {
  from: string;
  to: string;
  projectId: string;
  supplierId: string;
  status: string;
};
