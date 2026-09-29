-- GestorCob — Schema para Supabase (PostgreSQL)
-- Execute este script no SQL Editor do Supabase

-- Servidores
CREATE TABLE IF NOT EXISTS servidores (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  criado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clientes
CREATE TABLE IF NOT EXISTS clientes (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  celular TEXT,
  servidor TEXT NOT NULL DEFAULT '',
  dia INTEGER NOT NULL DEFAULT 1,
  valor NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ativo',
  obs TEXT DEFAULT '',
  criado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cobranças
CREATE TABLE IF NOT EXISTS cobrancas (
  id TEXT PRIMARY KEY,
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_nome TEXT NOT NULL,
  servidor TEXT,
  valor NUMERIC(10,2) NOT NULL,
  vencimento DATE NOT NULL,
  mes_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  pago_em DATE,
  valor_pago NUMERIC(10,2),
  obs_pagamento TEXT DEFAULT '',
  criado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_cobrancas_mes_ref ON cobrancas(mes_ref);
CREATE INDEX IF NOT EXISTS idx_cobrancas_status ON cobrancas(status);
CREATE INDEX IF NOT EXISTS idx_cobrancas_cliente ON cobrancas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cobrancas_pago_em ON cobrancas(pago_em);
CREATE INDEX IF NOT EXISTS idx_cobrancas_vencimento ON cobrancas(vencimento);

-- Outras Vendas (Receitas)
CREATE TABLE IF NOT EXISTS outras_vendas (
  id TEXT PRIMARY KEY,
  data DATE NOT NULL,
  tipo_rec TEXT NOT NULL,
  cliente TEXT NOT NULL,
  produto TEXT NOT NULL DEFAULT '',
  valor_un NUMERIC(10,2) NOT NULL DEFAULT 0,
  qtde INTEGER NOT NULL DEFAULT 1,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  mes_ref TEXT,
  obs TEXT DEFAULT '',
  criado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Despesas
CREATE TABLE IF NOT EXISTS despesas (
  id TEXT PRIMARY KEY,
  data DATE NOT NULL,
  tipo TEXT NOT NULL,
  responsavel TEXT DEFAULT '',
  descricao TEXT DEFAULT '',
  valor_un NUMERIC(10,2) NOT NULL DEFAULT 0,
  qtde INTEGER NOT NULL DEFAULT 1,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  mes_ref TEXT,
  obs TEXT DEFAULT '',
  criado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tipos de Receita
CREATE TABLE IF NOT EXISTS tipos_receita (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  criado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tipos de Despesa
CREATE TABLE IF NOT EXISTS tipos_despesa (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  criado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Configurações
CREATE TABLE IF NOT EXISTS configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Defaults de configuração
INSERT INTO configuracoes(chave, valor) VALUES
  ('msg_pendente', 'Olá, *{nome}*! 👋

Passando para lembrar que você possui {qtd} parcela(s) com vencimento próximo:

{lista}

💰 *Total: R$ {total}*

Chave Pix: *{pix}*

Qualquer dúvida, estamos à disposição! 😊'),
  ('msg_vencido', 'Olá, *{nome}*! ⚠️

Identificamos {qtd} parcela(s) em *atraso*:

{lista}

💰 *Total em atraso: R$ {total}*

Chave Pix: *{pix}*

Por favor, regularize para evitar suspensão do serviço. 🙏'),
  ('pix', '123456')
ON CONFLICT(chave) DO NOTHING;

-- Desabilitar RLS (acesso via service_role key do backend)
ALTER TABLE servidores DISABLE ROW LEVEL SECURITY;
ALTER TABLE clientes DISABLE ROW LEVEL SECURITY;
ALTER TABLE cobrancas DISABLE ROW LEVEL SECURITY;
ALTER TABLE outras_vendas DISABLE ROW LEVEL SECURITY;
ALTER TABLE despesas DISABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_receita DISABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_despesa DISABLE ROW LEVEL SECURITY;
ALTER TABLE configuracoes DISABLE ROW LEVEL SECURITY;
