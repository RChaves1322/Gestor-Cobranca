-- GestorCob - preparação para nova importação
-- Execute no Supabase SQL Editor.
-- Este script apaga SOMENTE os dados de clientes/cobranças/recebimentos/servidores.
-- Outras vendas, despesas e configurações são preservadas.

CREATE TABLE IF NOT EXISTS recebimentos (
  id TEXT PRIMARY KEY,
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cliente_nome TEXT NOT NULL,
  servidor TEXT,
  data_recebimento DATE,
  mes_ref TEXT,
  valor_original NUMERIC(10,2) NOT NULL DEFAULT 0,
  desconto NUMERIC(10,2) NOT NULL DEFAULT 0,
  valor_recebido NUMERIC(10,2) NOT NULL DEFAULT 0,
  descricao TEXT DEFAULT '',
  pontos INTEGER NOT NULL DEFAULT 0,
  bloco_origem INTEGER NOT NULL DEFAULT 0,
  origem TEXT NOT NULL DEFAULT 'importacao_historico',
  criado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recebimentos_mes_ref ON recebimentos(mes_ref);
CREATE INDEX IF NOT EXISTS idx_recebimentos_data ON recebimentos(data_recebimento);
CREATE INDEX IF NOT EXISTS idx_recebimentos_cliente ON recebimentos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_recebimentos_servidor ON recebimentos(servidor);

DELETE FROM recebimentos;
DELETE FROM cobrancas;
DELETE FROM clientes;
DELETE FROM servidores;

SELECT 'clientes' AS tabela, COUNT(*) AS registros FROM clientes
UNION ALL SELECT 'cobrancas', COUNT(*) FROM cobrancas
UNION ALL SELECT 'recebimentos', COUNT(*) FROM recebimentos
UNION ALL SELECT 'servidores', COUNT(*) FROM servidores;
