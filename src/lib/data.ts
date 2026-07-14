import { supabase } from "./supabase";
import type {
  AppRole,
  AppSetting,
  CostCategory,
  Project,
  PurchaseOrder,
  PurchaseOrderLineItem,
  PurchaseOrderStatus,
  ReferenceData,
  StaffMember,
  StaffProjectAccess,
  Supplier,
} from "../types";

function requireClient() {
  if (!supabase) throw new Error("Supabase environment variables are not configured.");
  return supabase;
}

function mapById<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

export async function loadReferenceData(): Promise<ReferenceData> {
  const client = requireClient();
  const [suppliers, projects, staff, projectAccess, categories, settings] = await Promise.all([
    client.from("suppliers").select("*").order("supplier_name"),
    client.from("projects").select("*").order("project_name"),
    client.from("staff_members").select("*").order("full_name"),
    client.from("staff_project_access").select("*"),
    client.from("cost_categories").select("*").order("expense_type").order("category_name"),
    client.from("app_settings").select("*").order("setting_key"),
  ]);

  for (const result of [suppliers, projects, staff, projectAccess, categories, settings]) {
    if (result.error) throw result.error;
  }

  return {
    suppliers: (suppliers.data ?? []) as Supplier[],
    projects: (projects.data ?? []) as Project[],
    staff: (staff.data ?? []) as StaffMember[],
    projectAccess: (projectAccess.data ?? []) as StaffProjectAccess[],
    categories: (categories.data ?? []) as CostCategory[],
    settings: (settings.data ?? []) as AppSetting[],
  };
}

