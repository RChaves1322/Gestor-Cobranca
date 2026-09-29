# GestorCob — Deploy Vercel + Supabase

## Passo 1 — Criar o banco no Supabase

1. Acesse [supabase.com](https://supabase.com) e crie um projeto novo
2. Vá em **SQL Editor** e cole todo o conteúdo do arquivo `supabase-schema.sql`
3. Clique em **Run** para criar todas as tabelas

## Passo 2 — Pegar as credenciais do Supabase

Em **Settings → API** copie:
- **Project URL** → será o `SUPABASE_URL`
- **service_role** secret → será o `SUPABASE_SERVICE_KEY` ⚠️ (nunca exponha esta chave no frontend)

## Passo 3 — Deploy na Vercel

1. Instale a CLI da Vercel: `npm i -g vercel`
2. Na pasta do projeto, rode: `vercel`
3. Siga o assistente (aceite os defaults)
4. Adicione as variáveis de ambiente:
   ```
   vercel env add SUPABASE_URL
   vercel env add SUPABASE_SERVICE_KEY
   ```
5. Faça o deploy final: `vercel --prod`

**OU** pela interface web:
1. Suba este projeto no GitHub
2. Em [vercel.com](https://vercel.com) → New Project → importe o repositório
3. Em **Environment Variables** adicione `SUPABASE_URL` e `SUPABASE_SERVICE_KEY`
4. Clique em Deploy

## Estrutura do projeto

```
gestorcob-vercel/
├── api/
│   └── index.js          ← Toda a API (roda como serverless na Vercel)
├── public/
│   └── index.html        ← Frontend (sem alterações)
├── supabase-schema.sql   ← Execute no Supabase antes de tudo
├── .env.example          ← Modelo das variáveis de ambiente
├── vercel.json           ← Configuração de roteamento
└── package.json
```
