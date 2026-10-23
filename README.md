# Studio Mariana

Landing page premium e sistema demonstrativo de agendamento para um salão fictício. O frontend é estático e sem framework; as reservas são validadas por Vercel Functions e persistidas no Supabase PostgreSQL. O projeto **não representa um estabelecimento real**.

## Stack e arquitetura

- HTML5 semântico, CSS mobile-first e JavaScript ES Modules.
- Vercel Functions em Node.js 20.
- `@supabase/supabase-js` apenas no servidor.
- PostgreSQL/Supabase com RLS, funções privilegiadas restritas, rate limit persistente e `EXCLUDE USING gist` para impedir sobreposição.
- Uma profissional, agenda de segunda a sábado, 09:00–12:00 e 13:00–18:00, em `America/Sao_Paulo`.

O navegador acessa somente `/api/services`, `/api/availability` e `/api/appointments`. A chave secreta nunca é enviada ao frontend. A API calcula duração, preço e término com dados do banco. A confirmação usa uma única função SQL e a constraint do PostgreSQL decide disputas simultâneas.

## Estrutura

```text
api/                  Vercel Functions
assets/               favicon e imagens editoriais otimizadas
css/style.css         identidade visual e responsividade
js/                   navegação e fluxo de agendamento
lib/                  cliente Supabase, HTTP e regras de agenda
supabase/migrations/  schema versionado e dados iniciais
tests/                testes locais e integração opcional
index.html             landing page
vercel.json            cabeçalhos de segurança
```

## Instalação e execução local

Requisitos: Node.js 20+ e uma conta Supabase.

```bash
npm install
cp .env.example .env.local
npx vercel dev
```

No PowerShell, copie o ambiente com `Copy-Item .env.example .env.local`. O `vercel dev` serve a landing page e as Functions juntas (normalmente em `http://localhost:3000`). Abrir `index.html` diretamente exibe a página, mas não executa `/api`.

Sem credenciais válidas, a landing continua visível, mas o painel explica que o agendamento não foi configurado e não permite confirmar. Não há fallback de horários falsos.

## Configuração do Supabase

