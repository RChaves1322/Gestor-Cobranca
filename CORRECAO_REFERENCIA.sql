-- Conferência após REIMPORTAR a planilha com "Ano de referência" = 2026.
-- Rode no SQL Editor do Supabase. Nada aqui altera dados (somente SELECT).

-- 1) Quantos registros por origem (os novos ficam como 'importacao_planilha').
SELECT origem, COUNT(*) AS qtd, SUM(valor_pago) AS recebido
FROM public.movimentos_financeiros
GROUP BY origem ORDER BY origem;

-- 2) Sobras das importações antigas que NÃO foram substituídas
--    (ex.: registros de uma planilha de 2025). Se aparecer algo de 2026 aqui,
--    me avise antes de apagar.
SELECT cliente_nome, mes_ref, pago_em, valor_pago, bloco_origem, origem
FROM public.movimentos_financeiros
WHERE origem IN ('importacao_historico','importacao_complementar_2026')
ORDER BY cliente_nome, pago_em;

-- 3) Duplicidade: mais de uma mensalidade ativa no mesmo mês para o mesmo cliente.
SELECT cliente_nome, mes_ref, COUNT(*) AS qtd, STRING_AGG(status || '/' || COALESCE(origem,''), ', ') AS detalhes
FROM public.movimentos_financeiros
WHERE status <> 'cancelado'
GROUP BY cliente_id, cliente_nome, mes_ref
HAVING COUNT(*) > 1
ORDER BY cliente_nome, mes_ref;

-- 4) Recebido por mês de referência (competência) — 2026.
SELECT mes_ref, COUNT(*) AS meses_pagos, SUM(valor_pago) AS recebido
FROM public.movimentos_financeiros
WHERE status = 'pago' AND mes_ref LIKE '2026-%'
GROUP BY mes_ref ORDER BY mes_ref;
