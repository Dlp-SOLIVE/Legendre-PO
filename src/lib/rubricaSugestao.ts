// Sugestão automática da rubrica (código analítico "Analítica - Portugal") para uma linha de adjudicação.
// Ordem de procura:
//   1. Preçário do fornecedor nesta obra (artigo com a mesma Ref./descrição)
//   2. Histórico de adjudicações (o código mais usado para a mesma Ref./descrição)
//   3. Palavras-chave na descrição (tabela abaixo)
// Só sugere códigos ATIVOS (lista atual). Quem cria a adjudicação confirma ou altera.

import type { CostCategory, PurchaseOrder, SupplierPriceItem } from "../types";

export type FonteSugestao = "preçário" | "histórico" | "palavra-chave";

export type Sugestao = { category: CostCategory; fonte: FonteSugestao };

/** minúsculas, sem acentos, sem pontuação repetida, espaços simples */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/%.,+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chaveLinha(itemRef: string | null | undefined, descricao: string): string {
  const ref = (itemRef ?? "").trim();
  return ref !== "" ? `ref:${ref.toLowerCase()}` : `desc:${normalizarTexto(descricao)}`;
}

// ── Palavras-chave → código. A ORDEM CONTA: as regras mais específicas vêm primeiro. ──
// Os textos são comparados já normalizados (sem acentos, minúsculas).
const REGRAS: Array<[string, RegExp]> = [
  // Aluguer / equipamento (antes dos materiais, p.ex. "bomba de betão" não é betão)
  ["OP324", /bomba (de |para )?betao|autobomba|bombagem (de )?betao/],
  ["OP300", /(montagem|desmontagem|instalacao) (de |da )?grua/],
  ["OP319", /aluguer.*cofrag|cofrag.*aluguer|mesa(s)? de cofragem/],
  ["OP316", /\bprumo|\bescora/],
  ["OP323", /plataforma (elevatoria|de trabalho|tesoura|articulada)|\bpta\b|bailarina/],
  ["OP320", /\bgrua|guindaste|empilhador|manitou|telescopic|monta.?cargas|elevador de obra/],
  ["OP310", /contentor(es)? (de |para )?(lixo|entulho|residuos)|big.?bag/],
  ["OP311", /aluguer.*contentor|contentor (de )?(escritorio|sanitario|wc|dormitorio|vestiario|obra)|wc quimico|cabine sanitaria|sanitario portatil/],
  ["OP314", /aluguer.*(berbequim|rebarbadora|martelo|serra|aspirador|vibrador)|vibrador de agulha/],
  ["OP315", /escavadora|retroescavadora|giratoria|mini.?pa|bobcat|cilindro (de )?compacta|compactador|placa vibratoria|dumper|gerador|betoneira|martelo pneumatico|compressor/],
  ["OP327", /reparacao (de |da |do )?(equipamento|maquina)|revisao (de |da |do )?(equipamento|maquina)/],
  ["OP326", /aluguer (de )?(viatura|carrinha|automovel)|manutencao (de |da )?viatura|portage|via verde/],
  ["OP312", /gasoleo|gasolina|combustivel|propano|butano|adblue|garrafa de gas/],
  ["OP415", /residuos|\brcd\b|entulho|vazadouro|operador de gestao/],
  ["OP325", /\btransporte|\bfrete|\bportes\b/],

  // Madeira
  ["OP200", /contraplacado|tricapa|\bosb\b/],
  ["OP201", /madeira (de |para )?cofragem|tabua|barrote|\bvigas? de madeira|\bpinho\b/],
  ["OP202", /negativo/],

  // Aço
  ["OP205", /\bmalha|electrosoldad|eletrosoldad|malhasol/],
  ["OP206", /caixa(s)? de espera|varao de espera|ferro de espera/],
  ["OP208", /rotura termica|isokorb|corte termico/],
  ["OP207", /espacador|distanciador|arame|separador(es)? (de )?armadura|cadeirinha/],
  ["OP204", /\ba ?500|\ba ?400|\bvarao|\bvaroes|\baco (em |para )?(betao|varao|corte|moldad|armad)|armadura|estribo|ferro (para |de )?(betao|construcao)/],

  // Pré-fabricados
  ["OP217", /varanda(s)? pre.?fabric/],
  ["OP218", /(parede|painel|paineis)(s)? pre.?fabric/],
  ["OP219", /escada(s)? pre.?fabric|lanco(s)? de escada/],
  ["OP216", /pre.?laje|laje(s)? (alveolar|pre.?fabric)|alveolar/],
  ["OP215", /vigota|abobadilha|viga(s)? pre.?(fabric|esforc)/],
  ["OP220", /pre.?fabric/],

  // Alvenarias e gesso cartonado antes de cimento/betão/adjuvantes ("bloco de betão", "pladur hidrófugo")
  ["OP223", /tijol|bloco(s)? (de |em )?(betao|cimento|termic|leca|acustic)|\bleca\b/],
  ["OPS46", /\bteto|\btecto/],
  ["OPS29", /pladur|gesso cartonado|placa(s)? de gesso|divisoria/],
  // Revestimentos (consumíveis) antes de cimento, para "cimento-cola"
  ["OP248", /cimento.?cola|cola (para |de )?(ceramic|azulejo|mosaic|porcelan)|argamassa.?cola|betume (de |para )?juntas|rejunt|perfil(is)? (de )?(canto|remate|esquina)/],
  ["OP214", /adjuvante|plastificante|retardador|acelerador de presa|hidrofug/],
  ["OP212", /\bcimento|\bcem (i|ii|iv)\b/],
  ["OP213", /argamassa|reboco|monomassa|\bcal\b|estuque|gesso projetado/],
  ["OP229", /descofrante|cone(s)? (de )?(cofragem|pvc)|tirante(s)? (de )?cofragem|porca(s)? (de )?cofragem|consumive(l|is) (de )?cofragem/],
  ["OP211", /resina|epoxi|selante|espuma (de )?poliuretano|quimico/],
  ["OP210", /\bbetao|\bc ?\d{2}\/\d{2}\b|betonagem/],

  // Agregados
  ["OP227", /\bareia|\bbrita|gravilha|tout.?venant|\bagregado|saibro|po de pedra|enrocamento|\bgodo\b/],

  // Materiais diversos
  ["OP222", /isolamento|\bxps\b|\beps\b|la de rocha|la mineral|la de vidro|poliestireno|aglomerado (de )?cortica|manta acustica/],
  ["OP221", /manilha|caixa(s)? de visita|tampa(s)? (de )?(ferro|saneamento|visita)|ferro fundido|lancil|sumidouro|geotext|tubo(s)? (de )?(drenagem|pead|corrugad)|\bralo/],
  ["OP224", /cofragem|sonotubo/],
  ["OP225", /pedra (natural|de fachada|de revestimento)|granito|marmore|calcario|\blioz\b|moleanos|soleira|peitori/],
  ["OP245", /\btinta|\bprimario|esmalte|verniz|velatura|subcapa/],
  ["OP241", /pro.?rata/],

  // Segurança / EPI / drogaria
  ["OP231", /\bepi\b|capacete|\bluvas?\b|botas?\b|colete (refletor|alta visib)|oculos (de )?protec|protetor(es)? auricular|mascara|arnes|fato de trabalho/],
  ["OP230", /rede(s)? (de )?(seguranca|protecao)|guarda.?corpo(s)? (provisori|de seguranca)|fita (sinalizadora|zebrada|balizadora)|sinalizacao (temporaria|de obra)|cone(s)? de sinalizacao|linha de vida|extintor/],
  ["OP228", /parafuso|\bbucha|\bprego|\bbroca|disco(s)? de corte|fita (adesiva|cola|crepe)|silicone|abracadeira|rebite|\blixa|pincel|\brolo|trincha|\bbalde|colher de pedreiro|serrote|martelo|chave de fendas|drogaria/],
  ["OP322", /berbequim|rebarbadora|aparafusadora|serra (circular|de mesa|tico)|nivel laser|ferramenta/],

  // Energia e fluidos / instalação de obra
  ["OP305", /\bramal|baixada|ligacao (provisoria |de obra )?(de |a |ao )?(agua|eletric|esgoto|rede)/],
  ["OP232", /consumo (de )?(energia|eletricidade)|energia eletrica|\bedp\b/],
  ["OP233", /consumo (de )?agua|\bepal\b|abastecimento de agua/],
  ["OP301", /(montagem|instalacao) (de |do )?(estaleiro|contentor)/],

  // Despesas de funcionamento
  ["OP333", /secretaria|cadeira|mesa de (escritorio|reuni)|armario|frigorifico|micro.?ondas|mobiliario/],
  ["OP400", /papel a4|toner|material de escritorio|caneta|dossier|pasta de arquivo|agrafador/],
  ["OP402", /detergente|lixivia|produto(s)? de limpeza|papel higienico|toalhete|sacos? do lixo/],
  ["OP405", /limpeza (de )?(via|rua|rodoviaria|pneus)|lavagem de rodados|varredora/],
  ["OPS44", /limpeza (final|fina|de fim de obra)/],
  ["OP504", /limpeza (de |do |dos )?(escritorio|estaleiro|contentor)/],
  ["OP505", /vigilancia|seguranca (privada|noturna)|alarme|\bcctv\b/],
  ["OP401", /telemovel|internet|router|telecomunic|\bctt\b|correio/],
  ["OP403", /impressao|plotter|reprografia/],
  ["OP407", /publicidade|tela publicitaria|lona (publicitaria|impressa)|outdoor|painel de obra|placa de obra/],
  ["OP406", /refeic|almoco|jantar/],
  ["OP604", /\bseguro/],
  ["OP611", /caucao|garantia bancaria/],

  // Honorários
  ["OP709", /ensaio|carote|provete|controlo de qualidade|laboratorio/],
  ["OP711", /topograf|levantamento topo|implantacao/],
  ["OP705", /estabilidade|engenharia estrutural|calculo estrutural/],
  ["OP701", /arquitet/],

  // Subempreitadas
  ["OPS05", /amianto/],
  ["OPS04", /demolic/],
  ["OPS06", /carotagem|caroteamento|corte de betao|serragem|furacao/],
  ["OPS02", /\bestaca|micro.?estaca|jet.?grout/],
  ["OPS03", /contencao|parede de berlim|ancoragem/],
  ["OPS01", /escavacao|movimento de terras|terraplanag/],
  ["OPS13", /pressao negativa|cuvelag/],
  ["OPS37", /impermeabiliz|membrana (betuminosa|asfaltica|epdm|pvc)|tela (asfaltica|betuminosa)/],
  ["OPS33", /andaime/],
  ["OPS21", /elevador/],
  ["OPS56", /sprinkler/],
  ["OPS50", /incendio|\bscie\b|carretel/],
  ["OPS32", /\bavac\b|ar condicionado|climatizacao|ventilacao|bomba de calor|\bvrv\b|\bvrf\b/],
  ["OPS48", /canalizac|loica|torneira|autoclismo|base de duche|sanita|lavatorio|\bppr\b|multicamada/],
  ["OPS34", /quadro eletrico|cabo eletrico|tomada|interruptor|luminaria|iluminacao|instalacao eletrica/],
  ["OPS42", /fachada envidracada|fachada cortina|cortina de vidro/],
  ["OPS39", /caixilhari|caixilho|janela|vidro duplo|aluminio/],
  ["OPS49", /porta (de )?(garagem|seccionada|basculante)|portao (de )?garagem/],
  ["OPS52", /serralhari|corrimao|gradeamento|guarda.?corpo|\bportao/],
  ["OPS40", /porta(s)? (interior|de madeira)|roupeiro|rodape|guarnic|carpintaria/],
  ["OPS57", /estore|persiana|blackout/],
  ["OPS54", /soalho|madeira macica|parquet/],
  ["OPS55", /flutuante|\bvinil|laminado|\blvt\b/],
  ["OPS31", /cozinha|bancada|eletrodomestic|placa de inducao|exaustor|\bforno\b/],
  ["OPS24", /betonilha|autonivelante|regularizacao/],
  ["OPS51", /\betics\b|capoto|revestimento de fachada|isolamento termico pelo exterior/],
  ["OPS46", /\bteto|\btecto/],
  ["OPS29", /pladur|gesso cartonado|placa(s)? de gesso|divisoria/],
  ["OPS45", /pintura|papel de parede/],
  ["OPS30", /cobertura|\btelha|caleira|\brufo/],
  ["OPS36", /jardim|relva|\bplantas?\b|\brega\b|terra vegetal|arvore|arbusto/],
  ["OPS53", /sinaletica|numeracao de portas/],
  // Madeira genérica no fim (para "porta de madeira", "soalho" irem para as subempreitadas)
  ["OP203", /\bmadeira\b|\bmdf\b|aglomerado de madeira/],
  ["OP016", /trabalho(s)? temporario|cedencia de pessoal|mao de obra (temporaria|cedida)/],
];

