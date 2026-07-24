import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Copy, Trash2 } from "lucide-react";
import {
  loadPriceItems,
  insertPriceItems,
  updatePriceItem,
  deletePriceItem,
  priceItemKey,
  loadPriceProjectCounts,
} from "./lib/data";
import { parseExcelLines } from "./lib/excel";
import { money, shortDate } from "./lib/format";
import type { ReferenceData, SupplierPriceItem } from "./types";

type Comparacao = {
  novos: { item_ref: string; description: string; unit: string; unit_price: number }[];
  alterados: { existente: SupplierPriceItem; precoNovo: number; unidadeNova: string }[];
  iguais: number;
};

export function PriceListView({ references, canWrite }: { references: ReferenceData; canWrite: boolean }) {
  const [supplierId, setSupplierId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [items, setItems] = useState<SupplierPriceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");
  const [copyAjuste, setCopyAjuste] = useState("");
  const [copySource, setCopySource] = useState<SupplierPriceItem[]>([]);
  const [copyLoading, setCopyLoading] = useState(false);
  const [projectCounts, setProjectCounts] = useState<Record<string, number>>({});

  const escolhido = supplierId !== "" && projectId !== "";

  async function refresh() {
    if (!escolhido) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setItems(await loadPriceItems(supplierId, projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o preçário.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, projectId]);

  // que obras é que este fornecedor já tem com preçário (para copiar de lá)
  useEffect(() => {
    if (supplierId === "") {
      setProjectCounts({});
      return;
    }
    loadPriceProjectCounts(supplierId).then(setProjectCounts).catch(() => setProjectCounts({}));
  }, [supplierId, items]);

  // carrega o preçário da obra de origem quando é escolhida
  useEffect(() => {
    if (copyFrom === "") {
      setCopySource([]);
      return;
    }
    setCopyLoading(true);
    loadPriceItems(supplierId, copyFrom)
      .then(setCopySource)
      .catch(() => setCopySource([]))
      .finally(() => setCopyLoading(false));
  }, [copyFrom, supplierId]);

  // Compara o que foi colado com o que já existe: novos, com preço alterado, iguais
  const comparacao: Comparacao = useMemo(() => {
    const coladas = parseExcelLines(pasteText);
    const porChave = new Map(items.map((i) => [priceItemKey(i), i]));
    const c: Comparacao = { novos: [], alterados: [], iguais: 0 };
    coladas.forEach((l) => {
      const existente = porChave.get(priceItemKey({ item_ref: l.item_ref, description: l.description }));
      if (!existente) {
        c.novos.push({ item_ref: l.item_ref, description: l.description, unit: l.unit, unit_price: l.rate });
      } else if (Math.abs(Number(existente.unit_price) - l.rate) > 0.0001 || existente.unit !== l.unit) {
        c.alterados.push({ existente, precoNovo: l.rate, unidadeNova: l.unit });
      } else {
        c.iguais += 1;
      }
    });
    return c;
  }, [pasteText, items]);

  // O que vai ser copiado: só os artigos que ainda não existem nesta obra
  const ajustePct = copyAjuste.trim() === "" ? 0 : Number(copyAjuste.replace(",", "."));
  const ajusteValido = Number.isFinite(ajustePct);
  const copiaveis = useMemo(() => {
    const jaTem = new Set(items.map((i) => priceItemKey(i)));
    return copySource.filter((s) => !jaTem.has(priceItemKey(s)));
  }, [copySource, items]);
  const jaExistem = copySource.length - copiaveis.length;

  function precoAjustado(valor: number): number {
    const p = valor * (1 + (ajusteValido ? ajustePct : 0) / 100);
    return Math.round(p * 10000) / 10000;
  }

  async function copiarDeOutraObra() {
    if (copiaveis.length === 0 || !ajusteValido) return;
    setSaving(true);
    setError(null);
    try {
      await insertPriceItems(
        copiaveis.map((s) => ({
          supplier_id: supplierId,
          project_id: projectId,
          item_ref: s.item_ref,
          description: s.description,
          unit: s.unit,
          unit_price: precoAjustado(Number(s.unit_price)),
          category_id: s.category_id,
        })),
      );
      setCopyOpen(false);
      setCopyFrom("");
      setCopyAjuste("");
      setCopySource([]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível copiar o preçário.");
    } finally {
      setSaving(false);
    }
  }

  async function gravarColagem() {
    setSaving(true);
    setError(null);
    try {
      await insertPriceItems(
        comparacao.novos.map((n) => ({
          supplier_id: supplierId,
          project_id: projectId,
          item_ref: n.item_ref || null,
          description: n.description,
          unit: n.unit,
          unit_price: n.unit_price,
        })),
      );
      for (const a of comparacao.alterados) {
        await updatePriceItem(a.existente.id, { unit_price: a.precoNovo, unit: a.unidadeNova });
      }
      setPasteText("");
      setPasteOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gravar o preçário.");
    } finally {
      setSaving(false);
    }
  }

  async function alterarPreco(item: SupplierPriceItem, valor: string) {
    const novo = Number(valor);
    if (!Number.isFinite(novo) || Math.abs(novo - Number(item.unit_price)) < 0.0001) return;
    try {
      await updatePriceItem(item.id, { unit_price: novo });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar o preço.");
    }
  }

  async function remover(item: SupplierPriceItem) {
    if (!window.confirm(`Remover "${item.description}" do preçário?`)) return;
    try {
      await deletePriceItem(item.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover o artigo.");
    }
  }

  const visiveis = items.filter(
    (i) =>
      filtro.trim() === "" ||
      i.description.toLowerCase().includes(filtro.toLowerCase()) ||
      (i.item_ref ?? "").toLowerCase().includes(filtro.toLowerCase()),
  );

  return (
    <section className="work-section">
      <div className="section-heading">
        <h2>Preçários</h2>
        {canWrite && escolhido && (
          <div className="linhas-acoes">
            <button type="button" className="secondary" onClick={() => setCopyOpen(true)}>
              <Copy size={16} />
              Copiar de outra obra
            </button>
            <button type="button" className="secondary" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste size={16} />
              Colar / atualizar do Excel
            </button>
          </div>
        )}
      </div>
      <p className="muted">
        Preços negociados com cada fornecedor para cada obra. Ao importar um artigo para uma adjudicação, o preço é
        copiado para a linha — atualizar aqui nunca altera adjudicações já feitas.
      </p>

      <div className="accrual-filters">
        <label>
          Fornecedor
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— escolher —</option>
            {references.suppliers
              .filter((s) => s.is_active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.supplier_name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Obra
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">— escolher —</option>
            {references.projects
              .filter((p) => p.is_active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_name}
                </option>
              ))}
          </select>
        </label>
        {escolhido && items.length > 0 && (
          <label>
            Procurar
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Ref. ou descrição…" />
          </label>
        )}
      </div>

      {error && <p className="notice error">{error}</p>}

      {!escolhido ? (
        <p className="muted">Escolha o fornecedor e a obra para ver o preçário.</p>
      ) : loading ? (
        <p className="muted">A carregar…</p>
      ) : items.length === 0 ? (
        <p className="muted">
          Ainda não há preçário para este fornecedor nesta obra.
          {canWrite && " Crie-o com \u201cColar / atualizar do Excel\u201d ou copie de outra obra."}
        </p>
      ) : (
        <>
          <p className="paste-resumo">
            <strong>{items.length}</strong> artigo(s) no preçário
            {filtro.trim() !== "" && ` · ${visiveis.length} a corresponder ao filtro`}
          </p>
          <div className="table-wrap">
            <table className="recon-table">
              <thead>
                <tr>
                  <th>Ref.</th>
                  <th>Descrição</th>
                  <th>Un.</th>
                  <th className="num">Preço</th>
                  <th>Preço atualizado</th>
                  {canWrite && <th />}
                </tr>
              </thead>
              <tbody>
                {visiveis.map((i) => (
                  <tr key={i.id}>
                    <td>{i.item_ref || "—"}</td>
                    <td>{i.description}</td>
                    <td>{i.unit}</td>
                    <td className="num">
                      {canWrite ? (
                        <input
                          className="preco-input"
                          type="number"
                          step="0.0001"
                          min="0"
                          defaultValue={Number(i.unit_price)}
                          onBlur={(e) => alterarPreco(i, e.target.value)}
                        />
                      ) : (
                        money(Number(i.unit_price))
                      )}
                    </td>
                    <td className="muted">{shortDate(i.price_updated_at)}</td>
                    {canWrite && (
                      <td>
                        <button className="icon-button" title="Remover" onClick={() => remover(i)}>
                          <Trash2 size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {copyOpen && (
        <div className="modal-overlay" onClick={() => setCopyOpen(false)}>
          <div className="modal-card paste-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Copiar preçário de outra obra</h3>
            <p className="muted">
              Traz para esta obra os artigos do preçário deste fornecedor noutra obra. Os artigos que já existem
              aqui <strong>mantêm-se como estão</strong> — só são acrescentados os que faltam.
            </p>

            <div className="accrual-filters">
              <label>
                Copiar da obra
                <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                  <option value="">— escolher —</option>
                  {references.projects
                    .filter((p) => p.id !== projectId && (projectCounts[p.id] ?? 0) > 0)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.project_name} ({projectCounts[p.id]} artigos)
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Ajustar preços (%)
                <input
                  value={copyAjuste}
                  onChange={(e) => setCopyAjuste(e.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                />
                <small className="field-hint">Opcional. Ex: 3 sobe 3%; -2 desce 2%.</small>
              </label>
            </div>

            {references.projects.filter((p) => p.id !== projectId && (projectCounts[p.id] ?? 0) > 0).length === 0 && (
              <p className="notice">Este fornecedor ainda não tem preçário em nenhuma outra obra.</p>
            )}

            {copyFrom !== "" && (
              copyLoading ? (
                <p className="muted">A carregar…</p>
              ) : (
                <>
                  <p className="paste-resumo">
                    <strong>{copiaveis.length}</strong> artigo(s) a copiar
                    {jaExistem > 0 && <span className="paste-aviso"> · {jaExistem} já existem aqui (mantêm-se)</span>}
                    {!ajusteValido && <span className="paste-aviso"> · percentagem inválida</span>}
                  </p>
                  {copiaveis.length > 0 && (
                    <div className="table-wrap paste-preview">
                      <table className="recon-table">
                        <thead>
                          <tr>
                            <th>Ref.</th>
                            <th>Descrição</th>
                            <th>Un.</th>
                            <th className="num">Preço origem</th>
                            {ajusteValido && ajustePct !== 0 && <th className="num">Preço nesta obra</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {copiaveis.slice(0, 40).map((s) => (
                            <tr key={s.id}>
                              <td>{s.item_ref || "—"}</td>
                              <td>{s.description}</td>
                              <td>{s.unit}</td>
                              <td className="num">{money(Number(s.unit_price))}</td>
                              {ajusteValido && ajustePct !== 0 && (
                                <td className={`num ${ajustePct > 0 ? "variacao-sobe" : "variacao-desce"}`}>
                                  <strong>{money(precoAjustado(Number(s.unit_price)))}</strong>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {copiaveis.length > 40 && (
                        <p className="muted">…e mais {copiaveis.length - 40} artigo(s).</p>
                      )}
                    </div>
                  )}
                </>
              )
            )}

            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => { setCopyOpen(false); setCopyFrom(""); setCopyAjuste(""); }}>
                Cancelar
              </button>
              <button type="button" onClick={copiarDeOutraObra} disabled={saving || copiaveis.length === 0 || !ajusteValido}>
                {saving ? "A copiar…" : `Copiar ${copiaveis.length || ""} artigo(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {pasteOpen && (
        <div className="modal-overlay" onClick={() => setPasteOpen(false)}>
          <div className="modal-card paste-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Colar / atualizar preçário</h3>
            <p className="muted">
              Cole a lista do fornecedor (Ctrl+V). Ordem das colunas:{" "}
              <strong>Ref. | Descrição | Qtd | Unidade | Preço</strong> — a coluna Qtd é ignorada aqui.
              Artigos que já existem ficam com o <strong>preço atualizado</strong>; os que não existem são criados.
            </p>
            <textarea
              rows={7}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"Cole aqui...\n\nExemplo:\nBET30\tBetão C30/37\t\tm3\t82,50 €"}
            />
            {pasteText.trim() !== "" && (
              <>
                <p className="paste-resumo">
                  <strong>{comparacao.novos.length}</strong> novo(s) ·{" "}
                  <span className="paste-aviso">{comparacao.alterados.length} com preço alterado</span> ·{" "}
                  {comparacao.iguais} sem alteração
                </p>
                {comparacao.alterados.length > 0 && (
                  <div className="table-wrap paste-preview">
                    <table className="recon-table">
                      <thead>
                        <tr>
                          <th>Descrição</th>
                          <th className="num">Preço atual</th>
                          <th className="num">Preço novo</th>
                          <th className="num">Variação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparacao.alterados.slice(0, 40).map((a) => {
                          const antigo = Number(a.existente.unit_price);
                          const var_pct = antigo > 0 ? ((a.precoNovo - antigo) / antigo) * 100 : 0;
                          return (
                            <tr key={a.existente.id}>
                              <td>{a.existente.description}</td>
                              <td className="num">{money(antigo)}</td>
                              <td className="num">
                                <strong>{money(a.precoNovo)}</strong>
                              </td>
                              <td className={var_pct >= 0 ? "num variacao-sobe" : "num variacao-desce"}>
                                {var_pct >= 0 ? "+" : ""}
                                {var_pct.toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setPasteOpen(false);
                  setPasteText("");
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={gravarColagem}
                disabled={saving || (comparacao.novos.length === 0 && comparacao.alterados.length === 0)}
              >
                {saving ? "A gravar…" : "Gravar alterações"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

