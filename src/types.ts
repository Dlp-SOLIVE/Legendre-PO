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
