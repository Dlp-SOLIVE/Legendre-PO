# Legendre — Sistema de Compras (Adjudicações)

Aplicação interna da Solive / Legendre para lançar, aprovar, enviar e acompanhar adjudicações (purchase orders) das obras em Portugal: fornecedores, preçários, guias de transporte, faturas, accruals e refaturação ao consórcio.

- Produção: https://legendre-pt-adj.netlify.app/
- Repositório: `Dlp-SOLIVE/Legendre-PO` (ramo `main` → deploy automático no Netlify)

## Tecnologia

- Vite + React + TypeScript (`strict`); o build corre `tsc -b && vite build` — erros de **tipos** fazem falhar o deploy.
- Supabase: autenticação, base de dados (Postgres com regras de acesso RLS) e ficheiros (buckets privados `anexos` e `assinaturas`).
- Netlify: build `npm run build`, pasta `dist`. Variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no ambiente do Netlify (nunca a service role key).

## Papéis e acessos

- **Administrador**: aprova utilizadores, atribui obras, gere obras/categorias/definições e vê todas as obras.
- **Utilizador**: cria fornecedores e adjudicações nas obras que lhe foram atribuídas.
- **Limite de autoridade** (com IVA): acima do limite, a adjudicação é submetida a um aprovador com limite suficiente e acesso à obra.
- O estado de uma adjudicação só muda através das funções da base de dados `validate_purchase_order`, `submit_for_approval` e `decide_approval` (há uma regra na tabela que o garante). Adjudicações validadas são revistas com `revise_purchase_order` (Rev. 1, Rev. 2…, com histórico).

## Numeração

Gerada na base de dados por trigger (sem duplicados), a partir do centro de custo da obra, do código do fornecedor e das iniciais de quem pede.

## Fluxo de alterações

1. SQL primeiro (Supabase → SQL Editor), se a alteração tiver base de dados.
2. Commit no GitHub (ramo `main`).
3. Confirmar no Netlify que o deploy fica **Published**; se falhar, ver o log («Why did it fail»).
4. Abrir o site com Ctrl+Shift+R.

## Migrações

As migrações em `supabase/migrations` cobrem o esquema inicial. Alterações posteriores (aprovações, guias/faturas, accruals, preçários, revisões) foram aplicadas diretamente no Supabase; os ficheiros SQL de cada fase devem ser acrescentados a esta pasta para manter o histórico completo.
