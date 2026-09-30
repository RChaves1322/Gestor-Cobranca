-- GestorCob — RESET para a nova importação com tabela financeira única.
-- PRESERVA outras_vendas, despesas, tipos e configurações.
-- APAGA clientes, servidores e todo o histórico financeiro mensal.

DROP TABLE IF EXISTS recebimentos CASCADE;
DROP TABLE IF EXISTS cobrancas CASCADE;
DROP TABLE IF EXISTS movimentos_financeiros CASCADE;

CREATE TABLE movimentos_financeiros (
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

CREATE INDEX idx_mov_fin_mes_ref ON movimentos_financeiros(mes_ref);
CREATE INDEX idx_mov_fin_data_pagamento ON movimentos_financeiros(pago_em);
CREATE INDEX idx_mov_fin_vencimento ON movimentos_financeiros(vencimento);
CREATE INDEX idx_mov_fin_status ON movimentos_financeiros(status);
CREATE INDEX idx_mov_fin_cliente ON movimentos_financeiros(cliente_id);
CREATE INDEX idx_mov_fin_servidor ON movimentos_financeiros(servidor);

DELETE FROM clientes;
DELETE FROM servidores;

SELECT 'clientes' AS tabela, COUNT(*) AS registros FROM clientes
UNION ALL SELECT 'servidores', COUNT(*) FROM servidores
UNION ALL SELECT 'movimentos_financeiros', COUNT(*) FROM movimentos_financeiros;
