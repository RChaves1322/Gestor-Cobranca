-- GestorCob — Schema para Supabase (PostgreSQL)
-- Modelo financeiro unificado:
-- uma única tabela guarda tanto cobranças quanto pagamentos.

CREATE TABLE IF NOT EXISTS servidores (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  criado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- Tabela financeira única.
-- Uma linha representa uma obrigação mensal e, quando paga, o próprio registro
-- passa a guardar a data/valor efetivamente recebidos.
-- Não existe UNIQUE(cliente_id, mes_ref), pois o histórico legado pode ter
-- mais de um recebimento no mesmo mês.
CREATE TABLE IF NOT EXISTS movimentos_financeiros (
  id TEXT PRIMARY KEY,
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_nome TEXT NOT NULL,
  servidor TEXT,
  tipo_movimento TEXT NOT NULL DEFAULT 'mensalidade',
  valor NUMERIC(10,2) NOT NULL DEFAULT 0,
  vencimento DATE,
  mes_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  pago_em DATE,
  valor_pago NUMERIC(10,2),
  desconto NUMERIC(10,2) NOT NULL DEFAULT 0,
  obs_pagamento TEXT DEFAULT '',
  pontos INTEGER NOT NULL DEFAULT 0,
  bloco_origem INTEGER NOT NULL DEFAULT 0,
  origem TEXT NOT NULL DEFAULT 'sistema',
  criado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mov_fin_mes_ref ON movimentos_financeiros(mes_ref);
CREATE INDEX IF NOT EXISTS idx_mov_fin_data_pagamento ON movimentos_financeiros(pago_em);
CREATE INDEX IF NOT EXISTS idx_mov_fin_vencimento ON movimentos_financeiros(vencimento);
CREATE INDEX IF NOT EXISTS idx_mov_fin_status ON movimentos_financeiros(status);
CREATE INDEX IF NOT EXISTS idx_mov_fin_cliente ON movimentos_financeiros(cliente_id);
CREATE INDEX IF NOT EXISTS idx_mov_fin_servidor ON movimentos_financeiros(servidor);

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

CREATE TABLE IF NOT EXISTS tipos_receita (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  criado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tipos_despesa (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  criado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

INSERT INTO configuracoes(chave, valor) VALUES
  ('msg_pendente', 'Olá, *{nome}*! 👋\n\nPassando para lembrar que você possui {qtd} parcela(s) com vencimento próximo:\n\n{lista}\n\n💰 *Total: R$ {total}*\n\nChave Pix: *{pix}*\n\nQualquer dúvida, estamos à disposição! 😊'),
  ('msg_vencido', 'Olá, *{nome}*! ⚠️\n\nIdentificamos {qtd} parcela(s) em *atraso*:\n\n{lista}\n\n💰 *Total em atraso: R$ {total}*\n\nChave Pix: *{pix}*\n\nPor favor, regularize para evitar suspensão do serviço. 🙏'),
  ('pix', '123456')
ON CONFLICT(chave) DO NOTHING;

ALTER TABLE servidores DISABLE ROW LEVEL SECURITY;
ALTER TABLE clientes DISABLE ROW LEVEL SECURITY;
ALTER TABLE movimentos_financeiros DISABLE ROW LEVEL SECURITY;
ALTER TABLE outras_vendas DISABLE ROW LEVEL SECURITY;
ALTER TABLE despesas DISABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_receita DISABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_despesa DISABLE ROW LEVEL SECURITY;
ALTER TABLE configuracoes DISABLE ROW LEVEL SECURITY;