/** Índice do histórico: chave da linha → código mais usado (só códigos ativos). */
export function construirHistorico(purchaseOrders: PurchaseOrder[], ativos: Map<string, CostCategory>): Map<string, string> {
  const contagem = new Map<string, Map<string, number>>();
  for (const po of purchaseOrders) {
    for (const linha of po.line_items ?? []) {
      if (!linha.category_id || !ativos.has(linha.category_id) || !linha.description?.trim()) continue;
      const chave = chaveLinha(linha.item_ref, linha.description);
      const porCodigo = contagem.get(chave) ?? new Map<string, number>();
      porCodigo.set(linha.category_id, (porCodigo.get(linha.category_id) ?? 0) + 1);
      contagem.set(chave, porCodigo);
    }
  }
  const resultado = new Map<string, string>();
  contagem.forEach((porCodigo, chave) => {
    let melhor = "";
    let max = 0;
    porCodigo.forEach((n, id) => {
      if (n > max) {
        max = n;
        melhor = id;
      }
    });
    if (melhor) resultado.set(chave, melhor);
  });
  return resultado;
}

/** Só pelas palavras-chave (útil para testes e para o preçário). */
export function sugerirPorPalavraChave(descricao: string, ativosPorCodigo: Map<string, CostCategory>): CostCategory | undefined {
  const texto = normalizarTexto(descricao);
  if (!texto) return undefined;
  for (const [codigo, regra] of REGRAS) {
    if (regra.test(texto)) {
      const cat = ativosPorCodigo.get(codigo);
      if (cat) return cat;
    }
  }
  return undefined;
}

export function sugerirRubrica(
  linha: { item_ref?: string | null; description: string },
  contexto: {
    ativos: Map<string, CostCategory>; // por id
    ativosPorCodigo: Map<string, CostCategory>; // por código (maiúsculas)
    precoPorChave: Map<string, SupplierPriceItem>; // chave priceItemKey
    chavePreco: (item: { item_ref?: string | null; description: string }) => string;
    historico: Map<string, string>;
  },
): Sugestao | undefined {
  if (!linha.description.trim()) return undefined;

  const doPrecario = contexto.precoPorChave.get(contexto.chavePreco(linha));
  if (doPrecario?.category_id) {
    const cat = contexto.ativos.get(doPrecario.category_id);
    if (cat) return { category: cat, fonte: "preçário" };
  }

  const doHistorico = contexto.historico.get(chaveLinha(linha.item_ref, linha.description));
  if (doHistorico) {
    const cat = contexto.ativos.get(doHistorico);
    if (cat) return { category: cat, fonte: "histórico" };
  }

  const porPalavra = sugerirPorPalavraChave(linha.description, contexto.ativosPorCodigo);
  if (porPalavra) return { category: porPalavra, fonte: "palavra-chave" };

  return undefined;
}
