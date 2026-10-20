<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Locatto

Sistema de gestão de aluguéis (residenciais e comerciais) em pt-BR: cadastro de imóveis, contratos com geração de PDF, controle de pagamentos e notificações por e-mail.

Stack: React + Vite + Tailwind no front-end, Express + Prisma (Postgres/Neon) no back-end, autenticação e armazenamento de arquivos via Firebase.

## Pré-requisitos

- Node.js 18+
- Yarn (gerenciador de pacotes do projeto — veja `packageManager` no `package.json`)
- Uma connection string de um banco Postgres (recomendado: [Neon](https://neon.tech))

## Rodando localmente

1. Instale as dependências:
   ```
   yarn install
   ```
2. Copie `.env.example` para `.env` e preencha as variáveis (veja a seção abaixo).
3. Gere o Prisma Client:
   ```
   npx prisma generate
   ```
4. Rode o app (Express + Vite em modo middleware, porta 9999):
   ```
   yarn dev
   ```

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `DATABASE_URL` | Connection string do Postgres (Neon) |
| `SETTINGS_ENCRYPTION_KEY` | Chave usada para criptografar a senha SMTP salva no banco |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Envio de e-mails (contratos, lembretes, boas-vindas) |
| `APP_URL` | URL pública do app, usada em links de e-mail |

`GEMINI_API_KEY` no `.env.example` é resíduo do template original (AI Studio) e não é usado pelo código atual — pode ser ignorado.

O login (Google) e o upload de arquivos assinados de contrato usam Firebase, configurado em `firebase-applet-config.json` (config pública do client, não é segredo).

## Scripts

| Comando | Descrição |
|---|---|
| `yarn dev` | Sobe o servidor de desenvolvimento (`server.ts` via `tsx`) |
| `yarn build` | Build de produção (`vite build`) |
| `yarn preview` | Preview do build de produção |
| `yarn lint` | Type-check (`tsc --noEmit`), sem ESLint |
| `yarn clean` | Remove `dist/` |
| `npx prisma studio` | GUI para inspecionar/editar os dados no Postgres |
| `npx prisma generate` | Regenera o Prisma Client após alterar `prisma/schema.prisma` |

Não há suite de testes configurada neste repositório.

## Banco de dados e migrations

O Prisma se conecta ao Neon via `@prisma/adapter-neon` (HTTPS/WebSocket, porta 443) em vez da conexão TCP padrão (porta 5432) — necessário porque a rede de desenvolvimento usada aqui bloqueia a porta 5432 para saída, mas essa é também a forma recomendada pela Neon para ambientes serverless.

Por isso, comandos do Prisma CLI que precisam de conexão direta ao banco (`migrate dev`, `migrate resolve`, `db pull`) **não funcionam** nessa rede. Para aplicar uma mudança de schema:

1. Gere a migration manualmente com `prisma migrate diff` (não precisa de conexão com o banco).
2. Aplique o SQL gerado colando no SQL Editor do console da Neon, ou rodando via `prisma.$executeRawUnsafe(sql)` em um script avulso que importe `src/server/prisma.ts` (usa a mesma conexão HTTPS do app).
3. Rode `npx prisma generate` para atualizar os tipos do client.

Detalhes completos da arquitetura (auth, rotas, serialização, etc.) estão em [CLAUDE.md](CLAUDE.md).

## Deploy (Vercel)

O projeto já está configurado para rodar na Vercel:

- `vercel.json` define o build (`yarn build` → `dist/`) e reescreve `/api/*` para a function serverless em `api/index.ts`, que reaproveita o mesmo Express app usado em desenvolvimento (`src/server/app.ts`).
- Configure as variáveis de ambiente listadas acima em **Project Settings → Environment Variables** (Production e Preview).
- Se o login com Google não funcionar após o deploy, adicione o domínio do deploy em **Firebase Console → Authentication → Settings → Authorized domains**.