export async function loadPurchaseOrders(): Promise<PurchaseOrder[]> {
  const client = requireClient();
  const [purchaseOrders, lineItems, suppliers, projects, staff, categories] = await Promise.all([
    client
      .from("purchase_orders")
      .select("*")
      .order("po_date", { ascending: false })
      .order("created_at", { ascending: false }),
    client.from("purchase_order_line_items").select("*").order("sort_order", { ascending: true }),
    client.from("suppliers").select("*"),
    client.from("projects").select("*"),
    client.from("staff_members").select("*"),
    client.from("cost_categories").select("*"),
  ]);

  for (const result of [purchaseOrders, lineItems, suppliers, projects, staff, categories]) {
    if (result.error) throw result.error;
  }

  const supplierById = mapById((suppliers.data ?? []) as Supplier[]);
  const projectById = mapById((projects.data ?? []) as Project[]);
  const staffById = mapById((staff.data ?? []) as StaffMember[]);
  const categoryById = mapById((categories.data ?? []) as CostCategory[]);
  const lineItemsByPurchaseOrderId = new Map<string, PurchaseOrderLineItem[]>();

  ((lineItems.data ?? []) as PurchaseOrderLineItem[]).forEach((lineItem) => {
    if (!lineItem.purchase_order_id) return;

    const lineWithCategory: PurchaseOrderLineItem = {
      ...lineItem,
      category: lineItem.category_id ? categoryById.get(lineItem.category_id) ?? null : null,
    };
    const current = lineItemsByPurchaseOrderId.get(lineItem.purchase_order_id) ?? [];
    current.push(lineWithCategory);
    lineItemsByPurchaseOrderId.set(lineItem.purchase_order_id, current);
  });

  return ((purchaseOrders.data ?? []) as PurchaseOrder[]).map((po) => ({
    ...po,
    supplier: supplierById.get(po.supplier_id) ?? null,
    project: projectById.get(po.project_id) ?? null,
    requester: po.requester_id ? staffById.get(po.requester_id) ?? null : null,
    validator: po.validated_by ? staffById.get(po.validated_by) ?? null : null,
    category: po.category_id ? categoryById.get(po.category_id) ?? null : null,
    line_items: [...(lineItemsByPurchaseOrderId.get(po.id) ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));
}

export async function upsertSupplier(payload: Partial<Supplier>) {
  return upsertRow("suppliers", payload);
}

export async function upsertProject(payload: Partial<Project>) {
  return upsertRow("projects", payload);
}

export async function upsertStaff(payload: Partial<StaffMember>) {
  return upsertRow("staff_members", payload);
}

export async function saveStaffMember(payload: Partial<StaffMember>, projectIds: string[]) {
  const client = requireClient();
  const cleanPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as Partial<StaffMember>;

  const staffResult = cleanPayload.id
    ? await client
        .from("staff_members")
        .update(cleanPayload)
        .eq("id", cleanPayload.id)
        .select("id")
        .single()
    : await client
        .from("staff_members")
        .insert(cleanPayload)
        .select("id")
        .single();

  if (staffResult.error) throw staffResult.error;

  const staffId = staffResult.data.id as string;
  const { error: deleteError } = await client
    .from("staff_project_access")
    .delete()
    .eq("staff_member_id", staffId);
  if (deleteError) throw deleteError;

  const rows = projectIds.map((projectId) => ({
    staff_member_id: staffId,
    project_id: projectId,
  }));

  if (rows.length) {
    const { error } = await client.from("staff_project_access").insert(rows);
    if (error) throw error;
  }

  return staffId;
}

export async function updateOwnStaffProfile(payload: Pick<StaffMember, "full_name" | "initials" | "phone">) {
  const client = requireClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;

  const email = userData.user?.email?.toLowerCase();
  if (!email) throw new Error("You must be signed in to update your profile.");

  const { error } = await client
    .from("staff_members")
    .update({
      full_name: payload.full_name.trim(),
      initials: payload.initials?.trim().toUpperCase() || null,
      phone: payload.phone?.trim() || null,
    })
    .eq("email", email)
    .select("id")
    .single();

  if (error) throw error;
}

export async function upsertCategory(payload: Partial<CostCategory>) {
  return upsertRow("cost_categories", payload);
}

export async function upsertSetting(payload: Partial<AppSetting>) {
  return upsertRow("app_settings", payload, "setting_key");
}

export async function deleteRow(table: string, id: string, key = "id") {
  const client = requireClient();
  const { error } = await client.from(table).delete().eq(key, id);
  if (error) throw error;
}

export async function deletePurchaseOrder(id: string, requesterId: string) {
  const client = requireClient();
  const { error } = await client.from("purchase_orders").delete().eq("id", id).eq("status", "draft").eq("requester_id", requesterId);
  if (error) throw error;
}

export async function validatePurchaseOrder(id: string) {
  const client = requireClient();
  // chama a função que impõe o limite de autoridade na base de dados
  const { error } = await client.rpc("validate_purchase_order", { po_id: id });
  if (error) throw error;
}

export async function requestStaffAccess(payload: { email: string; fullName: string; initials: string }) {
  const client = requireClient();
  const { error } = await client.rpc("request_staff_access", {
    request_email: payload.email,
    request_full_name: payload.fullName,
    request_initials: payload.initials,
  });
  if (error) throw error;
}

async function upsertRow(table: string, payload: Record<string, unknown>, key = "id") {
  const client = requireClient();
  const cleanPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
  const query = cleanPayload[key]
    ? client.from(table).update(cleanPayload).eq(key, cleanPayload[key] as string)
    : client.from(table).insert(cleanPayload);
  const { error } = await query;
  if (error) throw error;
}

export type PurchaseOrderDraft = {
  project_id: string;
  supplier_id: string;
  requester_id: string | null;
  category_id: string | null;
  status: PurchaseOrderStatus;
  po_date: string;
  payment_terms: string | null;
  invoice_project_code: string | null;
  delivery_date: string | null;
  delivery_time: string | null;
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
  notes: string | null;
  line_items: PurchaseOrderLineItem[];
};

export async function createPurchaseOrder(draft: PurchaseOrderDraft) {
  const client = requireClient();
  const { data: userData } = await client.auth.getUser();
  const { line_items, ...po } = draft;

  const { data, error } = await client
    .from("purchase_orders")
    .insert({
      ...po,
      created_by: userData.user?.id ?? null,
    })
    .select("id")
    .single();

  if (error) throw error;

  const rows = line_items.map((item, index) => ({
    purchase_order_id: data.id,
    sort_order: index + 1,
    item_ref: item.item_ref,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    rate: item.rate,
    vat_rate: item.vat_rate,
    category_id: item.category_id,
  }));

  const { error: lineError } = await client.from("purchase_order_line_items").insert(rows);
  if (lineError) throw lineError;

  return data.id as string;
}

export async function updatePurchaseOrder(id: string, draft: PurchaseOrderDraft) {
  const client = requireClient();
  const { line_items, ...po } = draft;

  const { error } = await client
    .from("purchase_orders")
    .update(po)
    .eq("id", id);
  if (error) throw error;

  const { error: deleteError } = await client
    .from("purchase_order_line_items")
    .delete()
    .eq("purchase_order_id", id);
  if (deleteError) throw deleteError;

  const rows = line_items.map((item, index) => ({
    purchase_order_id: id,
    sort_order: index + 1,
    item_ref: item.item_ref,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    rate: item.rate,
    vat_rate: item.vat_rate,
    category_id: item.category_id,
  }));

  if (rows.length) {
    const { error: lineError } = await client.from("purchase_order_line_items").insert(rows);
    if (lineError) throw lineError;
  }
}

export function roleCanAdmin(role: AppRole | null | undefined) {
  return role === "admin";
}

export function roleCanWritePo(role: AppRole | null | undefined) {
  return role === "admin" || role === "user" || role === "standard";
}

export function normalizeRole(role: AppRole | null | undefined): AppRole {
  return role === "standard" ? "user" : role ?? "viewer";
}


// ─────────────────────────────────────────────
// LOTE 3B — Guias de transporte, Faturas, Reconciliação
// ─────────────────────────────────────────────

export async function loadDeliveryNotes(purchaseOrderId: string) {
  const client = requireClient();
  const { data: notes, error } = await client
    .from("delivery_notes")
    .select("*")
    .eq("purchase_order_id", purchaseOrderId)
    .order("delivery_date", { ascending: true });
  if (error) throw error;

  const noteIds = (notes ?? []).map((n) => n.id);
  let lines: any[] = [];
  if (noteIds.length) {
    const { data: lineData, error: lineError } = await client
      .from("delivery_note_lines")
      .select("*")
      .in("delivery_note_id", noteIds);
    if (lineError) throw lineError;
    lines = lineData ?? [];
  }
  return (notes ?? []).map((n) => ({
    ...n,
    lines: lines.filter((l) => l.delivery_note_id === n.id),
  }));
}

export async function loadSupplierInvoices(purchaseOrderId: string) {
  const client = requireClient();
  const { data: invoices, error } = await client
    .from("supplier_invoices")
    .select("*")
    .eq("purchase_order_id", purchaseOrderId)
    .order("invoice_date", { ascending: true });
  if (error) throw error;

  const ids = (invoices ?? []).map((i) => i.id);
  let lines: any[] = [];
  if (ids.length) {
    const { data: lineData, error: lineError } = await client
      .from("supplier_invoice_lines")
      .select("*")
      .in("invoice_id", ids);
    if (lineError) throw lineError;
    lines = lineData ?? [];
  }
  return (invoices ?? []).map((i) => ({
    ...i,
    lines: lines.filter((l) => l.invoice_id === i.id),
  }));
}

export async function loadReconciliation(purchaseOrderId: string) {
  const client = requireClient();
  const { data, error } = await client
    .from("v_line_reconciliation")
    .select("*")
    .eq("purchase_order_id", purchaseOrderId);
  if (error) throw error;
  return data ?? [];
}

export async function loadAccrualsByProjectMonth() {
  const client = requireClient();
  const { data, error } = await client
    .from("v_accruals_by_project_month")
    .select("*")
    .order("month", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createDeliveryNote(
  purchaseOrderId: string,
  header: { guia_number: string | null; delivery_date: string; notes: string | null; attachment_url?: string | null },
  lines: { line_item_id: string; quantity_received: number }[],
) {
  const client = requireClient();
  const { data: note, error } = await client
    .from("delivery_notes")
    .insert({ purchase_order_id: purchaseOrderId, ...header })
    .select()
    .single();
  if (error) throw error;

  const toInsert = lines
    .filter((l) => l.quantity_received > 0)
    .map((l) => ({ delivery_note_id: note.id, line_item_id: l.line_item_id, quantity_received: l.quantity_received }));
  if (toInsert.length) {
    const { error: lineError } = await client.from("delivery_note_lines").insert(toInsert);
    if (lineError) throw lineError;
  }
  return note.id as string;
}

export async function createSupplierInvoice(
  purchaseOrderId: string,
  header: { invoice_number: string | null; invoice_date: string; notes: string | null; attachment_url?: string | null },
  lines: { line_item_id: string; quantity_invoiced: number; unit_price_invoiced: number }[],
) {
  const client = requireClient();
  const { data: invoice, error } = await client
    .from("supplier_invoices")
    .insert({ purchase_order_id: purchaseOrderId, ...header })
    .select()
    .single();
  if (error) throw error;

  const toInsert = lines
    .filter((l) => l.quantity_invoiced > 0)
    .map((l) => ({
      invoice_id: invoice.id,
      line_item_id: l.line_item_id,
      quantity_invoiced: l.quantity_invoiced,
      unit_price_invoiced: l.unit_price_invoiced,
    }));
  if (toInsert.length) {
    const { error: lineError } = await client.from("supplier_invoice_lines").insert(toInsert);
    if (lineError) throw lineError;
  }
  return invoice.id as string;
}

export async function deleteDeliveryNote(id: string) {
  const client = requireClient();
  const { error } = await client.from("delivery_notes").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteSupplierInvoice(id: string) {
  const client = requireClient();
  const { error } = await client.from("supplier_invoices").delete().eq("id", id);
  if (error) throw error;
}

// ─────────────────────────────────────────────
// LOTE 3E — Anexos (Supabase Storage, bucket privado 'anexos')
// ─────────────────────────────────────────────

const ANEXOS_BUCKET = "anexos";
const ANEXO_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ANEXO_TIPOS_OK = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

// Faz upload de um anexo e devolve o caminho (path) guardado em attachment_url.
export async function uploadAnexo(file: File, prefixo: string): Promise<string> {
  const client = requireClient();
  if (file.size > ANEXO_MAX_BYTES) {
    throw new Error("O ficheiro é demasiado grande (máx. 10 MB).");
  }
  if (file.type && !ANEXO_TIPOS_OK.includes(file.type)) {
    throw new Error("Tipo de ficheiro não suportado. Use PDF ou imagem.");
  }
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const safe = `${prefixo}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await client.storage.from(ANEXOS_BUCKET).upload(safe, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return safe;
}

// Gera um link temporário (assinado) para abrir/descarregar um anexo privado.
export async function getAnexoUrl(path: string): Promise<string | null> {
  if (!path) return null;
  const client = requireClient();
  const { data, error } = await client.storage
    .from(ANEXOS_BUCKET)
    .createSignedUrl(path, 60 * 10); // válido 10 minutos
  if (error) throw error;
  return data?.signedUrl ?? null;
}

// Remove um anexo do storage.
export async function deleteAnexo(path: string): Promise<void> {
  if (!path) return;
  const client = requireClient();
  const { error } = await client.storage.from(ANEXOS_BUCKET).remove([path]);
  if (error) throw error;
}

// ─────────────────────────────────────────────
// LOTE 4 — Refaturação ao consórcio
// ─────────────────────────────────────────────

export async function loadConsortiumReinvoicing() {
  const client = requireClient();
  const { data, error } = await client
    .from("v_consortium_reinvoicing")
    .select("*")
    .order("month", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function markReinvoiced(projectId: string, month: string, amount: number, staffId: string | null) {
  const client = requireClient();
  const { error } = await client
    .from("consortium_reinvoicing")
    .insert({ project_id: projectId, month, amount, reinvoiced_by: staffId });
  if (error) throw error;
}

export async function unmarkReinvoiced(projectId: string, month: string) {
  const client = requireClient();
  const { error } = await client
    .from("consortium_reinvoicing")
    .delete()
    .eq("project_id", projectId)
    .eq("month", month);
  if (error) throw error;
}

// ─────────────────────────────────────────────
// LOTE 7 — Assinatura pré-carregada (Storage privado, bucket 'assinaturas')
// ─────────────────────────────────────────────

const ASSINATURAS_BUCKET = "assinaturas";
const ASSINATURA_MAX_BYTES = 3 * 1024 * 1024; // 3 MB
const ASSINATURA_TIPOS_OK = ["image/png", "image/jpeg", "image/webp"];

// Upload da imagem de assinatura+carimbo de um membro da equipa.
export async function uploadAssinatura(file: File, staffId: string): Promise<string> {
  const client = requireClient();
  if (file.size > ASSINATURA_MAX_BYTES) {
    throw new Error("A imagem é demasiado grande (máx. 3 MB).");
  }
  if (file.type && !ASSINATURA_TIPOS_OK.includes(file.type)) {
    throw new Error("Tipo de ficheiro não suportado. Use PNG, JPG ou WEBP.");
  }
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "png";
  const path = `${staffId}/assinatura-${Date.now()}.${ext}`;
  const { error } = await client.storage.from(ASSINATURAS_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: true,
  });
  if (error) throw error;
  return path;
}

// Link temporário para mostrar a assinatura (privado).
export async function getAssinaturaUrl(path: string): Promise<string | null> {
  if (!path) return null;
  const client = requireClient();
  const { data, error } = await client.storage
    .from(ASSINATURAS_BUCKET)
    .createSignedUrl(path, 60 * 60); // válido 1 hora — usado ao imprimir o documento
  if (error) throw error;
  return data?.signedUrl ?? null;
}

// ─────────────────────────────────────────────
// LOTE 8 — Fluxo de aprovação por limite
// ─────────────────────────────────────────────

// Submeter uma adjudicação para aprovação de outro membro (com maior limite + acesso à obra).
export async function submitForApproval(poId: string, approverId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc("submit_for_approval", { po_id: poId, p_approver_id: approverId });
  if (error) throw error;
}

// Decisão do aprovador: 'approve' | 'return' | 'reject'. Comentário obrigatório em return/reject.
export async function decideApproval(poId: string, action: "approve" | "return" | "reject", comment?: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc("decide_approval", { po_id: poId, action, p_comment: comment ?? null });
  if (error) throw error;
}
