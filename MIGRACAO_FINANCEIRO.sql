-- Rode UMA VEZ no SQL Editor do Supabase antes de usar o rateio de despesas.
-- Permite informar quantos meses uma despesa cobre (ex.: renovação de 3 meses).
ALTER TABLE public.despesas
  ADD COLUMN IF NOT EXISTS meses_cobertos integer NOT NULL DEFAULT 1;

-- Conferência: como o campo "Responsável / Servidor" está preenchido hoje.
-- Para a Margem por servidor, o nome precisa ser igual ao do servidor (GF, Slim, UniTV...).
SELECT responsavel, COUNT(*) AS lancamentos, SUM(total) AS total
FROM public.despesas
GROUP BY responsavel
ORDER BY total DESC;