1. Crie um projeto novo no [Supabase](https://supabase.com/dashboard).
2. Abra **SQL Editor**, cole todo o conteúdo de `supabase/migrations/001_initial_schema.sql` e execute uma vez.
3. Nas configurações da API/Data API, adicione `app_private` à lista de **Exposed schemas**. Isso é necessário para o PostgREST localizar as RPCs; não concede acesso por si só, pois a migração mantém `USAGE` e `EXECUTE` exclusivos de `service_role`.
4. Em **Project Settings → API**, copie a URL do projeto e uma chave secreta (`sb_secret_...`).
5. Preencha localmente, sem commit:

```dotenv
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

A chave secreta moderna é preferível. Projetos antigos podem usar a chave JWT `service_role`; nesse caso, coloque-a em `SUPABASE_SECRET_KEY`. Ambas têm privilégios elevados e devem existir **somente** em variáveis do servidor. Nunca use a chave `anon` como substituta nem prefixe a variável com `VITE_`, `NEXT_PUBLIC_` ou equivalente.

### O que a migração protege

- RLS é ativado e forçado em `services`, `appointments` e `app_private.rate_limits`.
- `anon` e `authenticated` não recebem leitura nem escrita direta.
- Nome e telefone não podem ser consultados por visitantes no Supabase.
- As RPCs ficam em `app_private`; somente `service_role` recebe `USAGE` no schema e `EXECUTE` nas funções.
- As funções usam `SECURITY INVOKER`, `search_path` restrito a `pg_catalog` e referências qualificadas. Não há elevação de privilégio via `SECURITY DEFINER`.
- `app_private.rate_limits` mantém contadores compartilhados entre instâncias serverless e remove registros sem atividade há mais de sete dias.
- A exclusão GiST usa intervalos `[início, fim)`: reservas consecutivas são válidas, sobrepostas não.
- Reservas `cancelled` deixam de bloquear a agenda.
- O limite de 30 dias usa a data civil em `America/Sao_Paulo`, inclusive o 30º dia, além da antecedência mínima de uma hora.

Se o schema for alterado no futuro, crie uma nova migração numerada; não edite uma migração já aplicada em produção.

## APIs

Com o ambiente local em execução:

```bash
curl http://localhost:3000/api/services
curl "http://localhost:3000/api/availability?serviceId=corte-feminino&date=2026-10-24"
curl -X POST http://localhost:3000/api/appointments \
  -H "Content-Type: application/json" \
  -d '{"serviceId":"corte-feminino","date":"2026-10-24","time":"10:00","customerName":"Maria Teste","customerPhone":"11999999999"}'
```

Use uma data futura dentro de 30 dias. Respostas podem ser: `201` (criada), `400` (entrada/regra inválida), `404` (serviço inexistente ou inativo), `409` (conflito), `429` (limite excedido), `500` (falha interna) ou `503` (ambiente ainda não configurado). Mensagens do PostgreSQL não são repassadas ao visitante.

## Testes

Testes locais não dependem do Supabase:

```bash
npm test
```

Eles cobrem agendamento válido, data passada, domingo, abertura, almoço, cruzamento do almoço, fechamento, intervalos de 15 minutos, sobreposição com início igual ou diferente, horários consecutivos, cancelamento, limite de 30 dias e payload inválido/excessivo.

Os testes de integração ficam automaticamente ignorados sem credenciais. Para executá-los em um projeto **descartável** com a migração aplicada:

```bash
npm run test:integration
```

Eles validam serviço inexistente/inativo, duas requisições simultâneas disputando o mesmo horário e bloqueio de dados pessoais. Para o teste de cliente público, defina também `SUPABASE_ANON_KEY`. Para validar um serviço inativo sem ampliar os privilégios da aplicação, crie esse registro pelo SQL Editor em um projeto descartável e informe seu ID em `SUPABASE_INACTIVE_TEST_SERVICE_ID`. O teste de concorrência cria um registro marcado como teste; não execute contra uma agenda comercial.

## Deploy na Vercel

1. Importe o repositório na Vercel (Framework Preset: **Other**).
2. Não configure build command; a raiz pública contém `index.html`.
3. Em **Settings → Environment Variables**, adicione `SUPABASE_URL` e `SUPABASE_SECRET_KEY` para Production e Preview conforme necessário.
4. Faça o deploy e teste os três endpoints no domínio final.
5. Confira os logs sem registrar payloads ou dados pessoais.

## Ver reservas no Supabase

Use o Table Editor → `appointments` somente com uma conta administrativa do projeto. Para cancelar uma reserva de teste, altere `status` para `cancelled`; isso libera o intervalo. Não ofereça acesso ao painel Supabase a clientes finais.

## Limitações demonstrativas

- Não há autenticação de cliente, painel administrativo, reagendamento ou cancelamento público.
- Não há pagamentos, confirmação por WhatsApp/e-mail, feriados, folgas ou múltiplas profissionais.
- O rate limit por IP reduz abuso básico, mas não substitui WAF, CAPTCHA adaptativo e monitoramento.
- Telefone é armazenado para demonstrar persistência; uma operação real exige política de privacidade, base legal, retenção e fluxo de exclusão compatíveis com a LGPD.
- Imagens, preços, marca e dados comerciais são fictícios. As imagens foram geradas para este projeto e os JPGs otimizados são os arquivos usados pela página.

## Checklist antes de qualquer uso comercial

- [ ] Revisar ameaça, LGPD, política de privacidade e prazo de retenção com responsáveis qualificados.
- [ ] Adotar chave secreta dedicada/rotacionável e revisar privilégios no banco.
- [ ] Configurar CAPTCHA ou desafio progressivo, WAF, observabilidade e alertas.
- [ ] Criar autenticação e autorização forte para administração/cancelamento.
- [ ] Implementar confirmação de contato, política de faltas e consentimentos reais.
- [ ] Modelar profissionais, indisponibilidades, feriados e alterações de horário.
- [ ] Fazer testes de carga, concorrência, restauração de backup e segurança.
- [ ] Substituir todo conteúdo fictício por informações verificadas.

Esta entrega é apropriada para portfólio e demonstração técnica; não deve ser apresentada como sistema pronto para operação comercial sem as etapas acima.
