import { createClient } from '@supabase/supabase-js';

// Cliente ADMIN: usado somente para dados do sistema.
// persistSession=false evita que um login de usuário substitua o
// Authorization do cliente com o JWT do usuário e faça as consultas
// de dados deixarem de usar a chave secreta.
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

// Cliente separado para autenticação. Use a chave publicável/anon aqui.
// Nunca use SUPABASE_SERVICE_KEY/SUPABASE_SECRET_KEY no navegador.
const authKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;
const sbAuth = createClient(
  process.env.SUPABASE_URL,
  authKey,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

// ── Helpers ──────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
function pad(n) { return String(n).padStart(2,'0'); }
function diasNoMes(m,a) { return new Date(a,m,0).getDate(); }
function fmtData(s) { if(!s) return ''; const [a,m,d]=s.split('-'); return `${d}/${m}/${a}`; }
function fmtValor(v) { return parseFloat(v||0).toFixed(2).replace('.',','); }

function normalizarServidor(s) {
  if (!s) return s;
  const t = s.trim();
  const mapa = {
    'gf':'GF','GF':'GF','now':'NOW','NOW':'NOW',
    'slim':'Slim','SLIM':'Slim','club':'Club','CLUB':'Club',
    'unitv':'UniTV','UNITV':'UniTV','UniTV':'UniTV',
    'prime':'Prime','PRIME':'Prime','ultra':'Ultra','ULTRA':'Ultra',
  };
  return mapa[t] || mapa[t.toLowerCase()] || t;
}

async function marcarVencidos() {
  const hoje = new Date().toISOString().slice(0,10);
  await sb.from('movimentos_financeiros')
    .update({ status: 'vencido' })
    .eq('status','pendente')
    .lt('vencimento', hoje);
}

function err(res, msg, code=400) {
  return res.status(code).json({ erro: msg });
}

// Supabase/PostgREST pode limitar uma consulta a 1.000 registros.
// Para relatórios e auditorias precisamos buscar todos os registros em páginas.
async function selectAll(table, columns='*', configure=null, pageSize=1000) {
  const all=[];
  for(let from=0;;from+=pageSize){
    let q=sb.from(table).select(columns);
    if(configure) q=configure(q);
    const {data,error}=await q.range(from, from+pageSize-1);
    if(error) return {data:null,error};
    all.push(...(data||[]));
    if(!data || data.length < pageSize) break;
  }
  return {data:all,error:null};
}

// Grava despesas com "meses_cobertos". Se a coluna ainda não existir no
// Supabase (migração não rodada), grava sem ela para não quebrar nada.
async function gravarDespesa(op, row, id){
  const exec = r => op==='insert'
    ? sb.from('despesas').insert(r).select().single()
    : sb.from('despesas').update(r).eq('id',id).select().single();
  let { data, error } = await exec(row);
  if (error && /meses_cobertos/.test(error.message||'')) {
    const { meses_cobertos, ...semColuna } = row;
    ({ data, error } = await exec(semColuna));
  }
  return { data, error };
}
// Apelidos: nomes de clientes que foram juntados a outro. A importação usa
// isso para mandar os pagamentos para o cliente certo. Tolerante: se a tabela
// ainda não existir, simplesmente não há apelidos.
async function carregarApelidos(nomes){
  const out={};
  try{
    for(let i=0;i<nomes.length;i+=100){
      const { data, error } = await sb.from('clientes_apelidos').select('nome,cliente_id').in('nome',nomes.slice(i,i+100));
      if(error) return out;
      (data||[]).forEach(r=>{ out[r.nome]=r.cliente_id; });
    }
  }catch{}
  return out;
}
function mesesCobertos(v){ const n=parseInt(v,10); return Number.isInteger(n)&&n>=1&&n<=36 ? n : 1; }
function somarMeses(mr, n){ const [a,m]=mr.split('-').map(Number); const d=new Date(a, m-1+n, 1); return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; }

// ── Extrato bancário (OFX) ───────────────────────────────────
function semAcento(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
const PALAVRAS_VAZIAS=new Set(['DE','DA','DO','DAS','DOS','E','LTDA','ME','SA','S','A','EPP','EIRELI']);
function tokensNome(n){
  return [...new Set(semAcento(n).toUpperCase().replace(/[^A-Z ]/g,' ').split(/\s+/)
    .filter(t=>t.length>=3 && !PALAVRAS_VAZIAS.has(t)))];
}
function lerOFX(txt){
  const tag=(b,k)=>{ const m=b.match(new RegExp(`<${k}>([^<\\r\\n]*)`,'i')); return m?m[1].trim():''; };
  const blocos=txt.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi)||[];
  const org=tag(txt,'ORG');
  const banco=/NU PAGAMENTOS/i.test(org)?'Nubank':(org||'banco');
  const out=blocos.map(b=>{
    const memo=tag(b,'MEMO')||tag(b,'NAME');
    const dt=tag(b,'DTPOSTED');
    const valor=parseFloat(tag(b,'TRNAMT').replace(',','.'))||0;
    // Formato Nubank: "Transferência recebida pelo Pix - NOME - •••.123.456-•• - BANCO ..."
    const partes=memo.split(' - ').map(x=>x.trim());
    let nome='', documento='';
    if (partes.length>=2) {
      nome=partes[1];
      const doc=(partes[2]||'').match(/[\d.\/-]{6,}/);
      if (doc && /[\d]/.test(partes[2])) documento=doc[0].replace(/^[.\-]+|[.\-]+$/g,'');
      // CNPJ costuma vir grudado no nome ("56.909.954 KARINE SANTOS")
      nome=nome.replace(/^[\d.\/-]+\s+/,'');
    }
    const investimento=/aplica[cç][aã]o|resgate|RDB|CDB|poupan/i.test(memo) && !nome;
    const chave = nome ? `${semAcento(nome).toUpperCase().replace(/\s+/g,' ')}|${documento}` : `MEMO|${semAcento(partes[0]).toUpperCase()}`;
    return { fitid:tag(b,'FITID') || `${dt}|${valor}|${memo}`, data:`${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}`,
      valor, memo, nome, documento, chave, investimento, banco, descricao:partes[0] };
  });
  out.conta=tag(txt,'ACCTID'); out.periodo={ de:tag(txt,'DTSTART').slice(0,8), ate:tag(txt,'DTEND').slice(0,8) };
  return out;
}
// Dá baixa de um PIX (ou parte dele) nos meses escolhidos de um cliente
async function pagarClienteExtrato(clienteId, mesesSel, valor, data, it, dividido){
    const { data:c } = await sb.from('clientes').select('*').eq('id',clienteId).single();
    if (!c) throw new Error('cliente não encontrado');
    const meses=(mesesSel||[]).filter(Boolean);
    if (!meses.length) throw new Error('nenhum mês escolhido');
    const parte=Number((valor/meses.length).toFixed(2));
    const { data:exist } = await sb.from('movimentos_financeiros').select('*').eq('cliente_id',c.id).in('mes_ref',meses).neq('status','cancelado');
    const ids=[];
    for (const [i,mr] of meses.entries()) {
      const vp = i===meses.length-1 ? Number((valor-parte*(meses.length-1)).toFixed(2)) : parte;
      const ex=(exist||[]).find(m=>m.mes_ref===mr && m.status!=='pago');
      const obs=`Extrato ${it.banco||'banco'} – ${it.nome||''}${dividido?' (PIX dividido)':''}`.trim();
      if (ex) {
        const { error } = await sb.from('movimentos_financeiros').update({
          status:'pago', pago_em:data, valor_pago:vp, desconto:Math.max(0,Number(ex.valor||0)-vp),
          obs_pagamento:obs, origem:ex.origem||'extrato' }).eq('id',ex.id);
        if (error) throw error; ids.push(ex.id);
      } else {
        const jaPago=(exist||[]).some(m=>m.mes_ref===mr && m.status==='pago');
        const [a,mm]=mr.split('-').map(Number);
        const dia=Math.min(parseInt(c.dia)||1, diasNoMes(mm,a));
        const idFixo=`mov_${c.id}_${a}${pad(mm)}`;
        const id = jaPago ? uid()+'ext' : idFixo;
        const { error } = await sb.from('movimentos_financeiros').upsert({
          id, cliente_id:c.id, cliente_nome:c.nome, servidor:c.servidor||'', valor:Math.max(Number(c.valor||0),vp),
          vencimento:`${mr}-${pad(dia)}`, mes_ref:mr, status:'pago', pago_em:data, valor_pago:vp,
          desconto:Math.max(0,Number(c.valor||0)-vp), obs_pagamento:obs, tipo_movimento:'mensalidade',
          origem:'extrato', criado:new Date().toISOString() },{ onConflict:'id' });
        if (error) throw error; ids.push(id);
      }
    }
  return ids;
}

// ── Lembretes ──────────────────────────────────────────────
// Dia de cobrança só é guardado quando diferente do vencimento da lista
function diaCobrancaOuNull(v, dia){ const n=parseInt(v); if(!(n>=1&&n<=31)) return null; return n===parseInt(dia)?null:n; }
function hojeBR(){ return new Date(Date.now()-3*3600*1000).toISOString().slice(0,10); } // horário de Brasília
function primeiroNome(n){ const t=String(n||'').replace(/^\S*\d\S*\s*-\s*/,'').trim().split(/\s+/)[0]||n; return t.charAt(0).toUpperCase()+t.slice(1).toLowerCase(); }
function nomeMes(mr){ const [a,m]=mr.split('-'); return ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'][parseInt(m)-1]+'/'+a; }
const MSG_LEMBRETE_PADRAO={
  mesma_antes:   'Olá {nome}! Passando para lembrar que sua mensalidade de {mes} (R$ {valor}) vence em {vencimento}.\n\nPix: {pix}\n\nQualquer dúvida estou à disposição!',
  mesma_dia:     'Olá {nome}! Sua mensalidade de {mes} (R$ {valor}) vence hoje, {vencimento}.\n\nPix: {pix}\n\nSe já pagou, pode desconsiderar. Obrigado!',
  mesma_atraso2: 'Olá {nome}! Não identifiquei ainda o pagamento da mensalidade de {mes} (R$ {valor}), que venceu em {vencimento}.\n\nPix: {pix}\n\nSe já pagou, me envia o comprovante por favor. Obrigado!',
  dif_cobranca:  'Olá {nome}! Hoje, {cobranca}, é o dia do pagamento da sua mensalidade de {mes} (R$ {valor}).\n\nPix: {pix}\n\nObrigado!',
  dif_atraso2:   'Olá {nome}! Ainda não identifiquei o pagamento da mensalidade de {mes} (R$ {valor}), combinado para {cobranca}.\n\nPix: {pix}\n\nSe já pagou, me envia o comprovante por favor.',
  dif_atraso5:   'Olá {nome}! A mensalidade de {mes} (R$ {valor}) está em aberto há {dias} dias (pagamento combinado para {cobranca}).\n\nPix: {pix}\n\nPor favor, regularize para evitar a suspensão do acesso. Obrigado!'
};

// Lê uma tabela que pode ainda não existir (migração não rodada)
async function tabelaOpcional(t, cols, qf){
  const r=await selectAll(t, cols, qf);
  if (r.error) return { data:[], faltaTabela:/does not exist|relation|schema cache/i.test(r.error.message||'') , error:r.error };
  return { data:r.data||[] };
}

// ── Router manual (sem express, roda como serverless) ────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url  = req.url.replace(/^\/api/,'').split('?')[0];
  const params = Object.fromEntries(new URL(req.url, 'http://x').searchParams);

  // Parse do corpo ANTES das rotas de autenticação.
  // O login/refresh também precisam acessar `body`; deixar a declaração
  // depois dessas rotas causava ReferenceError e a Vercel devolvia
  // uma resposta de erro em texto, quebrando o JSON no frontend.
  let body = {};
  if (['POST','PUT','PATCH'].includes(req.method)) {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}; } catch { body = {}; }
  }

  // ─── AUTENTICAÇÃO ───────────────────────────────────────────
  // As credenciais de serviço permanecem somente no backend.
  // O navegador recebe um access token do Supabase e o envia via Bearer.
  if (url === '/auth/login' && req.method === 'POST') {
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    if (!email || !password) return err(res, 'E-mail e senha são obrigatórios', 400);
    const { data, error } = await sbAuth.auth.signInWithPassword({ email, password });
    if (error || !data?.session) return err(res, 'E-mail ou senha inválidos', 401);
    return res.json({
      user: data.user,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at
    });
  }
  if (url === '/auth/refresh' && req.method === 'POST') {
    const refresh_token = String(body.refresh_token || '');
    if (!refresh_token) return err(res, 'Sessão inválida', 401);
    const { data, error } = await sbAuth.auth.refreshSession({ refresh_token });
    if (error || !data?.session) return err(res, 'Sessão expirada', 401);
    return res.json({
      user: data.user,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at
    });
  }

  if (url === '/auth/me' && req.method === 'GET') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return err(res, 'Não autenticado', 401);
    const { data, error } = await sbAuth.auth.getUser(token);
    if (error || !data?.user) return err(res, 'Sessão inválida ou expirada', 401);
    return res.json({ user: data.user });
  }

  // Todas as demais rotas da API exigem autenticação.
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return err(res, 'Não autenticado', 401);
  const { data: authData, error: authError } = await sbAuth.auth.getUser(token);
  if (authError || !authData?.user) return err(res, 'Sessão inválida ou expirada', 401);
  // ─── SERVIDORES ───────────────────────────────────────────────
  if (url === '/servidores') {
    if (req.method === 'GET') {
      const { data } = await sb.from('servidores').select('*').order('nome');
      return res.json(data);
    }
    if (req.method === 'POST') {
      const nome = normalizarServidor((body.nome||'').trim());
      if (!nome) return err(res, 'Nome obrigatório');
      const { data, error } = await sb.from('servidores').insert({ id:uid(), nome, criado:new Date().toISOString() }).select().single();
      if (error) return err(res, 'Servidor já existe');
      return res.json(data);
    }
  }
  if (url.match(/^\/servidores\/[^/]+$/)) {
    const id = url.split('/')[2];
    if (req.method === 'PUT') {
      const nome = normalizarServidor((body.nome||'').trim());
      const { data } = await sb.from('servidores').update({ nome }).eq('id',id).select().single();
      return res.json(data);
    }
    if (req.method === 'DELETE') {
      await sb.from('servidores').delete().eq('id',id);
      return res.json({ ok:true });
    }
  }

  // ─── CLIENTES ─────────────────────────────────────────────────
  if (url === '/clientes') {
    if (req.method === 'GET') {
      let q = sb.from('clientes').select('*').order('nome');
      if (params.status) q = q.eq('status', params.status);
      if (params.busca)  q = q.or(`nome.ilike.%${params.busca}%,servidor.ilike.%${params.busca}%`);
      const { data } = await q;
      return res.json(data);
    }
    if (req.method === 'POST') {
      const { nome, celular, servidor, dia, valor, status, obs } = body;
      if (!nome||!dia||!valor) return err(res,'Campos obrigatórios faltando');
      const novo={
        id:uid(), nome, celular:celular||'', servidor:normalizarServidor(servidor)||'',
        dia:parseInt(dia), valor:parseFloat(valor), status:status||'ativo', obs:obs||'',
        dia_cobranca:diaCobrancaOuNull(body.dia_cobranca, dia),
        criado:new Date().toISOString()
      };
      let { data, error } = await sb.from('clientes').insert(novo).select().single();
      if (error && /dia_cobranca/.test(error.message||'')) { delete novo.dia_cobranca; ({ data, error } = await sb.from('clientes').insert(novo).select().single()); }
      if (error) return err(res, `Erro ao salvar cliente: ${error.message}`, 500);
      return res.json(data);
    }
  }
  // ─── JUNTAR DOIS CLIENTES ─────────────────────────────────────
  // Move todos os registros do "secundário" para o "principal", resolve
  // meses repetidos, guarda o nome do secundário como apelido (para próximas
  // importações irem direto ao principal) e apaga o secundário.
  if (url === '/clientes/mesclar' && req.method === 'POST') {
    const { principal_id, secundario_id, simular } = body;
    if (!principal_id || !secundario_id) return err(res,'Selecione os dois clientes');
    if (principal_id === secundario_id) return err(res,'Selecione dois clientes diferentes');
    const { data:cls, error:eC } = await sb.from('clientes').select('*').in('id',[principal_id,secundario_id]);
    if (eC) return err(res, eC.message, 500);
    const P=(cls||[]).find(c=>c.id===principal_id), S=(cls||[]).find(c=>c.id===secundario_id);
    if (!P || !S) return err(res,'Cliente não encontrado',404);

    const { data:movs, error:eM } = await selectAll('movimentos_financeiros','*',q=>q.in('cliente_id',[P.id,S.id]).order('id'));
    if (eM) return err(res, eM.message, 500);
    const movP=movs.filter(m=>m.cliente_id===P.id), movS=movs.filter(m=>m.cliente_id===S.id);
    const ativo=m=>m.status!=='cancelado';
    const aberto=m=>m.status==='pendente'||m.status==='vencido';
    const idsP=new Set(movP.map(m=>m.id));

    const apagar=new Set(), antigosRecriados=new Set(), mover=[], recriar=[];
    let conflitosPagos=0;
    const reId=new RegExp(`^mov_${S.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}_(\\d{6})$`);
    for(const m of movS){
      const doMesP=movP.filter(x=>x.mes_ref===m.mes_ref && ativo(x) && !apagar.has(x.id));
      if(ativo(m) && doMesP.length){
        const pPago=doMesP.some(x=>x.status==='pago');
        if(aberto(m)){ apagar.add(m.id); continue; }             // principal já cobre o mês
        if(m.status==='pago' && !pPago){ doMesP.filter(aberto).forEach(x=>apagar.add(x.id)); }
        else if(m.status==='pago' && pPago){ conflitosPagos++; }  // os dois pagos: mantém ambos
      }
      // Registros de importação têm ID por cliente+mês: passam para o ID do principal.
      const mm=m.id.match(reId);
      const novoId=mm ? `mov_${P.id}_${mm[1]}` : null;
      if(novoId && (!idsP.has(novoId) || apagar.has(novoId))){
        recriar.push({ ...m, id:novoId, cliente_id:P.id, cliente_nome:P.nome });
        antigosRecriados.add(m.id); idsP.add(novoId);
      } else mover.push(m.id);
    }

    const resumo={
      principal:{ id:P.id, nome:P.nome }, secundario:{ id:S.id, nome:S.nome },
      registros_movidos:mover.length+recriar.length,
      removidos_duplicados:apagar.size,
      meses_pagos_em_dobro:conflitosPagos
    };
    if (simular) return res.json({ ok:true, simulacao:true, ...resumo });

    // 1) Recria com ID novo (antes de apagar o antigo, para nunca perder dado)
    for(let i=0;i<recriar.length;i+=500){
      const { error } = await sb.from('movimentos_financeiros').upsert(recriar.slice(i,i+500),{onConflict:'id'});
      if (error) return err(res, `Erro ao mover registros: ${error.message}`, 500);
    }
    // 2) Apaga duplicados e os IDs antigos já recriados
    const idsApagar=[...apagar, ...antigosRecriados].filter(id=>!recriar.some(r=>r.id===id));
    for(let i=0;i<idsApagar.length;i+=200){
      const { error } = await sb.from('movimentos_financeiros').delete().in('id',idsApagar.slice(i,i+200));
      if (error) return err(res, `Erro ao limpar duplicados: ${error.message}`, 500);
    }
    // 3) Move os demais
    for(let i=0;i<mover.length;i+=200){
      const { error } = await sb.from('movimentos_financeiros').update({ cliente_id:P.id, cliente_nome:P.nome }).in('id',mover.slice(i,i+200));
      if (error) return err(res, `Erro ao mover registros: ${error.message}`, 500);
    }
    // 4) Completa o cadastro do principal com o que faltar
    const obsJunta=[P.obs, S.obs].map(x=>String(x||'').trim()).filter(Boolean);
    const upd={
      celular: P.celular || S.celular || '',
      obs: [...new Set(obsJunta)].join(' | '),
      status: (P.status==='ativo' || S.status==='ativo') ? 'ativo' : P.status
    };
    await sb.from('clientes').update(upd).eq('id',P.id);
    // 5) Apelido: o nome do secundário passa a apontar para o principal
    try{
      await sb.from('clientes_apelidos').update({ cliente_id:P.id }).eq('cliente_id',S.id);
      await sb.from('clientes_apelidos').upsert({ nome:S.nome, cliente_id:P.id, criado:new Date().toISOString() },{onConflict:'nome'});
    }catch{}
    // 6) Remove o secundário
    const { error:eDel } = await sb.from('clientes').delete().eq('id',S.id);
    if (eDel) return err(res, `Registros movidos, mas não consegui apagar o cliente secundário: ${eDel.message}`, 500);
    return res.json({ ok:true, ...resumo });
  }

  if (url.match(/^\/clientes\/[^/]+\/historico$/)) {
    const id = url.split('/')[2];
    const { data:movs, error } = await sb.from('movimentos_financeiros')
      .select('*').eq('cliente_id',id).order('vencimento',{ascending:false});
    if (error) return err(res, `Erro ao carregar histórico: ${error.message}`, 500);
    // A tabela unificada já usa o mesmo formato da tela.
    const historico = (movs||[]).map(m => ({
      ...m,
      valor: Number(m.valor||0),
      valor_pago: m.valor_pago == null ? null : Number(m.valor_pago),
      desconto: Number(m.desconto||0),
      origem: m.origem || 'sistema'
    })).sort((a,b)=>{
      // Ordena pelo mês de referência (competência), mais recente primeiro.
      const ra = a.mes_ref || String(a.vencimento||'').slice(0,7);
      const rb = b.mes_ref || String(b.vencimento||'').slice(0,7);
      if (ra !== rb) return rb.localeCompare(ra);
      return String(b.pago_em||'').localeCompare(String(a.pago_em||''));
    });
    return res.json(historico);
  }
  if (url.match(/^\/clientes\/[^/]+\/parcelas-lote$/)) {
    await marcarVencidos();
    const id = url.split('/')[2];
    const { data:cliente } = await sb.from('clientes').select('*').eq('id',id).single();
    if (!cliente) return err(res,'Cliente não encontrado',404);
    const { data:abertas } = await sb.from('movimentos_financeiros').select('*').eq('cliente_id',id).in('status',['pendente','vencido']).order('vencimento');
    const hoje = new Date();
    const futuros = [];
    for (let i=0;i<=12;i++) {
      const d=new Date(hoje.getFullYear(),hoje.getMonth()+i,1);
      const mes=d.getMonth()+1, ano=d.getFullYear(), mr=`${ano}-${pad(mes)}`;
      const { data:existe } = await sb.from('movimentos_financeiros').select('id').eq('cliente_id',id).eq('mes_ref',mr).maybeSingle();
      if (!existe) {
        const dia=Math.min(cliente.dia,diasNoMes(mes,ano));
        futuros.push({ id:null, cliente_id:id, cliente_nome:cliente.nome, servidor:cliente.servidor,
          valor:cliente.valor, vencimento:`${ano}-${pad(mes)}-${pad(dia)}`, mes_ref:mr, status:'futuro' });
      }
    }
    return res.json({ cliente, abertas, futuros });
  }
  if (url.match(/^\/clientes\/[^/]+$/) && !url.includes('historico') && !url.includes('parcelas')) {
    const id = url.split('/')[2];
    if (req.method === 'PUT') {
      // Atualiza SÓ os campos enviados. Antes, "Ativar/Desativar" (que envia
      // apenas o status) apagava celular/servidor e zerava dia/valor.
      const upd={};
      if (body.nome!==undefined)     upd.nome=String(body.nome).trim();
      if (body.celular!==undefined)  upd.celular=body.celular||'';
      if (body.servidor!==undefined) upd.servidor=normalizarServidor(body.servidor)||'';
      if (body.dia!==undefined && !isNaN(parseInt(body.dia)))       upd.dia=parseInt(body.dia);
      if (body.valor!==undefined && !isNaN(parseFloat(body.valor))) upd.valor=parseFloat(body.valor);
      if (body.status!==undefined)   upd.status=body.status==='ativo'?'ativo':'inativo';
      if (body.obs!==undefined)      upd.obs=body.obs||'';
      if (body.dia_cobranca!==undefined) upd.dia_cobranca=diaCobrancaOuNull(body.dia_cobranca, body.dia);
      if (!Object.keys(upd).length) return err(res,'Nada para atualizar');
      let { data, error } = await sb.from('clientes').update(upd).eq('id',id).select().single();
      if (error && /dia_cobranca/.test(error.message||'')) { delete upd.dia_cobranca; ({ data, error } = await sb.from('clientes').update(upd).eq('id',id).select().single()); }
      if (error) return err(res, `Erro ao atualizar cliente: ${error.message}`, 500);
      return res.json(data);
    }
    if (req.method === 'DELETE') {
      await sb.from('clientes').delete().eq('id',id);
      return res.json({ ok:true });
    }
  }

  // ─── COBRANÇAS ────────────────────────────────────────────────
  if (url === '/cobrancas') {
    await marcarVencidos();
    let q = sb.from('movimentos_financeiros').select('*').order('vencimento');
    if (params.mes_ref) q = q.eq('mes_ref', params.mes_ref);
    if (params.status)  q = q.eq('status', params.status);
    if (params.busca)   q = q.or(`cliente_nome.ilike.%${params.busca}%,servidor.ilike.%${params.busca}%`);
    const { data } = await q;
    return res.json(data);
  }
  // ─── IMPORTAR EXTRATO BANCÁRIO (OFX) ──────────────────────────
  // 1) /extrato/analisar: lê o OFX, reconhece quem pagou e sugere o destino
  //    de cada lançamento (mensalidade, receita, despesa ou ignorar).
  // 2) /extrato/confirmar: grava o que o usuário revisou e "aprende" os nomes.
  if (url === '/extrato/analisar' && req.method === 'POST') {
    const lancs = lerOFX(String(body.texto||''));
    if (!lancs.length) return err(res,'Nenhum lançamento encontrado. O arquivo é um OFX?');
    const [pg, jaImp, cls, abertos] = await Promise.all([
      tabelaOpcional('extrato_pagadores','*'),
      tabelaOpcional('extrato_lancamentos','fitid', q=>q.in('fitid', lancs.map(l=>l.fitid).slice(0,1000))),
      selectAll('clientes','id,nome,servidor,valor,dia,status'),
      selectAll('movimentos_financeiros','id,cliente_id,mes_ref,status,valor,valor_pago,pago_em,origem', q=>q.in('status',['pendente','vencido','pago']).order('id'))
    ]);
    if (pg.faltaTabela || jaImp.faltaTabela) return err(res,'Rode o arquivo MIGRACAO_EXTRATO.sql no Supabase antes de importar extratos.');
    const pagadores=new Map(pg.data.map(p=>[p.chave,p]));
    const importados=new Set(jaImp.data.map(r=>r.fitid));
    const clientes=cls.data||[];
    const porId=new Map(clientes.map(c=>[c.id,c]));
    const movsPorCliente=new Map();
    for(const m of (abertos.data||[])){ if(!movsPorCliente.has(m.cliente_id)) movsPorCliente.set(m.cliente_id,[]); movsPorCliente.get(m.cliente_id).push(m); }
    const tokensCli=clientes.map(c=>({ c, t:new Set(tokensNome(c.nome)) }));

    const mesHoje=new Date().toISOString().slice(0,7);
    const mesesSugeridos=(cid)=>{
      // em aberto (mais antigo primeiro) e depois os próximos meses ainda não pagos
      const ms=movsPorCliente.get(cid)||[];
      const abertosM=ms.filter(m=>m.status!=='pago' && m.mes_ref).map(m=>m.mes_ref).sort();
      const pagos=new Set(ms.filter(m=>m.status==='pago').map(m=>m.mes_ref));
      const ultimo=[...pagos, ...abertosM].sort().at(-1) || somarMeses(mesHoje,-1);
      const futuros=[]; let mr=ultimo;
      while(futuros.length<12){ mr=somarMeses(mr,1); if(!pagos.has(mr) && !abertosM.includes(mr)) futuros.push(mr); }
      return [...new Set([...abertosM, ...futuros])];
    };
    const qtdMeses=(valor,c)=>{ const v=Number(c?.valor||0); if(!v) return 1; return Math.max(1, Math.min(12, Math.round(valor/v))); };

    const itens=lancs.map(l=>{
      const it={ ...l, ja_importado:importados.has(l.fitid) };
      const conhecido=pagadores.get(l.chave);
      if (conhecido) {
        it.destino=conhecido.destino; it.conhecido=true;
        if (conhecido.destino==='cliente' && porId.has(conhecido.cliente_id)) {
          it.cliente_id=conhecido.cliente_id;
          // PIX que costuma pagar mais de um cliente (lembrado como "dividir:id1,id2")
          if (String(conhecido.tipo||'').startsWith('dividir:'))
            it.partes=String(conhecido.tipo).slice(8).split(',').filter(id=>porId.has(id)).map(id=>({ cliente_id:id }));
        }
        else if (conhecido.destino==='cliente') { it.destino=''; it.conhecido=false; }
        it.tipo=conhecido.destino==='cliente'?'':(conhecido.tipo||''); it.servidor=conhecido.servidor||'';
      } else if (l.investimento) {
        it.destino='ignorar';
      } else if (l.valor>0) {
        // Sugere clientes pelo nome (palavras em comum com o cadastro)
        const tk=tokensNome(l.nome);
        const cand=tokensCli.map(({c,t})=>({ c, score:tk.filter(x=>t.has(x)).length, primeiro:t.has(tk[0]) }))
          .filter(x=>x.score>=2 || (x.score===1 && x.primeiro && tk.length<=2))
          .sort((a,b)=>(b.primeiro-a.primeiro) || b.score-a.score || (a.c.status==='ativo'?-1:1)).slice(0,4);
        it.candidatos=cand.map(x=>({ id:x.c.id, nome:x.c.nome, score:x.score }));
        // Só pré-seleciona quando é claro: primeiro nome bate (ou 3+ palavras) e sem empate
        const top=cand[0], seg=cand[1];
        const claro = top && (top.primeiro || top.score>=3) && (!seg || top.score>seg.score || (top.primeiro && !seg.primeiro));
        if (claro) { it.destino='cliente'; it.cliente_id=top.c.id; it.sugerido=true; }
        else it.destino=cand.length?'cliente':'';
      } else {
        it.destino='despesa';
      }
      if (it.cliente_id) {
        const c=porId.get(it.cliente_id);
        it.meses_disponiveis=mesesSugeridos(it.cliente_id);
        it.qtd_meses=qtdMeses(l.valor,c);
      }
      return it;
    });
    // Meses sugeridos de qualquer cliente (para quando o usuário escolher outro na tela)
    return res.json({
      conta:lancs.conta, periodo:lancs.periodo, itens,
      clientes:clientes.map(c=>({ id:c.id, nome:c.nome, valor:c.valor, servidor:c.servidor, status:c.status })),
      meses_por_cliente:Object.fromEntries(clientes.map(c=>[c.id, mesesSugeridos(c.id)])),
      // Últimos meses pagos de cada cliente: para conferir se o PIX já foi lançado
      historico_por_cliente:Object.fromEntries([...movsPorCliente].map(([cid,ms])=>[cid,
        ms.filter(m=>m.status==='pago').sort((a,b)=>String(b.mes_ref).localeCompare(String(a.mes_ref))).slice(0,8)
          .map(m=>({ mes_ref:m.mes_ref, pago_em:m.pago_em?String(m.pago_em).slice(0,10):null, valor_pago:Number(m.valor_pago||0), origem:m.origem||'' }))]))
    });
  }

  if (url === '/extrato/confirmar' && req.method === 'POST') {
    const itens=Array.isArray(body.itens)?body.itens:[];
    if (!itens.length) return err(res,'Nada para importar');
    const { data:ja, error:eJa } = await sb.from('extrato_lancamentos').select('fitid').in('fitid',itens.map(i=>i.fitid));
    if (eJa) return err(res, /extrato_lancamentos/.test(eJa.message)?'Rode o arquivo MIGRACAO_EXTRATO.sql no Supabase.':eJa.message, 500);
    const jaSet=new Set((ja||[]).map(r=>r.fitid));
    const resumo={ mensalidades:0, meses:0, receitas:0, despesas:0, ignorados:0, repetidos:0, erros:[] };
    const agora=new Date().toISOString();

    for (const it of itens) {
      if (jaSet.has(it.fitid)) { resumo.repetidos++; continue; }
      const valor=Math.abs(Number(it.valor||0));
      const data=String(it.data||'').slice(0,10);
      let ref_id=null;
      try {
        if (it.destino==='cliente') {
          // Um PIX pode pagar mais de um cliente (ex.: o dele e o da sogra).
          // "partes" são os clientes extras; o principal fica com o restante.
          const extras=(Array.isArray(it.partes)?it.partes:[]).filter(p=>p&&p.cliente_id);
          const somaExtras=extras.reduce((t,p)=>t+Math.abs(Number(p.valor||0)),0);
          const partes=[{ cliente_id:it.cliente_id, meses:it.meses, valor:Number((valor-somaExtras).toFixed(2)) }, ...extras.map(p=>({ cliente_id:p.cliente_id, meses:p.meses, valor:Math.abs(Number(p.valor||0)) }))];
          if (partes.some(p=>!(p.valor>0))) throw new Error('valor das partes não fecha com o PIX');
          const ids=[];
          for (const pt of partes) {
            const r=await pagarClienteExtrato(pt.cliente_id, pt.meses, pt.valor, data, it, extras.length>0);
            ids.push(...r); resumo.meses+=(pt.meses||[]).filter(Boolean).length;
          }
          ref_id=ids.join(','); resumo.mensalidades++;
        } else if (it.destino==='receita') {
          const { data:r, error } = await sb.from('outras_vendas').insert({ id:uid(), data, tipo_rec:(it.tipo||'Outras Receitas').trim(),
            cliente:(it.nome||'').trim()||'—', produto:(it.descricao||'Extrato bancário').trim(), valor_un:valor, qtde:1, total:valor,
            mes_ref:data.slice(0,7), criado:agora }).select().single();
          if (error) throw error; ref_id=r.id; resumo.receitas++;
        } else if (it.destino==='despesa') {
          const { data:r, error } = await gravarDespesa('insert',{ id:uid(), data, tipo:(it.tipo||'Outros').trim(),
            responsavel:normalizarServidor((it.servidor||'').trim())||(it.servidor||'').trim(), descricao:(it.descricao||it.nome||'').trim(),
            valor_un:valor, qtde:1, total:valor, mes_ref:data.slice(0,7), meses_cobertos:mesesCobertos(it.meses_cobertos), criado:agora });
          if (error) throw error; ref_id=r?.id||null; resumo.despesas++;
        } else if (it.destino==='ignorar') {
          resumo.ignorados++;
        } else continue; // sem destino: não grava nada

        await sb.from('extrato_lancamentos').insert({ fitid:it.fitid, data, valor:Number(it.valor||0), memo:String(it.memo||'').slice(0,500),
          chave:it.chave||null, destino:it.destino, ref_id, criado:agora });
        if (it.lembrar && it.chave) {
          await sb.from('extrato_pagadores').upsert({ chave:it.chave, nome:it.nome||'', destino:it.destino,
            cliente_id:it.destino==='cliente'?it.cliente_id:null, tipo:(it.destino==='cliente' ? ((it.partes||[]).filter(p=>p&&p.cliente_id).length ? 'dividir:'+(it.partes||[]).filter(p=>p&&p.cliente_id).map(p=>p.cliente_id).join(',') : null) : (it.tipo||null)), servidor:(normalizarServidor((it.servidor||'').trim())||it.servidor||null), criado:agora },{ onConflict:'chave' });
        }
      } catch(e) {
        resumo.erros.push({ fitid:it.fitid, nome:it.nome, mensagem:e?.message||String(e) });
      }
    }
    return res.json({ ok:resumo.erros.length===0, ...resumo });
  }

  if (url === '/extrato/pagadores' && req.method === 'GET') {
    const r=await tabelaOpcional('extrato_pagadores','*',q=>q.order('nome'));
    return res.json(r.data||[]);
  }
  if (url.match(/^\/extrato\/pagadores\/.+$/) && req.method === 'DELETE') {
    const chave=decodeURIComponent(url.split('/').slice(3).join('/'));
    await sb.from('extrato_pagadores').delete().eq('chave',chave);
    return res.json({ ok:true });
  }

  // ─── EXPORTAR (backup em planilha) ────────────────────────────
  // Devolve os dados crus; a planilha .xlsx é montada no navegador.
  if (url === '/exportar' && req.method === 'GET') {
    const ano = String(params.ano||new Date().getFullYear());
    if (!/^\d{4}$/.test(ano)) return err(res,'Ano inválido');
    const todosAnos = params.todos === '1';
    const [cl, mv, ov, dp] = await Promise.all([
      selectAll('clientes','*',q=>q.order('nome')),
      selectAll('movimentos_financeiros','*',q=>q.like('mes_ref',`${ano}-%`).neq('status','cancelado').order('id')),
      selectAll('outras_vendas','*',q=>{ q=q.order('data'); return todosAnos?q:q.like('mes_ref',`${ano}-%`); }),
      selectAll('despesas','*',q=>{ q=q.order('data'); return todosAnos?q:q.like('mes_ref',`${ano}-%`); })
    ]);
    for (const r of [cl,mv,ov,dp]) if (r.error) return err(res, `Erro ao exportar: ${r.error.message}`, 500);
    return res.json({ ano:Number(ano), todosAnos, clientes:cl.data, movimentos:mv.data, receitas:ov.data, despesas:dp.data });
  }

  if (url === '/cobrancas/meses') {
    const { data:movs } = await selectAll('movimentos_financeiros','mes_ref,pago_em');
    const meses = new Set();
    (movs||[]).forEach(r=>{ if(r.mes_ref) meses.add(r.mes_ref); if(r.pago_em) meses.add(String(r.pago_em).slice(0,7)); });
    return res.json([...meses].sort().reverse());
  }
  if (url === '/cobrancas/inadimplentes') {
    await marcarVencidos();
    const { data } = await selectAll('movimentos_financeiros','*',q=>q.eq('status','vencido').order('vencimento'));
    return res.json(data);
  }
  if (url === '/cobrancas/gerar' && req.method === 'POST') {
    const agora=new Date(), mes=agora.getMonth()+1, ano=agora.getFullYear(), mesRef=`${ano}-${pad(mes)}`;
    const { data:clientes, error:eClientes } = await sb.from('clientes').select('*').eq('status','ativo');
    if (eClientes) return err(res, `Erro ao carregar clientes: ${eClientes.message}`, 500);

    // Um cliente não deve receber uma nova cobrança do mês se o mês já foi
    // pago no histórico importado. Antes considerávamos somente a tabela
    // cobrancas, então clientes com pagamento histórico recebiam uma nova
    // cobrança ao clicar em "Gerar cobranças do mês".
    const { data:existentes, error:eExistentes } = await sb
      .from('movimentos_financeiros').select('cliente_id,status,origem').eq('mes_ref',mesRef).neq('status','cancelado');
    if (eExistentes) return err(res, `Erro ao consultar cobranças existentes: ${eExistentes.message}`, 500);

    const jaTemMovimento = new Set((existentes||[]).map(r=>r.cliente_id));
    const jaPagosHistorico = new Set((existentes||[]).filter(r=>r.status==='pago' && r.origem==='importacao_historico').map(r=>r.cliente_id));

    const novos = clientes.filter(c=>!jaTemMovimento.has(c.id)).map(c=>{
      const dia=Math.min(c.dia,diasNoMes(mes,ano));
      return { id:uid(), cliente_id:c.id, cliente_nome:c.nome, servidor:c.servidor,
        valor:c.valor, vencimento:`${ano}-${pad(mes)}-${pad(dia)}`, mes_ref:mesRef,
        status:'pendente', tipo_movimento:'mensalidade', origem:'geracao_mensal', desconto:0, criado:new Date().toISOString() };
    });

    if (novos.length) {
      const { error:eInsert } = await sb.from('movimentos_financeiros').insert(novos);
      if (eInsert) return err(res, `Erro ao gerar cobranças: ${eInsert.message}`, 500);
    }

    return res.json({
      novos:novos.length,
      mesRef,
      jaExistentes:jaTemMovimento.size,
      jaPagosHistorico:jaPagosHistorico.size,
      totalAtivos:clientes.length
    });
  }
  if (url === '/cobrancas/receber-lote' && req.method === 'POST') {
    const { cliente_id, ids_existentes=[], meses_futuros=[], pago_em, valor_total, obs } = body;
    if (!cliente_id||!pago_em||valor_total==null) return err(res,'Dados incompletos');
    const { data:cliente } = await sb.from('clientes').select('*').eq('id',cliente_id).single();
    if (!cliente) return err(res,'Cliente não encontrado',404);
    const totalIds = ids_existentes.length + meses_futuros.length;
    if (!totalIds) return err(res,'Selecione ao menos 1 parcela');
    const base = parseFloat((valor_total/totalIds).toFixed(2));
    const baixadas = [];
    let idx = 0;
    // Existentes
    if (ids_existentes.length) {
      const { data:exist } = await sb.from('movimentos_financeiros').select('*').in('id',ids_existentes).order('vencimento');
      for (const cb of exist) {
        const vp = idx===totalIds-1 ? parseFloat((valor_total-base*(totalIds-1)).toFixed(2)) : base;
        await sb.from('movimentos_financeiros').update({ status:'pago', pago_em, valor_pago:vp, desconto:Math.max(0,parseFloat(cb.valor||0)-vp), obs_pagamento:obs||'', origem:cb.origem||'pagamento_manual' }).eq('id',cb.id);
        baixadas.push({ ...cb, valor_pago:vp, pago_em, status:'pago' });
        idx++;
      }
    }
    // Futuros
    for (const mr of [...meses_futuros].sort()) {
      const [ano,mes] = mr.split('-').map(Number);
      const dia=Math.min(cliente.dia,diasNoMes(mes,ano));
      const venc=`${ano}-${pad(mes)}-${pad(dia)}`;
      const vp = idx===totalIds-1 ? parseFloat((valor_total-base*(totalIds-1)).toFixed(2)) : base;
      const novoId = uid();
      const { data:nova } = await sb.from('movimentos_financeiros').upsert({
        id:novoId, cliente_id, cliente_nome:cliente.nome, servidor:cliente.servidor,
        valor:cliente.valor, vencimento:venc, mes_ref:mr,
        status:'pago', pago_em, valor_pago:vp,
        desconto:Math.max(0,parseFloat(cliente.valor||0)-vp),
        obs_pagamento:obs||'', tipo_movimento:'mensalidade', origem:'pagamento_manual',
        criado:new Date().toISOString()
      }).select().single();
      baixadas.push(nova);
      idx++;
    }
    return res.json({ ok:true, baixadas, total:valor_total });
  }
  if (url.match(/^\/cobrancas\/[^/]+\/pagar$/) && req.method === 'PUT') {
    const id = url.split('/')[2];
    const { pago_em, valor_pago, obs_pagamento, servidor_novo } = body;
    const { data:cb } = await sb.from('movimentos_financeiros').select('*').eq('id',id).single();
    if (!cb) return err(res,'Cobrança não encontrada',404);
    const valorPagoNum=parseFloat(valor_pago);
    if (servidor_novo && servidor_novo !== cb.servidor)
      await sb.from('clientes').update({ servidor:servidor_novo }).eq('id',cb.cliente_id);
    const { error:ePag } = await sb.from('movimentos_financeiros').update({
      status:'pago', pago_em, valor_pago:valorPagoNum,
      desconto:Math.max(0,parseFloat(cb.valor||0)-valorPagoNum),
      obs_pagamento:obs_pagamento||'', origem:cb.origem||'pagamento_manual'
    }).eq('id',id);
    if(ePag) return err(res, `Erro ao registrar pagamento: ${ePag.message}`, 500);
    const { data } = await sb.from('movimentos_financeiros').select('*').eq('id',id).single();
    return res.json(data);
  }
  if (url.match(/^\/cobrancas\/[^/]+\/cancelar$/) && req.method === 'PUT') {
    const id = url.split('/')[2];
    await sb.from('movimentos_financeiros').update({ status:'cancelado' }).eq('id',id);
    return res.json({ ok:true });
  }

  // ─── AUDITORIA FINANCEIRA ─────────────────────────────────────
  if (url === '/financeiro/auditoria' && req.method === 'GET') {
    const { data:movs, error:eMovs } = await selectAll('movimentos_financeiros','cliente_id,cliente_nome,servidor,mes_ref,pago_em,status,valor_pago,origem');
    if (eMovs) return err(res, `Erro ao auditar financeiro: ${eMovs.message}`, 500);

    const anoFiltro=params.ano ? String(params.ano) : '';
    const origemFiltro=params.origem ? String(params.origem) : '';
    const anoRefFiltro=params.ano_ref ? String(params.ano_ref) : '';
    const rows=(movs||[])
      .filter(r=>!anoFiltro || String(r.pago_em||r.mes_ref||'').slice(0,4)===anoFiltro)
      .filter(r=>!origemFiltro || r.origem===origemFiltro)
      .filter(r=>!anoRefFiltro || String(r.mes_ref||'').slice(0,4)===anoRefFiltro);
    const receb=rows.filter(r=>r.status==='pago' && r.valor_pago!=null);
    const meses={};
    for(const r of receb){
      const mr=(r.pago_em||r.mes_ref||'').slice(0,7);
      if(!mr) continue;
      if(!meses[mr]) meses[mr]={mes_ref:mr,qtd:0,valor:0,clientes:0,clientes_ids:new Set()};
      meses[mr].qtd++;
      meses[mr].valor+=Number(r.valor_pago||0);
      if(r.cliente_id) meses[mr].clientes_ids.add(r.cliente_id);
    }
    const porMes=Object.values(meses).sort((a,b)=>a.mes_ref.localeCompare(b.mes_ref)).map(r=>({
      mes_ref:r.mes_ref,qtd:r.qtd,valor:Number(r.valor.toFixed(2)),clientes:r.clientes_ids.size
    }));
    return res.json({
      totalMovimentos:rows.length,
      totalRecebimentos:receb.length,
      totalValorRecebido:Number(receb.reduce((s,r)=>s+Number(r.valor_pago||0),0).toFixed(2)),
      porMes
    });
  }

  // ─── DASHBOARD ────────────────────────────────────────────────
  if (url === '/dashboard') {
    await marcarVencidos();
    const hoje = new Date().toISOString().slice(0,10);
    const mesRef = hoje.slice(0,7);
    const { count:ativos } = await sb.from('clientes').select('*',{count:'exact',head:true}).eq('status','ativo');
    const { data:doMes } = await sb.from('movimentos_financeiros').select('*').eq('mes_ref',mesRef).order('vencimento');
    const proximoMes = new Date(hoje.slice(0,7)+'-01T00:00:00');
    proximoMes.setMonth(proximoMes.getMonth()+1);
    const proximoMesRef = `${proximoMes.getFullYear()}-${pad(proximoMes.getMonth()+1)}`;
    const { data:pagamentosMes } = await sb.from('movimentos_financeiros').select('*').eq('status','pago').not('pago_em','is',null).gte('pago_em',`${mesRef}-01`).lt('pago_em',`${proximoMesRef}-01`);
    const recebMes=pagamentosMes||[];
    const recebido=recebMes.reduce((s,r)=>s+parseFloat(r.valor_pago||0),0);
    return res.json({
      ativos:ativos||0,
      totalMes:(doMes||[]).reduce((s,c)=>s+parseFloat(c.valor||0),0),
      recebido,
      pendentes:(doMes||[]).filter(c=>c.status==='pendente').length,
      vencidas:(doMes||[]).filter(c=>c.status==='vencido').length,
      mesRef,
      doMes:doMes||[],
      recebimentosMes:recebMes||[]
    });
  }

  // ─── FINANCEIRO ───────────────────────────────────────────────
  if (url === '/financeiro') {
    await marcarVencidos();
    const { de, ate } = params;
    const { data:movs, error:eMovs } = await selectAll('movimentos_financeiros','*');
    const { data:todasOv } = await selectAll('outras_vendas','*');
    const { data:todasDp } = await selectAll('despesas','*');
    const { data:srvRows } = await sb.from('servidores').select('nome');
    if (eMovs) return err(res, `Erro ao carregar financeiro: ${eMovs.message}`, 500);

    const movimentos=(movs||[]).filter(m=>m.status!=='cancelado'), ovs0=todasOv||[], dps0=todasDp||[];
    const mesHoje=new Date().toISOString().slice(0,7);
    const mesPag=m=>m.pago_em ? String(m.pago_em).slice(0,7) : null;
    const pagos=movimentos.filter(m=>m.status==='pago' && m.valor_pago!=null);

    // Servidor de uma despesa = campo "Responsável / Servidor" que bata com
    // um servidor cadastrado (ou usado nas mensalidades).
    const nomesSrv=new Map();
    [...(srvRows||[]).map(r=>r.nome), ...movimentos.map(m=>m.servidor)].filter(Boolean)
      .forEach(n=>nomesSrv.set(String(n).trim().toLowerCase(), n));
    const servidorDaDespesa=d=>{
      const r=normalizarServidor(String(d.responsavel||'').trim());
      return r ? (nomesSrv.get(r.toLowerCase())||null) : null;
    };

    // Rateio por competência: uma despesa que cobre N meses vira N parcelas
    // iguais a partir do mês da despesa (ex.: renovação de 3 meses do servidor).
    const dpsComp=[];
    for(const d of dps0){
      if(!d.mes_ref) continue;
      const n=mesesCobertos(d.meses_cobertos), tot=parseFloat(d.total||0);
      for(let i=0;i<n;i++) dpsComp.push({ mes_ref:somarMeses(d.mes_ref,i), valor:tot/n, servidor:servidorDaDespesa(d) });
    }

    const mesesSet = new Set();
    movimentos.forEach(m=>{ if(m.mes_ref) mesesSet.add(m.mes_ref); const mp=mesPag(m); if(mp) mesesSet.add(mp); });
    ovs0.forEach(r=>r.mes_ref && mesesSet.add(r.mes_ref));
    dps0.forEach(r=>r.mes_ref && mesesSet.add(r.mes_ref));
    // Meses futuros só entram se houver receita/despesa por competência neles.
    dpsComp.forEach(r=>{ if(r.mes_ref<=mesHoje) mesesSet.add(r.mes_ref); });

    const addSrv=(obj,srv,campo,v)=>{ srv=srv||'Sem servidor'; if(!obj[srv]) obj[srv]={qtd:0,valor:0,custo:0}; if(campo==='valor'){obj[srv].qtd++;obj[srv].valor+=v;} else obj[srv].custo+=v; };

    const resultado=[];
    for(const mr of [...mesesSet].sort()){
      if(de && mr<de) continue;
      if(ate && mr>ate) continue;
      const cobsMes=movimentos.filter(m=>m.mes_ref===mr);
      const recebMes=pagos.filter(m=>mesPag(m)===mr);                 // CAIXA
      const recebSemData=pagos.filter(m=>!m.pago_em && m.mes_ref===mr);
      const compMes=pagos.filter(m=>m.mes_ref===mr);                  // COMPETÊNCIA
      const antecipMes=recebMes.filter(m=>m.mes_ref && m.mes_ref>mr);  // pago neste mês p/ meses futuros
      const atrasoMes=recebMes.filter(m=>m.mes_ref && m.mes_ref<mr);   // pago neste mês p/ meses passados

      const soma=(arr,f='valor_pago')=>arr.reduce((s,r)=>s+parseFloat(r[f]||0),0);
      const em_aberto=soma(cobsMes.filter(c=>c.status==='pendente'),'valor');
      const atrasado=soma(cobsMes.filter(c=>c.status==='vencido'),'valor');
      const totalCobrancas=soma(cobsMes,'valor');
      const recebidoMensalidade=soma(recebMes);
      const competencia=soma(compMes);

      const porServidor={}, porServidorComp={};
      recebMes.forEach(r=>addSrv(porServidor,r.servidor,'valor',parseFloat(r.valor_pago||0)));
      compMes.forEach(r=>addSrv(porServidorComp,r.servidor,'valor',parseFloat(r.valor_pago||0)));

      const ovs=ovs0.filter(r=>r.mes_ref===mr);
      const outrasReceitas=soma(ovs,'total');
      const dps=dps0.filter(r=>r.mes_ref===mr);
      const totalDespesas=soma(dps,'total');
      dps.forEach(d=>{ const srv=servidorDaDespesa(d); if(srv) addSrv(porServidor,srv,'custo',parseFloat(d.total||0)); });
      const dpc=dpsComp.filter(r=>r.mes_ref===mr);
      const despesasComp=dpc.reduce((s,r)=>s+r.valor,0);
      dpc.forEach(d=>{ if(d.servidor) addSrv(porServidorComp,d.servidor,'custo',d.valor); });

      const receitaTotal=recebidoMensalidade+outrasReceitas;
      const receitaTotalComp=competencia+outrasReceitas;
      resultado.push({
        mes_ref:mr,
        // caixa
        recebido:recebidoMensalidade, antecipado:soma(antecipMes), qtd_antecipado:antecipMes.length,
        recebido_atrasado:soma(atrasoMes),
        despesas:totalDespesas, receita_total:receitaTotal, lucro_liquido:receitaTotal-totalDespesas,
        por_servidor:porServidor,
        // competência
        competencia, qtd_competencia:compMes.length,
        despesas_comp:despesasComp, receita_total_comp:receitaTotalComp, lucro_comp:receitaTotalComp-despesasComp,
        por_servidor_comp:porServidorComp,
        // comuns
        em_aberto, atrasado, total:totalCobrancas, outras_receitas:outrasReceitas,
        clientes_ativos:new Set(recebMes.map(r=>r.cliente_id)).size,
        clientes_comp:new Set(compMes.map(r=>r.cliente_id)).size,
        // Clientes ativos no mês = mensalidade do mês de referência renovada:
        // paga (Recebido = Sim) ou em aberto (Recebido = Não). Canceladas não contam.
        clientes_ref:new Set(cobsMes.filter(m=>['pago','pendente','vencido'].includes(m.status)).map(m=>m.cliente_id)).size,
        clientes_ref_pagos:new Set(cobsMes.filter(m=>m.status==='pago').map(m=>m.cliente_id)).size,
        // Clientes ativos por servidor (mesma regra: Sim + Não do mês de referência)
        ativos_servidor:(()=>{
          const o={};
          cobsMes.filter(m=>['pago','pendente','vencido'].includes(m.status)).forEach(m=>{
            const srv=m.servidor||'Sem servidor';
            if(!o[srv]) o[srv]={todos:new Set(),pagos:new Set()};
            o[srv].todos.add(m.cliente_id);
            if(m.status==='pago') o[srv].pagos.add(m.cliente_id);
          });
          return Object.fromEntries(Object.entries(o).map(([k,v])=>{
            const abertos=[...v.todos].filter(id=>!v.pagos.has(id)).length;
            return [k,{ativos:v.todos.size,pagos:v.todos.size-abertos,abertos}];
          }));
        })(),
        qtd_recebimentos:recebMes.length, qtd_recebimentos_sem_data:recebSemData.length
      });
    }
    const campos=['recebido','antecipado','qtd_antecipado','recebido_atrasado','despesas','receita_total','lucro_liquido',
      'competencia','qtd_competencia','despesas_comp','receita_total_comp','lucro_comp','em_aberto','atrasado','total','outras_receitas','qtd_recebimentos'];
    const totais=Object.fromEntries(campos.map(c=>[c,resultado.reduce((s,r)=>s+(r[c]||0),0)]));
    totais.clientes_ativos=Math.max(0,...resultado.map(r=>r.clientes_ativos));
    totais.clientes_comp=Math.max(0,...resultado.map(r=>r.clientes_comp));

    // Receita antecipada HOJE: dinheiro já recebido que pertence a meses
    // futuros (mes_ref depois do mês atual). Não depende do filtro de período.
    const futuros={};
    pagos.filter(m=>m.mes_ref && m.mes_ref>mesHoje).forEach(m=>{
      if(!futuros[m.mes_ref]) futuros[m.mes_ref]={mes_ref:m.mes_ref,qtd:0,valor:0,clientes:new Set()};
      futuros[m.mes_ref].qtd++; futuros[m.mes_ref].valor+=parseFloat(m.valor_pago||0); futuros[m.mes_ref].clientes.add(m.cliente_id);
    });
    const antecipadoMeses=Object.values(futuros).sort((a,b)=>a.mes_ref.localeCompare(b.mes_ref))
      .map(f=>({mes_ref:f.mes_ref,qtd:f.qtd,valor:Number(f.valor.toFixed(2)),clientes:f.clientes.size}));
    const receitaAntecipada={
      total:Number(antecipadoMeses.reduce((s,f)=>s+f.valor,0).toFixed(2)),
      qtd:antecipadoMeses.reduce((s,f)=>s+f.qtd,0),
      clientes:new Set(pagos.filter(m=>m.mes_ref && m.mes_ref>mesHoje).map(m=>m.cliente_id)).size,
      meses:antecipadoMeses
    };

    // A RECEBER: todas as mensalidades em aberto (pendente/vencido), por mês de
    // referência. Não depende do filtro de período.
    const hojeDia=new Date().toISOString().slice(0,10);
    const abertos={};
    movimentos.filter(m=>['pendente','vencido'].includes(m.status) && m.mes_ref).forEach(m=>{
      const g=abertos[m.mes_ref]||(abertos[m.mes_ref]={mes_ref:m.mes_ref,qtd:0,valor:0,vencido:0,pendente:0,itens:[]});
      const v=parseFloat(m.valor||0);
      g.qtd++; g.valor+=v; g[m.status]+=v;
      const dias=m.vencimento ? Math.floor((new Date(hojeDia+'T00:00:00')-new Date(String(m.vencimento).slice(0,10)+'T00:00:00'))/86400000) : null;
      g.itens.push({ id:m.id, cliente_id:m.cliente_id, cliente_nome:m.cliente_nome, servidor:m.servidor||'', vencimento:m.vencimento, valor:v, status:m.status, dias_atraso:dias!=null&&dias>0?dias:0 });
    });
    const aReceber=Object.values(abertos).sort((a,b)=>a.mes_ref.localeCompare(b.mes_ref)).map(g=>({
      ...g, valor:Number(g.valor.toFixed(2)), vencido:Number(g.vencido.toFixed(2)), pendente:Number(g.pendente.toFixed(2)),
      itens:g.itens.sort((a,b)=>String(a.cliente_nome||'').localeCompare(String(b.cliente_nome||''),'pt-BR'))
    }));

    return res.json({meses:resultado.reverse(),totais,receitaAntecipada,aReceber,mesAtual:mesHoje});
  }

  // ─── CONFIGURAÇÕES ────────────────────────────────────────────
  if (url === '/configuracoes') {
    if (req.method === 'GET') {
      const { data } = await sb.from('configuracoes').select('*');
      const cfg = {}; data.forEach(r=>cfg[r.chave]=r.valor);
      for (const [k,v] of Object.entries(MSG_LEMBRETE_PADRAO)) if (!cfg[`msg_r_${k}`]) cfg[`msg_r_${k}`]=v;
      return res.json(cfg);
    }
    if (req.method === 'PUT') {
      for (const [chave,valor] of Object.entries(body))
        await sb.from('configuracoes').upsert({ chave, valor });
      return res.json({ ok:true });
    }
  }

  // ─── LEMBRETES DE COBRANÇA (régua) ────────────────────────────
  // Cada cliente tem o dia de vencimento da lista (dia) e, opcionalmente, um
  // dia de cobrança diferente (dia_cobranca).
  //   Mesma data:      2 dias antes · no dia · 2 dias depois (se não pagou)
  //   Datas diferentes: no dia da cobrança · +2 dias · +5 dias (se não pagou)
  // A lista mostra, para a data escolhida, a etapa mais recente de cada mês em
  // aberto que ainda não foi enviada (até 3 dias de atraso, para não perder
  // lembretes se você pular um dia).
  if (url === '/lembretes' && req.method === 'GET') {
    const hoje = /^\d{4}-\d{2}-\d{2}$/.test(params.data||'') ? params.data : hojeBR();
    const mesT = hoje.slice(0,7);
    const meses = [somarMeses(mesT,-2), somarMeses(mesT,-1), mesT, somarMeses(mesT,1)];
    const [cls, mvs, env, cfg] = await Promise.all([
      selectAll('clientes','*', q=>q.eq('status','ativo')),
      selectAll('movimentos_financeiros','id,cliente_id,mes_ref,status,valor,vencimento,tipo_movimento', q=>q.in('mes_ref',meses).neq('status','cancelado')),
      tabelaOpcional('lembretes_enviados','chave,enviado_em', q=>q.in('mes_ref',meses)),
      sb.from('configuracoes').select('chave,valor')
    ]);
    if (env.faltaTabela) return err(res,'Rode o arquivo MIGRACAO_LEMBRETES.sql no Supabase para usar os lembretes.');
    const conf={}; (cfg.data||[]).forEach(r=>conf[r.chave]=r.valor);
    const enviados=new Set(env.data.map(r=>r.chave));
    const porCli=new Map();
    for (const m of (mvs.data||[])) { if(!porCli.has(m.cliente_id)) porCli.set(m.cliente_id,[]); porCli.get(m.cliente_id).push(m); }
    const somaDias=(d,n)=>{ const x=new Date(d+'T12:00:00Z'); x.setUTCDate(x.getUTCDate()+n); return x.toISOString().slice(0,10); };
    const diff=(a,b)=>Math.round((new Date(a+'T12:00:00Z')-new Date(b+'T12:00:00Z'))/86400000);
    const dataNoMes=(mr,dia)=>{ const [a,m]=mr.split('-').map(Number); return `${mr}-${pad(Math.min(dia, diasNoMes(m,a)))}`; };
    const itens=[];
    for (const c of (cls.data||[])) {
      const diaV=parseInt(c.dia)||1;
      const diaC=parseInt(c.dia_cobranca)||diaV;
      const mesma=diaC===diaV;
      const movsC=porCli.get(c.id)||[];
      for (const mr of meses) {
        const doMes=movsC.filter(m=>m.mes_ref===mr);
        if (doMes.some(m=>m.status==='pago')) continue;               // já pago
        const mov=doMes.find(m=>m.status==='pendente'||m.status==='vencido');
        if (!mov && mr<mesT) continue;                                // mês passado sem cobrança = não estava ativo
        const venc=dataNoMes(mr,diaV), cob=dataNoMes(mr,diaC);
        const etapas = mesma
          ? [{ etapa:'antes', d:somaDias(venc,-2) }, { etapa:'dia', d:venc }, { etapa:'atraso2', d:somaDias(venc,2) }]
          : [{ etapa:'cobranca', d:cob }, { etapa:'atraso2', d:somaDias(cob,2) }, { etapa:'atraso5', d:somaDias(cob,5) }];
        let k=-1; etapas.forEach((e,i)=>{ if(e.d<=hoje) k=i; });
        if (k<0) continue;
        const atual=etapas[k];
        if (diff(hoje,atual.d)>3) continue;
        const chaveDe=e=>`${c.id}|${mr}|${e.etapa}`;
        if (etapas.slice(k).some(e=>enviados.has(chaveDe(e)))) continue;
        const valor=Number(mov?.valor ?? c.valor ?? 0);
        const ref = mesma ? venc : cob;
        const diasAtraso=Math.max(0,diff(hoje,ref));
        const tpl = conf[`msg_r_${mesma?'mesma':'dif'}_${atual.etapa}`] || MSG_LEMBRETE_PADRAO[`${mesma?'mesma':'dif'}_${atual.etapa}`];
        const mensagem=String(tpl||'')
          .replace(/{nome}/g, primeiroNome(c.nome)).replace(/{nome_completo}/g, c.nome)
          .replace(/{valor}/g, fmtValor(valor)).replace(/{vencimento}/g, fmtData(venc)).replace(/{cobranca}/g, fmtData(cob))
          .replace(/{mes}/g, nomeMes(mr)).replace(/{servidor}/g, c.servidor||'').replace(/{pix}/g, conf.pix||'')
          .replace(/{dias}/g, String(diasAtraso));
        itens.push({ chave:chaveDe(atual), cliente_id:c.id, cliente_nome:c.nome, servidor:c.servidor||'', celular:(c.celular||'').replace(/\D/g,''),
          mes_ref:mr, etapa:atual.etapa, mesma_data:mesma, data_etapa:atual.d, atrasado:atual.d<hoje,
          vencimento:venc, cobranca:cob, valor, dias_atraso:diasAtraso, gerada:!!mov, mov_id:mov?.id||null, mensagem });
      }
    }
    const ordem={antes:0,cobranca:1,dia:1,atraso2:2,atraso5:3};
    itens.sort((a,b)=>(ordem[a.etapa]-ordem[b.etapa]) || a.cliente_nome.localeCompare(b.cliente_nome,'pt-BR'));
    return res.json({ data:hoje, itens });
  }
  if (url === '/lembretes/enviado' && req.method === 'POST') {
    const { chave, cliente_id, mes_ref, etapa, desfazer } = body;
    if (!chave) return err(res,'Chave obrigatória');
    if (desfazer) { await sb.from('lembretes_enviados').delete().eq('chave',chave); return res.json({ ok:true }); }
    const { error } = await sb.from('lembretes_enviados').upsert({ chave, cliente_id, mes_ref, etapa, enviado_em:new Date().toISOString() },{ onConflict:'chave' });
    if (error) return err(res, /lembretes_enviados/.test(error.message)?'Rode o arquivo MIGRACAO_LEMBRETES.sql no Supabase.':error.message, 500);
    return res.json({ ok:true });
  }

  // ─── WHATSAPP ─────────────────────────────────────────────────
  if (url.match(/^\/whatsapp\/[^/]+$/)) {
    await marcarVencidos();
    const id = url.split('/')[2];
    const { data:cliente } = await sb.from('clientes').select('*').eq('id',id).single();
    if (!cliente) return err(res,'Cliente não encontrado',404);
    const tipo = params.tipo||'pendente';
    const { data:parcelas } = await sb.from('movimentos_financeiros').select('*').eq('cliente_id',id).eq('status',tipo==='vencido'?'vencido':'pendente').order('vencimento');
    if (!parcelas.length) return res.json({ vazio:true, tipo });
    const total = parcelas.reduce((s,c)=>s+parseFloat(c.valor),0);
    const lista = parcelas.map((c,i)=>`  ${i+1}. Venc. ${fmtData(c.vencimento)} — R$ ${fmtValor(c.valor)}`).join('\n');
    const { data:cfgRow } = await sb.from('configuracoes').select('valor').eq('chave',`msg_${tipo}`).single();
    const { data:pixRow } = await sb.from('configuracoes').select('valor').eq('chave','pix').single();
    const mensagem = (cfgRow?.valor||'')
      .replace(/{nome}/g,cliente.nome).replace(/{qtd}/g,String(parcelas.length))
      .replace(/{total}/g,fmtValor(total)).replace(/{lista}/g,lista)
      .replace(/{servidor}/g,cliente.servidor).replace(/{pix}/g,pixRow?.valor||'');
    return res.json({ mensagem, tel:(cliente.celular||'').replace(/\D/g,''), tipo, qtd:parcelas.length, total });
  }

  // ─── TIPOS RECEITA ────────────────────────────────────────────
  if (url === '/tipos-receita') {
    if (req.method === 'GET') { const { data } = await sb.from('tipos_receita').select('*').order('nome'); return res.json(data); }
    if (req.method === 'POST') {
      if (!body.nome) return err(res,'Nome obrigatório');
      const { data, error } = await sb.from('tipos_receita').insert({ id:uid(), nome:body.nome.trim(), criado:new Date().toISOString() }).select().single();
      if (error) return err(res,'Tipo já existe');
      return res.json(data);
    }
  }
  if (url.match(/^\/tipos-receita\/[^/]+$/)) {
    const id=url.split('/')[2];
    if (req.method==='PUT') { const { data }=await sb.from('tipos_receita').update({ nome:body.nome.trim() }).eq('id',id).select().single(); return res.json(data); }
    if (req.method==='DELETE') { await sb.from('tipos_receita').delete().eq('id',id); return res.json({ ok:true }); }
  }

  // ─── TIPOS DESPESA ────────────────────────────────────────────
  if (url === '/tipos-despesa') {
    if (req.method === 'GET') { const { data } = await sb.from('tipos_despesa').select('*').order('nome'); return res.json(data); }
    if (req.method === 'POST') {
      if (!body.nome) return err(res,'Nome obrigatório');
      const { data, error } = await sb.from('tipos_despesa').insert({ id:uid(), nome:body.nome.trim(), criado:new Date().toISOString() }).select().single();
      if (error) return err(res,'Tipo já existe');
      return res.json(data);
    }
  }
  if (url.match(/^\/tipos-despesa\/[^/]+$/)) {
    const id=url.split('/')[2];
    if (req.method==='PUT') { const { data }=await sb.from('tipos_despesa').update({ nome:body.nome.trim() }).eq('id',id).select().single(); return res.json(data); }
    if (req.method==='DELETE') { await sb.from('tipos_despesa').delete().eq('id',id); return res.json({ ok:true }); }
  }

  // ─── OUTRAS VENDAS ────────────────────────────────────────────
  if (url === '/outras-vendas') {
    if (req.method === 'GET') {
      let q = sb.from('outras_vendas').select('*').order('data',{ascending:false});
      if (params.mes_ref)  q = q.eq('mes_ref',params.mes_ref);
      if (params.tipo_rec) q = q.eq('tipo_rec',params.tipo_rec);
      if (params.de)       q = q.gte('data',params.de);
      if (params.ate)      q = q.lte('data',params.ate);
      if (params.busca)    q = q.or(`cliente.ilike.%${params.busca}%,produto.ilike.%${params.busca}%,tipo_rec.ilike.%${params.busca}%`);
      const { data } = await q;
      return res.json(data);
    }
    if (req.method === 'POST') {
      let { data:dt, tipo_rec, cliente, produto, valor_un, qtde, total } = body;
      if (dt?.includes('/')) { const [d,m,a]=dt.split('/'); dt=`${a}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
      const { data } = await sb.from('outras_vendas').insert({ id:uid(), data:dt, tipo_rec:tipo_rec.trim(), cliente:cliente.trim(), produto:(produto||'').trim(), valor_un:parseFloat(valor_un), qtde:parseInt(qtde)||1, total:parseFloat(total), mes_ref:dt.slice(0,7), criado:new Date().toISOString() }).select().single();
      return res.json(data);
    }
  }
  if (url === '/outras-vendas/resumo') {
    let q = sb.from('outras_vendas').select('*');
    if (params.de) q=q.gte('data',params.de);
    if (params.ate) q=q.lte('data',params.ate);
    const { data:rows } = await q;
    const totalGeral=rows.reduce((s,r)=>s+parseFloat(r.total),0);
    const porTipo={}, porMes={};
    rows.forEach(r=>{ porTipo[r.tipo_rec]=porTipo[r.tipo_rec]||{qtd:0,total:0}; porTipo[r.tipo_rec].qtd++; porTipo[r.tipo_rec].total+=parseFloat(r.total); porMes[r.mes_ref]=porMes[r.mes_ref]||{qtd:0,total:0}; porMes[r.mes_ref].qtd++; porMes[r.mes_ref].total+=parseFloat(r.total); });
    return res.json({ total:totalGeral, qtd:rows.length, porTipo, porMes });
  }
  if (url === '/outras-vendas/tipos') { const { data }=await sb.from('tipos_receita').select('nome').order('nome'); return res.json(data.map(r=>r.nome)); }
  if (url === '/outras-vendas/meses') { const { data }=await sb.from('outras_vendas').select('mes_ref').order('mes_ref',{ascending:false}); return res.json([...new Set(data.map(r=>r.mes_ref))]); }
  if (url === '/outras-vendas/limpar' && req.method==='DELETE') { await sb.from('outras_vendas').delete().neq('id','_'); return res.json({ ok:true }); }
  if (url === '/outras-vendas/importar' && req.method==='POST') {
    const { registros=[] } = body;
    let importados=0, ignorados=0, erros=[];
    for (const r of registros) {
      try {
        let dt=r.data||'';
        if (dt.includes('/')) { const p=dt.split('/'); dt=`${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) { erros.push(`Data inválida: ${r.data}`); continue; }
        const valorUn=parseFloat(String(r.valor_un||'0').replace(/[^0-9,.-]/g,'').replace(',','.'))||0;
        const total=parseFloat(String(r.total||'0').replace(/[^0-9,.-]/g,'').replace(',','.'))||0;
        const tipoRec=String(r.tipo_rec||'').trim(), cliente=String(r.cliente||'').trim(), produto=String(r.produto||'').trim();
        const { data:dup }=await sb.from('outras_vendas').select('id').eq('data',dt).eq('tipo_rec',tipoRec).eq('cliente',cliente).eq('produto',produto).eq('total',total).maybeSingle();
        if (dup) { ignorados++; continue; }
        if (tipoRec) await sb.from('tipos_receita').upsert({ id:uid(), nome:tipoRec, criado:new Date().toISOString() },{ onConflict:'nome', ignoreDuplicates:true });
        await sb.from('outras_vendas').insert({ id:uid(), data:dt, tipo_rec:tipoRec, cliente, produto, valor_un:valorUn, qtde:parseInt(r.qtde)||1, total, mes_ref:dt.slice(0,7), criado:new Date().toISOString() });
        importados++;
      } catch(e) { erros.push(e.message); }
    }
    return res.json({ ok:true, importados, ignorados, erros });
  }
  if (url.match(/^\/outras-vendas\/[^/]+$/)) {
    const id=url.split('/')[2];
    if (req.method==='GET') { const { data }=await sb.from('outras_vendas').select('*').eq('id',id).single(); return data ? res.json(data) : err(res,'Não encontrado',404); }
    if (req.method==='PUT') { let { data:dt,...rest }=body; if(dt?.includes('/')) { const p=dt.split('/'); dt=`${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; } const { data }=await sb.from('outras_vendas').update({ data:dt, tipo_rec:rest.tipo_rec, cliente:rest.cliente, produto:rest.produto, valor_un:parseFloat(rest.valor_un), qtde:parseInt(rest.qtde)||1, total:parseFloat(rest.total), mes_ref:dt.slice(0,7) }).eq('id',id).select().single(); return res.json(data); }
    if (req.method==='DELETE') { await sb.from('outras_vendas').delete().eq('id',id); return res.json({ ok:true }); }
  }

  // ─── DESPESAS ─────────────────────────────────────────────────
  if (url === '/despesas') {
    if (req.method === 'GET') {
      let q = sb.from('despesas').select('*').order('data',{ascending:false});
      if (params.mes_ref) q=q.eq('mes_ref',params.mes_ref);
      if (params.tipo)    q=q.eq('tipo',params.tipo);
      if (params.de)      q=q.gte('data',params.de);
      if (params.ate)     q=q.lte('data',params.ate);
      if (params.busca)   q=q.or(`responsavel.ilike.%${params.busca}%,descricao.ilike.%${params.busca}%,tipo.ilike.%${params.busca}%`);
      const { data } = await q;
      return res.json(data);
    }
    if (req.method === 'POST') {
      let { data:dt, tipo, responsavel, descricao, valor_un, qtde, total, meses_cobertos } = body;
      if (dt?.includes('/')) { const [d,m,a]=dt.split('/'); dt=`${a}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
      const { data, error } = await gravarDespesa('insert', { id:uid(), data:dt, tipo:tipo.trim(), responsavel:normalizarServidor((responsavel||'').trim())||'', descricao:(descricao||'').trim(), valor_un:parseFloat(valor_un), qtde:parseInt(qtde)||1, total:parseFloat(total), mes_ref:dt.slice(0,7), meses_cobertos:mesesCobertos(meses_cobertos), criado:new Date().toISOString() });
      if (error) return err(res, `Erro ao salvar despesa: ${error.message}`, 500);
      return res.json(data);
    }
  }
  if (url === '/despesas/resumo') {
    let q = sb.from('despesas').select('*');
    if (params.de) q=q.gte('data',params.de);
    if (params.ate) q=q.lte('data',params.ate);
    const { data:rows } = await q;
    const totalGeral=rows.reduce((s,r)=>s+parseFloat(r.total),0);
    const porTipo={}, porMes={};
    rows.forEach(r=>{ porTipo[r.tipo]=porTipo[r.tipo]||{qtd:0,total:0}; porTipo[r.tipo].qtd++; porTipo[r.tipo].total+=parseFloat(r.total); porMes[r.mes_ref]=porMes[r.mes_ref]||{qtd:0,total:0}; porMes[r.mes_ref].qtd++; porMes[r.mes_ref].total+=parseFloat(r.total); });
    return res.json({ total:totalGeral, qtd:rows.length, porTipo, porMes });
  }
  if (url === '/despesas/tipos') { const { data }=await sb.from('tipos_despesa').select('nome').order('nome'); return res.json(data.map(r=>r.nome)); }
  if (url === '/despesas/limpar' && req.method==='DELETE') { await sb.from('despesas').delete().neq('id','_'); return res.json({ ok:true }); }
  if (url === '/despesas/importar' && req.method==='POST') {
    const { registros=[] } = body;
    let importados=0, ignorados=0, erros=[];
    for (const r of registros) {
      try {
        let dt=r.data||'';
        if (dt.includes('/')) { const p=dt.split('/'); dt=`${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; }
        if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dt)) { erros.push(`Data inválida: ${r.data}`); continue; }
        const valorUn=parseFloat(String(r.valor_un||'0').replace(/[^0-9,.-]/g,'').replace(',','.'))||0;
        const total=parseFloat(String(r.total||'0').replace(/[^0-9,.-]/g,'').replace(',','.'))||0;
        const tipo=String(r.tipo||'').trim(), responsavel=String(r.responsavel||'').trim();
        const { data:dup }=await sb.from('despesas').select('id').eq('data',dt).eq('tipo',tipo).eq('responsavel',responsavel).eq('total',total).maybeSingle();
        if (dup) { ignorados++; continue; }
        if (tipo) await sb.from('tipos_despesa').upsert({ id:uid(), nome:tipo, criado:new Date().toISOString() },{ onConflict:'nome', ignoreDuplicates:true });
        await sb.from('despesas').insert({ id:uid(), data:dt, tipo, responsavel, descricao:String(r.descricao||'').trim(), valor_un:valorUn, qtde:parseInt(r.qtde)||1, total, mes_ref:dt.slice(0,7), criado:new Date().toISOString() });
        importados++;
      } catch(e) { erros.push(e.message); }
    }
    return res.json({ ok:true, importados, ignorados, erros });
  }
  if (url.match(/^\/despesas\/[^/]+$/)) {
    const id=url.split('/')[2];
    if (req.method==='GET') { const { data }=await sb.from('despesas').select('*').eq('id',id).single(); return data ? res.json(data) : err(res,'Não encontrado',404); }
    if (req.method==='PUT') { let { data:dt,...rest }=body; if(dt?.includes('/')) { const p=dt.split('/'); dt=`${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; } const { data, error }=await gravarDespesa('update', { data:dt, tipo:rest.tipo, responsavel:normalizarServidor((rest.responsavel||'').trim())||'', descricao:rest.descricao||'', valor_un:parseFloat(rest.valor_un), qtde:parseInt(rest.qtde)||1, total:parseFloat(rest.total), mes_ref:dt.slice(0,7), meses_cobertos:mesesCobertos(rest.meses_cobertos) }, id); if(error) return err(res, `Erro ao salvar despesa: ${error.message}`, 500); return res.json(data); }
    if (req.method==='DELETE') { await sb.from('despesas').delete().eq('id',id); return res.json({ ok:true }); }
  }

  // ─── LIMPEZA GERAL ────────────────────────────────────────────
  if (url === '/limpar-clientes-cobrancas' && req.method==='DELETE') {
    await sb.from('movimentos_financeiros').delete().neq('id','_');
    await sb.from('clientes').delete().neq('id','_');
    await sb.from('servidores').delete().neq('id','_');
    return res.json({ ok:true });
  }

  // ─── NORMALIZAR SERVIDORES ────────────────────────────────────
  if (url === '/normalizar-servidores' && req.method==='POST') {
    const { data:clientes } = await sb.from('clientes').select('id,servidor');
    let atualizados=0;
    for (const c of clientes) {
      const norm=normalizarServidor(c.servidor);
      if (norm!==c.servidor) { await sb.from('clientes').update({ servidor:norm }).eq('id',c.id); atualizados++; }
    }
    const { data:cobs } = await selectAll('movimentos_financeiros','id,servidor');
    for (const c of cobs) { const norm=normalizarServidor(c.servidor); if (norm!==c.servidor) await sb.from('movimentos_financeiros').update({ servidor:norm }).eq('id',c.id); }
    return res.json({ ok:true, clientes_atualizados:atualizados });
  }

  // ─── IMPORTAR CLIENTES + HISTÓRICO ────────────────────────────
  // A planilha tem 12 blocos (DATA/Recebido/Desc/Pontos/Valor) e cada bloco
  // é UM MÊS DE REFERÊNCIA do ano da planilha: bloco 1 = Janeiro, bloco 2 =
  // Fevereiro ... bloco 12 = Dezembro. A coluna DATA do bloco é o dia em que
  // aquele mês foi pago (pode ser antecipado, ex.: 6 meses pagos no mesmo dia).
  //   mes_ref    = ano_referencia + número do bloco  (competência)
  //   vencimento = ano_referencia + bloco + dia de vencimento do cliente
  //   pago_em    = DATA do bloco                        (caixa)
  if (url === '/importar-clientes-historico' && req.method==='POST') {
    const { texto } = body;
    // ano_pagamentos é aceito apenas por compatibilidade com o frontend antigo.
    const anoRef = Number(body.ano_referencia || body.ano_pagamentos || new Date().getFullYear());
    if (!Number.isInteger(anoRef) || anoRef < 2000 || anoRef > 2100) return err(res,'Ano de referência inválido');
    const ORIGENS_IMPORTACAO=['importacao_historico','importacao_complementar_2026','importacao_planilha'];
    const hojeISO=new Date().toISOString().slice(0,10);
    const ORIGENS_LEGADO=['importacao_historico','importacao_complementar_2026'];
    if (!texto?.trim()) return err(res,'Texto vazio');

    const pad2=n=>String(n).padStart(2,'0');
    const parseValor=s=>{
      if (s==null || s==='') return 0;
      const raw=String(s).replace(/R\$\s?/g,'').replace(/\s/g,'').trim();
      if (!raw || raw==='-') return 0;
      return parseFloat(raw.replace(/\./g,'').replace(',','.'))||0;
    };
    const parseDataBR=s=>{
      if(!s) return null;
      s=String(s).trim();
      const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return m ? `${m[3]}-${pad2(m[2])}-${pad2(m[1])}` : null;
    };

    const linhasBrutas=texto.split(/\r?\n/).map(l=>l.replace(/\r/g,'')).filter(l=>l.trim());
    let headerIdx=-1;
    for(let i=0;i<Math.min(linhasBrutas.length,5);i++) {
      const low=linhasBrutas[i].toLowerCase();
      if(low.includes('cliente')&&low.includes('ativ')) { headerIdx=i; break; }
    }
    const dataLinhas=(headerIdx>=0 ? linhasBrutas.slice(headerIdx+1) : linhasBrutas)
      .filter(l=>l.trim() && !(/^data\b/i.test(l.trim()) && /recebido/i.test(l)));

    let clientesNovos=0, clientesAtualizados=0;
    let totalRecebimentos=0, totalRecebimentosComData=0, totalRecebimentosSemData=0, totalValorRecebido=0;
    let processados=[];
    let erros=[];

    // ── Helpers compartilhados (lote e linha a linha) ──────────────
    const lerLinha=(linha)=>{
      const cols=linha.split('\t');
      if(cols.length<6) throw new Error(`Linha com apenas ${cols.length} colunas; esperado pelo menos 6`);
      const nomeRaw=(cols[0]||'').trim();
      if(!nomeRaw) throw new Error('Nome do cliente vazio');
      const ativoRaw=(cols[1]||'').trim().toLowerCase();
      return {
        cols, nomeRaw,
        servidorFinal:normalizarServidor((cols[2]||'').trim())||'',
        valorMensal:parseValor(cols[3]),
        dia:parseInt(cols[4],10)||1,
        obs:(cols[5]||'').trim(),
        status:ativoRaw==='sim'?'ativo':'inativo'
      };
    };

    const montarMovimentos=(info, cliente)=>{
      const { cols, nomeRaw, servidorFinal, valorMensal, dia }=info;
      const movimentos=[];
      let blocoStart=6, bloco=0;
      while(blocoStart+4<cols.length && bloco<12) {
        bloco++;
        const dataStr=(cols[blocoStart]||'').trim();
        const recebidoStr=(cols[blocoStart+1]||'').trim().toLowerCase();
        const descStr=(cols[blocoStart+2]||'').trim();
        const pontos=parseInt(cols[blocoStart+3],10)||0;
        const valorStr=(cols[blocoStart+4]||'').trim();
        blocoStart+=5;

        // Recebido = Sim  → mês pago
        // Recebido = Não  → mês em aberto (gera cobrança pendente/vencida)
        // vazio ou "-"    → cliente não estava ativo no mês: não gera nada
        const pago = recebidoStr==='sim' || recebidoStr==='s';
        const emAberto = ['não','nao','n'].includes(recebidoStr);
        if(!pago && !emAberto) continue;

        const mesRefA=`${anoRef}-${pad2(bloco)}`;
        const diaVencA=Math.min(dia, diasNoMes(bloco, anoRef));
        if(emAberto){
          const venc=`${mesRefA}-${pad2(diaVencA)}`;
          movimentos.push({
            id:`mov_${cliente.id}_${anoRef}${pad2(bloco)}`,
            cliente_id:cliente.id, cliente_nome:nomeRaw, servidor:servidorFinal,
            valor:parseValor(valorStr)||valorMensal||0, vencimento:venc, mes_ref:mesRefA,
            status: venc < hojeISO ? 'vencido' : 'pendente',
            pago_em:null, valor_pago:null, desconto:0, obs_pagamento:'',
            tipo_movimento:'mensalidade', pontos, bloco_origem:bloco,
            origem:'importacao_planilha', criado:new Date().toISOString()
          });
          continue;
        }

        const dataISO=parseDataBR(dataStr);
        const valorRecebido=parseValor(valorStr);
        const desconto=parseValor(descStr);
        const valorOriginal=desconto>0 ? valorRecebido+desconto : Math.max(valorMensal||0, valorRecebido);
        const mesRef=`${anoRef}-${pad2(bloco)}`;
        const diaVenc=Math.min(dia, diasNoMes(bloco, anoRef));
        movimentos.push({
          // ID determinístico: reimportar a mesma planilha atualiza, não duplica.
          id:`mov_${cliente.id}_${anoRef}${pad2(bloco)}`,
          cliente_id:cliente.id, cliente_nome:nomeRaw, servidor:servidorFinal,
          valor:valorOriginal, vencimento:`${mesRef}-${pad2(diaVenc)}`, mes_ref:mesRef,
          status:'pago', pago_em:dataISO, valor_pago:valorRecebido, desconto,
          obs_pagamento:descStr, tipo_movimento:'mensalidade', pontos, bloco_origem:bloco,
          origem:'importacao_planilha', criado:new Date().toISOString()
        });
      }
      return movimentos;
    };

    // Registros antigos que representam a MESMA linha da planilha (cliente +
    // bloco + data de pagamento) são apagados e substituídos. Cobranças em
    // aberto de meses que a planilha mostra como pagos são removidas/canceladas.
    // Também decide quais meses "em aberto" da planilha devem mesmo virar
    // cobrança: se o mês já está pago no sistema (ex.: baixado pelo site
    // depois que a planilha foi feita), a cobrança em aberto NÃO é criada e
    // o pagamento existente nunca é sobrescrito.
    const planejarLimpeza=(antigos, movimentos)=>{
      const apagar=[], cancelar=[];
      if(!movimentos.length) return {apagar,cancelar,movimentos};
      antigos=antigos||[];
      const pagos=movimentos.filter(m=>m.status==='pago');
      const chaves=new Set(pagos.map(m=>`${m.bloco_origem}|${m.pago_em||''}`));
      // Só os registros do formato ANTIGO (mes_ref = mês do pagamento) são
      // casados por bloco + data. Os do formato novo têm ID por mês e não
      // podem ser apagados por coincidência de data entre planilhas de anos diferentes.
      const ehAntigoSubstituido=a=>ORIGENS_LEGADO.includes(a.origem) && a.status==='pago' &&
        chaves.has(`${a.bloco_origem}|${a.pago_em ? String(a.pago_em).slice(0,10) : ''}`);

      // Meses já pagos no sistema que esta importação NÃO vai substituir.
      const idsPagosNovos=new Set(pagos.map(m=>m.id));
      const mesesPagosSistema=new Set(antigos
        .filter(a=>a.status==='pago' && !idsPagosNovos.has(a.id) && !ehAntigoSubstituido(a))
        .map(a=>a.mes_ref));
      const finais=movimentos.filter(m=>m.status==='pago' || !mesesPagosSistema.has(m.mes_ref));

      const idsNovos=new Set(finais.map(m=>m.id));
      const mesesCobertos=new Set(finais.map(m=>m.mes_ref));
      for(const a of antigos){
        if(idsNovos.has(a.id)) continue;
        if(ehAntigoSubstituido(a)) { apagar.push(a.id); continue; }
        // Outra cobrança em aberto do mesmo mês (ex.: "gerar cobranças do mês")
        // seria duplicada pela linha da planilha: remove/cancela.
        if(['pendente','vencido'].includes(a.status) && mesesCobertos.has(a.mes_ref)) {
          if(a.origem==='geracao_mensal' || !a.origem) apagar.push(a.id); else cancelar.push(a.id);
        }
      }
      return {apagar,cancelar,movimentos:finais};
    };

    let totalEmAberto=0;
    const contarMovimentos=(movimentos)=>{
      for(const m of movimentos){
        if(m.status!=='pago'){ totalEmAberto++; continue; }
        totalRecebimentos++;
        totalValorRecebido+=Number(m.valor_pago||0);
        if(m.pago_em) totalRecebimentosComData++; else totalRecebimentosSemData++;
      }
    };

    const emPartes=(arr,n)=>{ const out=[]; for(let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out; };

    // Planilha de ano anterior (ex.: 2025 importada em 2026) não altera o
    // cadastro atual dos clientes (servidor, valor, dia, status): só traz os
    // pagamentos. Clientes que não existirem são criados normalmente.
    const atualizarCadastro = anoRef >= new Date().getFullYear();

    // ── Caminho rápido: o lote inteiro em poucas chamadas ao Supabase ──
    const importarEmLote=async(linhas, offset=0)=>{
      const itens=[];
      linhas.forEach((linha,i)=>{
        try { itens.push({ ...lerLinha(linha), indice:offset+i+1 }); }
        catch(e){ erros.push({indice:offset+i+1,nome:(linha.split('\t')[0]||'').trim(),mensagem:e.message}); }
      });
      if(!itens.length) return;

      // 1) Servidores
      const servidores=[...new Set(itens.map(it=>it.servidorFinal).filter(Boolean))];
      if(servidores.length){
        const { error } = await sb.from('servidores').upsert(
          servidores.map(nome=>({ id:uid(), nome, criado:new Date().toISOString() })),
          { onConflict:'nome', ignoreDuplicates:true });
        if(error) throw error;
      }

      // 2) Clientes: apelidos (de clientes juntados) + nome exato
      const nomes=[...new Set(itens.map(it=>it.nomeRaw))];
      const apelidos=await carregarApelidos(nomes);          // nome -> cliente_id
      const existentes=[];
      for(const parte of emPartes(nomes,100)){
        const { data, error } = await sb.from('clientes').select('*').in('nome',parte);
        if(error) throw error;
        existentes.push(...(data||[]));
      }
      const idsApelido=[...new Set(Object.values(apelidos))].filter(id=>!existentes.some(c=>c.id===id));
      for(const parte of emPartes(idsApelido,100)){
        const { data, error } = await sb.from('clientes').select('*').in('id',parte);
        if(error) throw error;
        existentes.push(...(data||[]));
      }
      const porId=new Map(existentes.map(c=>[c.id,c]));
      const porNomeServ=new Map(existentes.map(c=>[`${c.nome}|||${c.servidor||''}`,c]));
      const porNome=new Map();
      for(const c of existentes){ if(!porNome.has(c.nome)) porNome.set(c.nome,[]); porNome.get(c.nome).push(c); }

      // 3) Monta clientes (novos + atualizados)
      const gravar=new Map(); const vistos=new Map();
      for(const it of itens){
        const chave=`${it.nomeRaw}|||${it.servidorFinal}`;
        let base=vistos.get(chave)
          || (apelidos[it.nomeRaw] && (gravar.get(apelidos[it.nomeRaw]) || porId.get(apelidos[it.nomeRaw])))
          || porNomeServ.get(chave);
        if(!base){
          // Mesmo nome com outro servidor: se só existe um, é o mesmo cliente.
          const mesmos=porNome.get(it.nomeRaw)||[];
          if(mesmos.length===1) base=gravar.get(mesmos[0].id)||mesmos[0];
        }
        let cliente;
        if(base){
          if(atualizarCadastro){
            cliente={ ...base, servidor:it.servidorFinal, dia:it.dia, valor:it.valorMensal||base.valor||0, status:it.status, obs:it.obs };
            gravar.set(cliente.id,cliente);
          } else cliente=base;
          if(!vistos.has(chave)) clientesAtualizados++;
        } else {
          cliente={ id:uid()+Math.random().toString(36).slice(2,5), nome:it.nomeRaw, celular:'', servidor:it.servidorFinal, dia:it.dia, valor:it.valorMensal||0, status:it.status, obs:it.obs, criado:new Date().toISOString() };
          gravar.set(cliente.id,cliente);
          clientesNovos++;
        }
        vistos.set(chave,cliente);
        it.cliente=cliente;
      }
      for(const parte of emPartes([...gravar.values()],200)){
        const { error } = await sb.from('clientes').upsert(parte,{onConflict:'id'});
        if(error) throw error;
      }

      // 4) Movimentos atuais desses clientes
      const ids=[...new Set(itens.map(it=>it.cliente.id))];
      const antigosPorCliente=new Map();
      for(const parte of emPartes(ids,100)){
        const { data, error } = await selectAll('movimentos_financeiros','id,cliente_id,bloco_origem,pago_em,mes_ref,status,origem',q=>q.in('cliente_id',parte).order('id'));
        if(error) throw error;
        for(const m of data){ if(!antigosPorCliente.has(m.cliente_id)) antigosPorCliente.set(m.cliente_id,[]); antigosPorCliente.get(m.cliente_id).push(m); }
      }

      // 5) Planeja em memória. Dois clientes do lote podem ser o mesmo
      //    (apelido/nome): agrupa por cliente para a limpeza ver tudo junto.
      const todosMov=[], apagar=[], cancelar=[];
      const porClienteLote=new Map();
      for(const it of itens){
        if(!porClienteLote.has(it.cliente.id)) porClienteLote.set(it.cliente.id,[]);
        porClienteLote.get(it.cliente.id).push(it);
      }
      for(const [cid,its] of porClienteLote){
        const movs=its.flatMap(it=>{ const ms=montarMovimentos(it,it.cliente); ms.forEach(m=>m._it=it); return ms; });
        const plano=planejarLimpeza(antigosPorCliente.get(cid),movs);
        apagar.push(...plano.apagar); cancelar.push(...plano.cancelar);
        todosMov.push(...plano.movimentos);
        for(const it of its) it.movs=plano.movimentos.filter(m=>m._it===it);
      }
      const movUnicos=[...new Map(todosMov.map(m=>{ const { _it, ...limpo }=m; return [m.id,limpo]; })).values()];

      // 6) Grava em blocos grandes
      for(const parte of emPartes([...new Set(apagar)],200)){
        const { error } = await sb.from('movimentos_financeiros').delete().in('id',parte);
        if(error) throw error;
      }
      for(const parte of emPartes([...new Set(cancelar)],200)){
        const { error } = await sb.from('movimentos_financeiros').update({ status:'cancelado' }).in('id',parte);
        if(error) throw error;
      }
      for(const parte of emPartes(movUnicos,500)){
        if(!parte.length) continue;
        const { error } = await sb.from('movimentos_financeiros').upsert(parte,{onConflict:'id'});
        if(error) throw error;
      }

      for(const it of itens){
        contarMovimentos(it.movs);
        processados.push({indice:it.indice,nome:it.nomeRaw,cliente:it.cliente.nome,servidor:it.servidorFinal,status:it.status,recebimentos:it.movs.filter(m=>m.status==='pago').length,emAberto:it.movs.filter(m=>m.status!=='pago').length,valorRecebido:it.movs.reduce((s,m)=>s+Number(m.valor_pago||0),0)});
      }
    };

    let modo='lote';
    try {
      await importarEmLote(dataLinhas,0);
    } catch(eLote) {
      // Tudo é idempotente (IDs fixos), então dá para refazer uma linha por
      // vez com segurança e descobrir exatamente qual cliente tem problema.
      console.error('Importação em lote falhou, usando linha a linha:', eLote?.message);
      modo='linha_a_linha';
      clientesNovos=0; clientesAtualizados=0;
      totalRecebimentos=0; totalEmAberto=0; totalRecebimentosComData=0; totalRecebimentosSemData=0; totalValorRecebido=0;
      processados=[]; erros=[];
      for(let i=0;i<dataLinhas.length;i++){
        try { await importarEmLote([dataLinhas[i]],i); }
        catch(e){ erros.push({indice:i+1,nome:(dataLinhas[i].split('\t')[0]||'').trim(),mensagem:e?.message||String(e)}); }
      }
    }

    return res.json({
      ok:erros.length===0,
      recebidos:dataLinhas.length,
      processados:processados.length,
      falhas:erros.length,
      clientesNovos,
      clientesAtualizados,
      totalRecebimentos,
      totalRecebimentosComData,
      totalRecebimentosSemData,
      totalValorRecebido:Number(totalValorRecebido.toFixed(2)),
      anoReferencia:anoRef,
      totalEmAberto,
      modo,
      processadosDetalhes:processados,
      erros
    });
  }

  return res.status(404).json({ erro: 'Rota não encontrada', url });
}
