-- Auditoria rápida após a importação do histórico IPTV.
-- Esperado na fonte atual: 1.485 recebimentos e R$ 44.194,00 recebidos.

SELECT
  COUNT(*) AS total_recebimentos,
  COALESCE(SUM(valor_pago),0) AS total_recebido
FROM public.movimentos_financeiros
WHERE status = 'pago'
  AND valor_pago IS NOT NULL;

SELECT
  mes_ref,
  COUNT(*) AS recebimentos,
  COALESCE(SUM(valor_pago),0) AS recebido,
  COUNT(DISTINCT cliente_id) AS clientes
FROM public.movimentos_financeiros
WHERE status = 'pago'
  AND valor_pago IS NOT NULL
GROUP BY mes_ref
ORDER BY mes_ref;

SELECT
  status,
  COUNT(*) AS total
FROM public.clientes
GROUP BY status
ORDER BY status;
