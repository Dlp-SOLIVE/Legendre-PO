import type React from "react";
import { Fragment, useState } from "react";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { deleteRow, normalizeRole, saveStaffMember, uploadAssinatura, updateOwnStaffProfile } from "./lib/data";
import { confirmDialog } from "./lib/dialog";
import type { AppRole, AppSetting, ReferenceData, StaffMember } from "./types";

export type FieldDef<T> = {
  name: keyof T & string;
  label: string;
  type?: "text" | "email" | "textarea" | "checkbox" | "select" | "number";
  required?: boolean;
  options?: { value: string; label: string }[];
  section?: string;
};

export function AdminPanel<T extends { id: string; is_active?: boolean } & Record<string, unknown>>({
  title,
  rows,
  identity,
  fields,
  onSave,
  onDelete,
  onRefresh,
  allowCreate = true,
  allowEdit = true,
  allowDelete = true,
}: {
  title: string;
  rows: T[];
  identity: keyof T & string;
  fields: FieldDef<T>[];
  onSave: (payload: Partial<T>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  allowCreate?: boolean;
  allowEdit?: boolean;
  allowDelete?: boolean;
}) {
  const [editing, setEditing] = useState<Partial<T> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = editing?.id ? { id: editing.id } : {};
    fields.forEach((field) => {
      if (field.type === "checkbox") {
        payload[field.name] = form.get(field.name) === "on";
      } else if (field.type === "number") {
        const raw = String(form.get(field.name) ?? "").trim();
        payload[field.name] = raw === "" ? null : Number(raw);
      } else {
        payload[field.name] = String(form.get(field.name) ?? "").trim() || null;
      }
    });
    try {
      await onSave(payload as Partial<T>);
      setEditing(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar o registo.");
    }
  }

  async function remove(id: string) {
    if (!(await confirmDialog("Eliminar este registo? Adjudicações existentes podem impedir a eliminação."))) return;
    try {
      await onDelete(id);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível eliminar o registo.");
    }
  }

  return (
    <section className="work-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Base de dados (admin)</p>
          <h2>{title}</h2>
        </div>
        {allowCreate && (
          <button onClick={() => setEditing({ is_active: true } as Partial<T>)}>
            <Plus size={16} />
            Novo
          </button>
        )}
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className={editing ? "admin-split" : undefined}>
      <DataTable
        rows={rows}
        columns={fields.filter((field) => field.name !== "is_active").slice(0, 5).map((field) => ({ key: field.name, label: field.label }))}
        identity={identity}
        onEdit={allowEdit ? (row) => setEditing(row) : undefined}
        onDelete={allowDelete ? (row) => remove(row.id) : undefined}
      />
      {editing && (
        <aside className="admin-editor" aria-label={editing.id ? "Editar registo" : "Novo registo"}>
        <div className="po-block-head" style={{ marginBottom: 12 }}>
          <h3 className="po-block-title" style={{ margin: 0 }}>{editing.id ? "Editar registo" : "Novo registo"}</h3>
          <button type="button" className="icon-button" style={{ marginLeft: "auto" }} onClick={() => setEditing(null)} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
        <form className="editor-grid" onSubmit={submit} key={String(editing.id ?? "novo")}>
          {fields.map((field, index) => (
            <Fragment key={field.name}>
            {field.section && field.section !== fields[index - 1]?.section && (
              <p className="admin-section">{field.section}</p>
            )}
            <label className={field.type === "textarea" ? "wide" : ""}>
              {field.label}
              {field.type === "textarea" ? (
                <textarea
                  name={field.name}
                  required={field.required}
                  defaultValue={(editing[field.name] as string | null | undefined) ?? ""}
                />
              ) : field.type === "checkbox" ? (
                <input name={field.name} type="checkbox" defaultChecked={editing[field.name] !== undefined ? Boolean(editing[field.name]) : field.name === "is_active"} />
              ) : field.type === "select" ? (
                <select name={field.name} defaultValue={(editing[field.name] as string | undefined) ?? field.options?.[0]?.value}>
                  {field.options?.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={field.name}
                  required={field.required}
                  type={field.type ?? "text"}
                  defaultValue={(editing[field.name] as string | null | undefined) ?? ""}
                />
              )}
            </label>
            </Fragment>
          ))}
          <div className="button-row wide">
            <button type="submit">
              <Save size={16} />
              Guardar
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              <X size={16} />
              Cancelar
            </button>
          </div>
        </form>
        </aside>
      )}
      </div>
    </section>
  );
}

// Dados da empresa que aparecem no cabeçalho e rodapé de todas as adjudicações
export const COMPANY_FIELDS: { key: string; label: string; type?: string; wide?: boolean }[] = [
  { key: "name", label: "Nome comercial" },
  { key: "legal_name", label: "Razão social", wide: true },
  { key: "vat_number", label: "NIF" },
  { key: "phone", label: "Telefone" },
  { key: "address", label: "Morada", wide: true },
  { key: "email", label: "Email geral", type: "email" },
  { key: "accounts_email", label: "Email para faturas", type: "email" },
];

export function SettingsPanel({
  settings,
  onSave,
  onRefresh,
}: {
  settings: AppSetting[];
  onSave: (payload: Partial<AppSetting>) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<AppSetting | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isCompany = editing?.setting_key === "company";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      let value: Record<string, unknown>;
      if (isCompany) {
        // dados da empresa: campos normais (mantém outras chaves que já existam)
        value = { ...(editing?.setting_value ?? {}) };
        COMPANY_FIELDS.forEach((field) => {
          value[field.key] = String(form.get(`company_${field.key}`) ?? "").trim();
        });
      } else {
        value = JSON.parse(String(form.get("setting_value") || "{}"));
      }
      await onSave({
        setting_key: String(form.get("setting_key")),
        description: String(form.get("description") ?? ""),
        setting_value: value,
      });
      setEditing(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "As definições têm de ser JSON válido.");
    }
  }

  return (
    <section className="work-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Base de dados (admin)</p>
          <h2>Definições da aplicação</h2>
        </div>
        <button onClick={() => setEditing({ setting_key: "", setting_value: {}, description: "" })}>
          <Plus size={16} />
          Nova
        </button>
      </div>
      {error && <div className="notice error">{error}</div>}
      {editing && (
        <form className="editor-grid" onSubmit={submit}>
          <label>
            Chave
            <input name="setting_key" required defaultValue={editing.setting_key} readOnly={Boolean(editing.created_at)} />
          </label>
          <label className="wide">
            Descrição
            <input name="description" defaultValue={editing.description ?? ""} />
          </label>
          {isCompany ? (
            COMPANY_FIELDS.map((field) => (
              <label key={field.key} className={field.wide ? "wide" : ""}>
                {field.label}
                <input
                  name={`company_${field.key}`}
                  type={field.type ?? "text"}
                  defaultValue={String((editing.setting_value as Record<string, unknown>)[field.key] ?? "")}
                />
              </label>
            ))
          ) : (
            <label className="wide">
              Valor (JSON — só para utilizadores avançados)
              <textarea name="setting_value" rows={8} defaultValue={JSON.stringify(editing.setting_value, null, 2)} />
            </label>
          )}
          <div className="button-row wide">
            <button type="submit">
              <Save size={16} />
              Guardar
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              <X size={16} />
              Cancelar
            </button>
          </div>
        </form>
      )}
      <DataTable
        rows={settings.map((setting) => ({ ...setting, id: setting.setting_key }))}
        identity="setting_key"
        columns={[
          { key: "setting_key", label: "Chave" },
          { key: "description", label: "Descrição" },
        ]}
        onEdit={(row) => setEditing(row)}
        onDelete={undefined}
      />
    </section>
  );
}

export function StaffAdminView({
  canAdmin,
  currentStaff,
  references,
  onRefresh,
}: {
  canAdmin: boolean;
  currentStaff: StaffMember | null;
  references: ReferenceData;
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Partial<StaffMember> | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [assinaturaFile, setAssinaturaFile] = useState<File | null>(null);
  const [assinaturaPreviewUrl, setAssinaturaPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visibleStaff = canAdmin ? references.staff : currentStaff ? [currentStaff] : [];

  function editStaff(member?: StaffMember) {
    if (!canAdmin && member?.id !== currentStaff?.id) return;
    setEditing(member ?? { role: "user", is_active: false });
    setSelectedProjects(
      canAdmin && member
        ? references.projectAccess
            .filter((access) => access.staff_member_id === member.id)
            .map((access) => access.project_id)
        : [],
    );
  }

  function toggleProject(projectId: string) {
    setSelectedProjects((current) =>
      current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId],
    );
  }

  function projectSummary(member: StaffMember) {
    if (normalizeRole(member.role) === "admin") return "Todas as obras";
    const names = references.projectAccess
      .filter((access) => access.staff_member_id === member.id)
      .map((access) => references.projects.find((project) => project.id === access.project_id)?.project_name)
      .filter(Boolean);

    return names.length ? names.join(", ") : "Sem obras";
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    try {
      if (canAdmin) {
        const role = String(form.get("role") || "user") as AppRole;
        const payload: Partial<StaffMember> = {
          id: editing?.id,
          full_name: String(form.get("full_name") ?? "").trim(),
          initials: String(form.get("initials") ?? "").trim().toUpperCase() || null,
          email: String(form.get("email") ?? "").trim().toLowerCase(),
          phone: String(form.get("phone") ?? "").trim() || null,
          role,
          is_active: form.get("is_active") === "on",
          authority_limit: role === "admin"
            ? null
            : (form.get("authority_limit") !== null && String(form.get("authority_limit")).trim() !== ""
                ? Number(form.get("authority_limit"))
                : 0),
        };

        const savedId = await saveStaffMember(payload, role === "admin" ? [] : selectedProjects);
        // se foi escolhida uma nova imagem de assinatura, faz o upload e grava o caminho
        if (assinaturaFile && savedId) {
          const path = await uploadAssinatura(assinaturaFile, savedId);
          await saveStaffMember({ id: savedId, signature_url: path }, []);
        }
      } else {
        await updateOwnStaffProfile({
          full_name: String(form.get("full_name") ?? "").trim(),
          initials: String(form.get("initials") ?? "").trim().toUpperCase() || null,
          phone: String(form.get("phone") ?? "").trim() || null,
        });
      }
      setEditing(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar o perfil.");
    }
  }

  async function remove(id: string) {
    if (!canAdmin) return;
    if (!(await confirmDialog("Eliminar este membro da equipa?"))) return;
    try {
      await deleteRow("staff_members", id);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível eliminar o membro da equipa.");
    }
  }

  return (
    <section className="work-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{canAdmin ? "Base de dados (admin)" : "A minha conta"}</p>
          <h2>{canAdmin ? "Equipa / Utilizadores" : "O meu perfil"}</h2>
        </div>
        {canAdmin && (
          <button onClick={() => editStaff()}>
            <Plus size={16} />
            Novo
          </button>
        )}
      </div>
      {error && <div className="notice error">{error}</div>}
      {editing && (
        <form className="editor-grid" onSubmit={submit}>
          <label>
            Full name
            <input name="full_name" required defaultValue={editing.full_name ?? ""} />
          </label>
          <label>
            Initials / code
            <input name="initials" defaultValue={editing.initials ?? ""} />
          </label>
          <label>
            Email
            <input name="email" required readOnly={!canAdmin} type="email" defaultValue={editing.email ?? currentStaff?.email ?? ""} />
          </label>
          <label>
            Phone number
            <input name="phone" defaultValue={editing.phone ?? ""} />
          </label>
          {canAdmin && (
            <>
              <label>
                Função
                <select name="role" defaultValue={normalizeRole(editing.role)}>
                  <option value="user">Utilizador</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>
              <label>
                Limite de autoridade (€, com IVA)
                <input name="authority_limit" type="number" min="0" step="0.01"
                  placeholder="Valor máximo que pode validar"
                  defaultValue={editing.authority_limit ?? ""} />
                <small className="field-hint">Deixe vazio apenas para administradores (validam qualquer valor).</small>
              </label>
              <label className="wide">
                Assinatura + carimbo (para o documento, quando este membro valida)
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setAssinaturaFile(event.target.files?.[0] ?? null)} />
                <small className="field-hint">PNG ou JPG, fundo transparente de preferência. Aparece no "Pela LEGDR" do documento impresso.</small>
                {editing.signature_url && !assinaturaFile && (
                  <span className="assinatura-status">Já tem uma assinatura carregada.</span>
                )}
              </label>
              <label>
                Acesso ativo
                <input name="is_active" type="checkbox" defaultChecked={Boolean(editing.is_active)} />
              </label>
              <fieldset className="project-access-list wide">
                <legend>Acesso a obras</legend>
                {references.projects.map((project) => (
                  <label key={project.id}>
                    <input
                      checked={selectedProjects.includes(project.id)}
                      onChange={() => toggleProject(project.id)}
                      type="checkbox"
                    />
                    <span>{project.project_name}</span>
                  </label>
                ))}
              </fieldset>
            </>
          )}
          <div className="button-row wide">
            <button type="submit">
              <Save size={16} />
              {canAdmin ? "Guardar acesso" : "Guardar perfil"}
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              <X size={16} />
              Cancelar
            </button>
          </div>
        </form>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome completo</th>
              <th>Iniciais</th>
              <th>Email</th>
              <th>Telefone</th>
              <th>Função</th>
              <th>Estado</th>
              <th>Obras</th>
              <th className="actions-cell">Ações</th>
            </tr>
          </thead>
          <tbody>
            {visibleStaff.map((member) => (
              <tr key={member.id}>
                <td>{member.full_name}</td>
                <td>{member.initials}</td>
                <td>{member.email}</td>
                <td>{member.phone}</td>
                <td>{normalizeRole(member.role)}</td>
                <td>{member.is_active ? "Ativo" : "Pendente"}</td>
                <td>{projectSummary(member)}</td>
                <td className="actions-cell">
                  <button className="icon-button" onClick={() => editStaff(member)} title="Editar acesso">
                    <Pencil size={16} />
                  </button>
                  {canAdmin && (
                    <button className="icon-button danger" onClick={() => remove(member.id)} title="Eliminar">
                      <Trash2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!visibleStaff.length && (
              <tr>
                <td colSpan={8}>Ainda sem registos de equipa.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function DataTable<T extends Record<string, unknown>>({
  rows,
  columns,
  identity,
  onEdit,
  onDelete,
}: {
  rows: T[];
  columns: { key: keyof T & string; label: string }[];
  identity: keyof T & string;
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
            <th>Estado</th>
            <th className="actions-cell">Ações</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id ?? row[identity])}>
              {columns.map((column) => (
                <td key={column.key}>{String(row[column.key] ?? "")}</td>
              ))}
              <td>{row.is_active === false ? "Inativo" : "Ativo"}</td>
              <td className="actions-cell">
                {onEdit && (
                  <button className="icon-button" onClick={() => onEdit(row)} title="Editar" aria-label="Editar">
                    <Pencil size={16} />
                  </button>
                )}
                {onDelete && (
                  <button className="icon-button danger" onClick={() => onDelete(row)} title="Eliminar">
                    <Trash2 size={16} />
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={columns.length + 2}>Ainda sem registos.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
