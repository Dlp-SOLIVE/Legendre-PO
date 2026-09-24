import { useEffect, useState } from "react";
import { Printer, X, CheckCircle2, Mail } from "lucide-react";
import { getAssinaturaUrl, loadPoRevisions, markSentToSupplier, unmarkSentToSupplier } from "./lib/data";
import { lineNet, money, shortDate } from "./lib/format";
import { DeliveryReconciliation } from "./DeliveryReconciliation";
import legendreLogo from "./assets/legendre-logo.png";
import type { PurchaseOrderRevision, AppSetting, PurchaseOrder, PurchaseOrderLineItem, StaffMember } from "./types";
import { statusLabel } from "./shared";

export function PreviewModal({ po, settings, onClose, canWrite, currentStaff, onRefresh }: { po: PurchaseOrder; settings: AppSetting[]; onClose: () => void; canWrite: boolean; currentStaff: StaffMember | null; onRefresh: () => Promise<unknown> }) {
  const company = (settings.find((setting) => setting.setting_key === "company")?.setting_value ?? {}) as Record<string, string>;
  const [sentAt, setSentAt] = useState<string | null>(po.sent_to_supplier_at ?? null);
  const [emailOpened, setEmailOpened] = useState(false);
  const [revisions, setRevisions] = useState<PurchaseOrderRevision[]>([]);
  useEffect(() => {
    if (!po.revision) {
      setRevisions([]);
      return;
    }
    loadPoRevisions(po.id).then(setRevisions).catch(() => setRevisions([]));
  }, [po.id, po.revision]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supplierEmail = po.supplier?.email ?? "";

  // Abre o Outlook (cliente de email predefinido) com a mensagem já preenchida.
  // O PDF tem de ser anexado pelo utilizador — nenhum browser permite anexar ficheiros automaticamente.
  function openEmailToSupplier() {
    const obra = po.project?.project_name ?? "";
    const codigoObra = po.invoice_project_code;
    const contacto = po.supplier?.contact_name;
    const assunto = `Adjudicação ${po.po_number}${obra ? ` — ${obra}` : ""}`;
    const corpo = [
      contacto ? `Exmo.(a) Sr.(a) ${contacto},` : "Exmos. Senhores,",
      "",
      `Junto enviamos a adjudicação ${po.po_number}${obra ? `, referente à obra ${obra}` : ""}.`,
      "",
      `Solicitamos que todas as faturas façam referência ao nosso número de adjudicação (${po.po_number})${codigoObra ? ` e ao código de obra ${codigoObra}` : ""}, sem os quais não poderão ser aceites.`,
      "",
      "Agradecemos a devolução do documento devidamente assinado.",
      "",
      "Com os melhores cumprimentos,",
    ].join("\r\n");
    // Nota: a assinatura (nome + empresa) é deixada de fora do corpo de propósito —
    // o Outlook acrescenta automaticamente a assinatura do utilizador ao criar a mensagem.
    window.location.href = `mailto:${supplierEmail}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
  }

  async function alternarEnviada(enviada: boolean) {
    setBusy(true);
    setSendError(null);
    try {
      if (enviada) {
        await markSentToSupplier(po.id, currentStaff?.id ?? null);
        setSentAt(new Date().toISOString());
      } else {
        await unmarkSentToSupplier(po.id);
        setSentAt(null);
      }
      await onRefresh();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Não foi possível registar o envio.");
    } finally {
      setBusy(false);
    }
  }

  function printPurchaseOrder() {
    const previousTitle = document.title;
    const cleanPoNumber = po.po_number.replace(/[\\/:*?"<>|]+/g, "-");
    // O browser usa o título do documento como nome sugerido do PDF.
    // Incluir também o nome do fornecedor. Ex.: "ADJ_URB.2026-120 - Odifercol Materiais de Construção, Lda"
    const supplierName = (po.supplier?.supplier_name ?? "").replace(/[\\/:*?"<>|]+/g, "-").trim();
    document.title = supplierName ? `${cleanPoNumber} - ${supplierName}` : cleanPoNumber;

    const restoreTitle = () => {
      document.title = previousTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };

    window.addEventListener("afterprint", restoreTitle, { once: true });
    window.print();
    window.setTimeout(restoreTitle, 1200);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-shell">
        <div className="modal-actions">
          <button onClick={printPurchaseOrder}>
            <Printer size={16} />
            1 · Guardar PDF
          </button>
          <button
            className="secondary"
            onClick={() => {
              openEmailToSupplier();
              setEmailOpened(true);
            }}
            disabled={!supplierEmail}
            title={supplierEmail ? `Abre o email para ${supplierEmail}` : "O fornecedor não tem email na ficha"}
          >
            <Mail size={16} />
            2 · Email ao fornecedor
          </button>
          {po.status !== "validated" ? null : sentAt ? (
            <span className="sent-badge">
              ✓ Enviada em {shortDate(sentAt)}
              <button className="link-button" disabled={busy} onClick={() => alternarEnviada(false)}>desmarcar</button>
            </span>
          ) : (
            <button className="secondary" disabled={busy} onClick={() => alternarEnviada(true)}>
              <CheckCircle2 size={16} />
              3 · Marcar como enviada
            </button>
          )}
          <button className="secondary" onClick={onClose}>
            <X size={16} />
            Fechar
          </button>
        </div>
        <p className="envio-hint no-print">
          {po.status === "validated"
            ? "Três passos: guarde o PDF, abra o email e anexe o PDF no Outlook, e no fim marque como enviada."
            : "Só adjudicações validadas podem ser enviadas ao fornecedor."}
        </p>
        {emailOpened && !sentAt && po.status === "validated" && (
          <p className="notice no-print">
            Já enviou o email com o PDF?{" "}
            <button type="button" className="link-button" disabled={busy} onClick={() => alternarEnviada(true)}>
              Sim, marcar como enviada
            </button>
          </p>
        )}
        {revisions.length > 0 && (
          <div className="notice no-print">
            <strong>Histórico de revisões</strong>
            {revisions.map((rev) => (
              <span key={rev.id} style={{ display: "block" }}>
                Rev. {rev.revision} substituída em {shortDate(rev.created_at)}
                {rev.staff?.full_name ? ` por ${rev.staff.full_name}` : ""}
                {rev.reason ? ` — ${rev.reason}` : ""}
              </span>
            ))}
          </div>
        )}
        {sendError && <p className="notice error no-print">{sendError}</p>}
        <PurchaseOrderPreview po={po} company={company} />
        <div className="recon-wrap no-print">
          <DeliveryReconciliation purchaseOrder={po} canWrite={canWrite} />
        </div>
      </div>
    </div>
  );
}

// Linhas do documento paginadas com "A transportar" / "Transporte".
// Divide as linhas em páginas de LINHAS_POR_PAGINA; cada página que continua
// fecha com o subtotal acumulado ("A transportar") e a seguinte abre com o
// mesmo valor ("Transporte"). A última página fecha com o Total líquido.
export const LINHAS_POR_PAGINA = 28; // calibrado para caber numa A4 com cabeçalho


export function PoLinesPaginated({ lines }: { lines: PurchaseOrderLineItem[] }) {
  // dividir em páginas
  const pages: PurchaseOrderLineItem[][] = [];
  for (let i = 0; i < lines.length; i += LINHAS_POR_PAGINA) {
    pages.push(lines.slice(i, i + LINHAS_POR_PAGINA));
  }
  if (pages.length === 0) pages.push([]);

  let acumulado = 0;

  return (
    <>
      {pages.map((pageLines, pageIndex) => {
        const transporte = acumulado; // o que vem de trás
        pageLines.forEach((l) => { acumulado += lineNet(l); });
        const isLast = pageIndex === pages.length - 1;
        const isFirst = pageIndex === 0;

        return (
          <table className="po-lines po-lines-page" key={pageIndex}>
            <colgroup>
              <col className="po-line-ref" />
              <col className="po-line-description" />
              <col className="po-line-quantity" />
              <col className="po-line-unit" />
              <col className="po-line-rate" />
              <col className="po-line-disc" />
              <col className="po-line-total" />
            </colgroup>
            <thead>
              <tr>
                <th>Ref. artigo</th>
                <th>Descrição</th>
                <th>Quantidade</th>
                <th>Unidade</th>
                <th>Preço unitário</th>
                <th>Desc.</th>
                <th>Total líquido</th>
              </tr>
            </thead>
            <tbody>
              {/* "Transporte" no topo das páginas seguintes */}
              {!isFirst && (
                <tr className="po-transporte-row">
                  <td colSpan={6}>Transporte</td>
                  <td>{money(transporte)}</td>
                </tr>
              )}
              {pageLines.map((line, index) => (
                <tr key={line.id ?? index}>
                  <td>{line.item_ref ?? "-"}</td>
                  <td>{line.description}</td>
                  <td>{line.quantity}</td>
                  <td>{line.unit}</td>
                  <td>{money(line.rate)}</td>
                  <td>{((line.discount_pct ?? 0) > 0 || (line.discount_pct_2 ?? 0) > 0)
                    ? [line.discount_pct, line.discount_pct_2].filter((d) => (d ?? 0) > 0).map((d) => `${d}%`).join(" + ")
                    : "—"}</td>
                  <td>{money(lineNet(line))}</td>
                </tr>
              ))}
            </tbody>
            {/* "A transportar" no fim das páginas que continuam */}
            {!isLast && (
              <tfoot>
                <tr className="po-transporte-row">
                  <td colSpan={6}>A transportar</td>
                  <td>{money(acumulado)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        );
      })}
    </>
  );
}

export function PurchaseOrderPreview({ po, company }: { po: PurchaseOrder; company: Record<string, string> }) {
  const invoiceEmail = company.accounts_email ?? "";
  // assinatura pré-carregada de quem validou (imagem privada — precisa de link temporário)
  const [assinaturaUrl, setAssinaturaUrl] = useState<string | null>(null);
  useEffect(() => {
    const path = po.validator?.signature_url;
    if (!path) {
      setAssinaturaUrl(null);
      return;
    }
    getAssinaturaUrl(path).then(setAssinaturaUrl).catch(() => setAssinaturaUrl(null));
  }, [po.validator?.signature_url]);
  // resumo por código analítico (para o rodapé do documento)
  const analyticSummary = (() => {
    const map = new Map<string, number>();
    (po.line_items ?? []).forEach((line) => {
      const code = line.category?.category_code ?? "—";
      map.set(code, (map.get(code) ?? 0) + lineNet(line));
    });
    return Array.from(map.entries()).map(([code, value]) => ({ code, value }));
  })();
  return (
    <div className="print-area">
      <article className="po-page po-order-page">
        <header className="po-header">
          <img className="po-logo-image" src={legendreLogo} alt="Legendre" />
          <div className="po-company">
            <strong>{company.name ?? "Legendre"}</strong>
            {(company.legal_name ?? "LEGDR Engenharia e Construção, Lda") && (
              <span>{company.legal_name ?? "LEGDR Engenharia e Construção, Lda"}</span>
            )}
            {(company.vat_number ?? "") && (
              <span>NIF: {company.vat_number}</span>
            )}
            <span>{company.address ?? ""}</span>
            <span>{company.phone ?? ""}</span>
            <span>{company.email ?? ""}</span>
          </div>
        </header>
        <h2 className="po-title">Adjudicação</h2>
        <section className="po-meta-grid">
          <div className="po-number-cell">
            <span>Número</span>
            <strong>
              {po.po_number}
              {po.revision ? ` · Rev. ${po.revision}` : ""}
            </strong>
          </div>
          <div>
            <span>Data</span>
            <strong>{shortDate(po.po_date)}</strong>
          </div>
          <div>
            <span>Estado</span>
            <strong>{statusLabel(po.status)}</strong>
          </div>
          <div>
            <span>Condições de pagamento</span>
            <strong>{po.payment_terms ?? "—"}</strong>
          </div>
          <div>
            <span>Código de obra na fatura</span>
            <strong>{po.invoice_project_code ?? "—"}</strong>
          </div>
          <div>
            <span>Data de entrega</span>
            <strong>{shortDate(po.delivery_date)}</strong>
            {po.delivery_time && <em>{po.delivery_time}</em>}
          </div>
        </section>
        <section className="po-info-grid">
          <div>
            <h3>Dados do fornecedor</h3>
            <dl>
              <dt>Nome</dt>
              <dd>{po.supplier?.supplier_name}</dd>
              <dt>Contacto comercial</dt>
              <dd>{po.supplier_contact_name}</dd>
              <dt>Telefone</dt>
              <dd>{po.supplier_phone}</dd>
              <dt>Email</dt>
              <dd>{po.supplier_email}</dd>
              <dt>Morada</dt>
              <dd>{po.supplier_address}</dd>
            </dl>
          </div>
          <div>
            <h3>Obra / local</h3>
            <dl>
              <dt>Obra</dt>
              <dd>{po.project?.project_name}</dd>
              <dt>Centro de custo</dt>
              <dd>{po.project?.cost_centre_code}</dd>
              <dt>Contactos na obra</dt>
              <dd className="po-multiline">{po.site_contact}</dd>
              <dt>Morada</dt>
              <dd>{po.delivery_address}</dd>
            </dl>
          </div>
        </section>
        <PoLinesPaginated lines={po.line_items ?? []} />
        <section className="po-bottom-grid">
          <div>
            <h3>Instruções de entrega</h3>
            <p>{po.delivery_instructions}</p>
            <p>{po.vehicle_requirements}</p>
            <p>{po.offloading_instructions}</p>
          </div>
          <div className="po-totals">
            <div className="po-total-liquido">
              <span>Total líquido</span>
              <strong>{money(po.subtotal)}</strong>
            </div>
            <p className="po-iva-note">Aos valores apresentados acresce o IVA à taxa legal em vigor.</p>
          </div>
        </section>
        {po.notes && (
          <section className="po-notes-block">
            <h3>Notas da adjudicação</h3>
            <p>{po.notes}</p>
          </section>
        )}
        <section className="po-analytic-footer">
          <table className="po-analytic-table">
            <thead><tr><th>Código analítico</th><th>Valor</th></tr></thead>
            <tbody>
              {analyticSummary.map((row) => (
                <tr key={row.code}><td>{row.code}</td><td>{money(row.value)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <footer className="po-footer">
          {invoiceEmail
            ? `As faturas devem ser enviadas em formato .pdf para ${invoiceEmail}, indicando o número da adjudicação.`
            : "As faturas devem indicar sempre o número da adjudicação (N/Ref.ª) e o código de obra."}
        </footer>
      </article>
      {po.include_terms_conditions && (
        <article className="po-page clausulas-page">
          <div className="po-clausulas-header">
            <img className="po-logo-image" src={legendreLogo} alt="Legendre" />
            <div className="po-company">
              <strong>{company.name ?? "Legendre"}</strong>
              <span>{company.legal_name ?? "LEGDR Engenharia e Construção, Unipessoal Lda"}</span>
              {company.vat_number && <span>NIF: {company.vat_number}</span>}
            </div>
          </div>
          <ol className="po-clausulas">
            {clausulasAdjudicacao.map((clausula, index) => (
              <li key={index}>{clausula}</li>
            ))}
          </ol>
          <div className="po-signatures">
            <div className="po-sign-block">
              <span className="po-sign-label">Pela LEGDR</span>
              {assinaturaUrl ? (
                <>
                  <img className="po-sign-image" src={assinaturaUrl} alt="Assinatura e carimbo" />
                  <span className="po-sign-name">{po.validator?.full_name}</span>
                </>
              ) : (
                <div className="po-sign-line" />
              )}
            </div>
            <div className="po-sign-block">
              <span className="po-sign-label">Pelo FORNECEDOR</span>
              <div className="po-sign-line" />
            </div>
          </div>
        </article>
      )}
    </div>
  );
}

// 11 cláusulas legais da Adjudicação (texto PT do modelo LEGDR)
export const clausulasAdjudicacao = [
  "As faturas deverão referir sempre a nossa referência de adjudicação (N/Ref.ª) e o Código de Obra.",
  "As faturas deverão vir sempre acompanhadas de documento comprovativo da boa receção dos materiais em obra, sem os quais não serão aceites na nossa contabilidade.",
  "Os originais das faturas deverão dar entrada nos nossos serviços até ao dia 5 do mês seguinte ao fornecimento, caso contrário transitará para o mês seguinte, podendo atrasar o pagamento até ao máximo de um mês.",
  "É obrigatório que o número do documento das adjudicações/contratos, bem como o nome da obra ou departamento de destino do fornecimento, constem dos respetivos autos de medição, guias de remessa e faturas de fornecimento, caso contrário serão imediatamente devolvidos.",
  "Com a assinatura do presente, o FORNECEDOR concorda com o cumprimento do prazo de entrega estabelecido no cabeçalho da presente notificação de adjudicação.",
  "Exclui-se da responsabilidade do FORNECEDOR o não cumprimento dos prazos estabelecidos por casos de força maior relacionadas com atos de guerra ou subversão, epidemias, ciclones, tremores de terra ou outros que venham a ter o reconhecimento expresso pela LEGDR.",
  "A resolução de todas as divergências ou questões emergentes do contrato, sua interpretação e aplicação, procurarão ser resolvidas por ambas as outorgantes através da livre negociação de boa-fé.",
  "No caso de a faculdade prevista no artigo anterior não se revelar por si só suficiente para a resolução a contento das partes, os litígios decorrentes da execução, interpretação e aplicação do presente contrato e de eventuais aditamentos ao mesmo, serão obrigatoriamente submetidos ao tribunal de Lisboa, renunciando desde já as OUTORGANTES a qualquer outro.",
  "Caso se verifiquem divergências entre o presente contrato e quaisquer dos seus anexos ou documentos que o integram, o conteúdo do título contratual prevalecerá sobre os Anexos e restantes documentos, excetuando-se os casos em que exista acordo expresso entre as partes.",
  "O FORNECEDOR declara, com a assinatura deste contrato, a correspondência do material fornecido com o que foi solicitado pela LEGDR, bem como o cumprimento de todas as características físicas e químicas mínimas definidas por esta.",
  "A LEGDR reserva-se no direito realizar ensaios de caracterização de materiais, recorrendo a laboratórios externos devidamente credenciados.",
];
