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
      const { data } = await sb.from('clientes').insert({
        id:uid(), nome, celular:celular||'', servidor:normalizarServidor(servidor)||'',
        dia:parseInt(dia), valor:parseFloat(valor), status:status||'ativo', obs:obs||'',
        criado:new Date().toISOString()
      }).select().single();
      return res.json(data);
    }
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
      const { nome, celular, servidor, dia, valor, status, obs } = body;
      const { data } = await sb.from('clientes').update({
        nome, celular:celular||'', servidor:normalizarServidor(servidor)||'',
        dia:parseInt(dia), valor:parseFloat(valor), status, obs:obs||''
      }).eq('id',id).select().single();
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
    if (eMovs) return err(res, `Erro ao carregar financeiro: ${eMovs.message}`, 500);

    const movimentos=movs||[], ovs0=todasOv||[], dps0=todasDp||[];
    const mesesSet = new Set();
    movimentos.forEach(m=>{ if(m.mes_ref) mesesSet.add(m.mes_ref); });
    movimentos.forEach(m=>{ if(m.pago_em) mesesSet.add(String(m.pago_em).slice(0,7)); });
    ovs0.forEach(r=>r.mes_ref && mesesSet.add(r.mes_ref));
    dps0.forEach(r=>r.mes_ref && mesesSet.add(r.mes_ref));

    const resultado=[];
    for(const mr of [...mesesSet].sort()){
      if(de && mr<de) continue;
      if(ate && mr>ate) continue;
      const cobsMes=movimentos.filter(m=>m.mes_ref===mr);
      const recebMes=movimentos.filter(m=>m.status==='pago' && m.valor_pago!=null && m.pago_em && String(m.pago_em).slice(0,7)===mr);
      const recebSemData=movimentos.filter(m=>m.status==='pago' && m.valor_pago!=null && !m.pago_em && m.mes_ref===mr);
      const em_aberto=cobsMes.filter(c=>c.status==='pendente').reduce((s,c)=>s+parseFloat(c.valor||0),0);
      const atrasado=cobsMes.filter(c=>c.status==='vencido').reduce((s,c)=>s+parseFloat(c.valor||0),0);
      const totalCobrancas=cobsMes.reduce((s,c)=>s+parseFloat(c.valor||0),0);
      const recebidoMensalidade=recebMes.reduce((s,r)=>s+parseFloat(r.valor_pago||0),0);
      const porServidor={};
      recebMes.forEach(r=>{
        const srv=r.servidor||'Sem servidor';
        if(!porServidor[srv])porServidor[srv]={qtd:0,valor:0};
        porServidor[srv].qtd++;
        porServidor[srv].valor+=parseFloat(r.valor_pago||0);
      });
      const ovs=ovs0.filter(r=>r.mes_ref===mr);
      const outrasReceitas=ovs.reduce((s,r)=>s+parseFloat(r.total||0),0);
      const dps=dps0.filter(r=>r.mes_ref===mr);
      const totalDespesas=dps.reduce((s,r)=>s+parseFloat(r.total||0),0);
      const receitaTotal=recebidoMensalidade+outrasReceitas;
      const lucroLiquido=receitaTotal-totalDespesas;
      const clientesReceberam=[...new Set(recebMes.map(r=>r.cliente_id))].length;
      resultado.push({
        mes_ref:mr, recebido:recebidoMensalidade, em_aberto, atrasado, total:totalCobrancas,
        outras_receitas:outrasReceitas, despesas:totalDespesas, receita_total:receitaTotal,
        lucro_liquido:lucroLiquido, clientes_ativos:clientesReceberam, por_servidor:porServidor,
        qtd_recebimentos:recebMes.length, qtd_recebimentos_sem_data:recebSemData.length
      });
    }
    const totais=resultado.reduce((acc,r)=>({
      recebido:acc.recebido+r.recebido, em_aberto:acc.em_aberto+r.em_aberto, atrasado:acc.atrasado+r.atrasado,
      total:acc.total+r.total, outras_receitas:acc.outras_receitas+r.outras_receitas, despesas:acc.despesas+r.despesas,
      receita_total:acc.receita_total+r.receita_total, lucro_liquido:acc.lucro_liquido+r.lucro_liquido,
      clientes_ativos:Math.max(acc.clientes_ativos,r.clientes_ativos), qtd_recebimentos:acc.qtd_recebimentos+r.qtd_recebimentos
    }),{recebido:0,em_aberto:0,atrasado:0,total:0,outras_receitas:0,despesas:0,receita_total:0,lucro_liquido:0,clientes_ativos:0,qtd_recebimentos:0});
    return res.json({meses:resultado.reverse(),totais});
  }

  // ─── CONFIGURAÇÕES ────────────────────────────────────────────
  if (url === '/configuracoes') {
    if (req.method === 'GET') {
      const { data } = await sb.from('configuracoes').select('*');
      const cfg = {}; data.forEach(r=>cfg[r.chave]=r.valor);
      return res.json(cfg);
    }
    if (req.method === 'PUT') {
      for (const [chave,valor] of Object.entries(body))
        await sb.from('configuracoes').upsert({ chave, valor });
      return res.json({ ok:true });
    }
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
      let { data:dt, tipo, responsavel, descricao, valor_un, qtde, total } = body;
      if (dt?.includes('/')) { const [d,m,a]=dt.split('/'); dt=`${a}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
      const { data } = await sb.from('despesas').insert({ id:uid(), data:dt, tipo:tipo.trim(), responsavel:(responsavel||'').trim(), descricao:(descricao||'').trim(), valor_un:parseFloat(valor_un), qtde:parseInt(qtde)||1, total:parseFloat(total), mes_ref:dt.slice(0,7), criado:new Date().toISOString() }).select().single();
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
    if (req.method==='PUT') { let { data:dt,...rest }=body; if(dt?.includes('/')) { const p=dt.split('/'); dt=`${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; } const { data }=await sb.from('despesas').update({ data:dt, tipo:rest.tipo, responsavel:rest.responsavel||'', descricao:rest.descricao||'', valor_un:parseFloat(rest.valor_un), qtde:parseInt(rest.qtde)||1, total:parseFloat(rest.total), mes_ref:dt.slice(0,7) }).eq('id',id).select().single(); return res.json(data); }
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
      const ehAntigoSubstituido=a=>ORIGENS_IMPORTACAO.includes(a.origem) && a.status==='pago' &&
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

    // ── Caminho rápido: o lote inteiro em ~7 chamadas ao Supabase ──
    // Antes eram 6 a 8 chamadas POR CLIENTE, uma após a outra.
    const importarEmLote=async()=>{
      const itens=[];
      dataLinhas.forEach((linha,i)=>{
        try { itens.push({ ...lerLinha(linha), indice:i+1 }); }
        catch(e){ erros.push({indice:i+1,nome:(linha.split('\t')[0]||'').trim(),mensagem:e.message}); }
      });
      if(!itens.length) return;

      // 1) Servidores (uma chamada)
      const servidores=[...new Set(itens.map(it=>it.servidorFinal).filter(Boolean))];
      if(servidores.length){
        const { error } = await sb.from('servidores').upsert(
          servidores.map(nome=>({ id:uid(), nome, criado:new Date().toISOString() })),
          { onConflict:'nome', ignoreDuplicates:true });
        if(error) throw error;
      }

      // 2) Clientes existentes com esses nomes (uma chamada por 100 nomes)
      const nomes=[...new Set(itens.map(it=>it.nomeRaw))];
      const existentes=[];
      for(const parte of emPartes(nomes,100)){
        const { data, error } = await sb.from('clientes').select('*').in('nome',parte);
        if(error) throw error;
        existentes.push(...(data||[]));
      }
      const porNomeServ=new Map(existentes.map(c=>[`${c.nome}|||${c.servidor||''}`,c]));
      const porNome=new Map();
      for(const c of existentes){ if(!porNome.has(c.nome)) porNome.set(c.nome,[]); porNome.get(c.nome).push(c); }

      // 3) Monta clientes (novos + atualizados) e grava tudo de uma vez
      const linhasClientes=[]; const vistos=new Map();
      for(const it of itens){
        const chave=`${it.nomeRaw}|||${it.servidorFinal}`;
        let base=vistos.get(chave) || porNomeServ.get(chave);
        if(!base){
          const mesmos=porNome.get(it.nomeRaw)||[];
          if(mesmos.length===1 && !(mesmos[0].servidor||'').trim()) base=mesmos[0];
        }
        let cliente;
        if(base){
          cliente={ ...base, servidor:it.servidorFinal, dia:it.dia, valor:it.valorMensal||base.valor||0, status:it.status, obs:it.obs };
          if(!vistos.has(chave)) clientesAtualizados++;
        } else {
          cliente={ id:uid()+Math.random().toString(36).slice(2,5), nome:it.nomeRaw, celular:'', servidor:it.servidorFinal, dia:it.dia, valor:it.valorMensal||0, status:it.status, obs:it.obs, criado:new Date().toISOString() };
          clientesNovos++;
        }
        vistos.set(chave,cliente);
        it.cliente=cliente;
      }
      for(const c of vistos.values()) linhasClientes.push(c);
      for(const parte of emPartes(linhasClientes,200)){
        const { error } = await sb.from('clientes').upsert(parte,{onConflict:'id'});
        if(error) throw error;
      }

      // 4) Movimentos atuais desses clientes (paginado)
      const ids=[...new Set(itens.map(it=>it.cliente.id))];
      const antigosPorCliente=new Map();
      for(const parte of emPartes(ids,100)){
        const { data, error } = await selectAll('movimentos_financeiros','id,cliente_id,bloco_origem,pago_em,mes_ref,status,origem',q=>q.in('cliente_id',parte).order('id'));
        if(error) throw error;
        for(const m of data){ if(!antigosPorCliente.has(m.cliente_id)) antigosPorCliente.set(m.cliente_id,[]); antigosPorCliente.get(m.cliente_id).push(m); }
      }

      // 5) Planeja tudo em memória
      const todosMov=[], apagar=[], cancelar=[];
      for(const it of itens){
        const plano=planejarLimpeza(antigosPorCliente.get(it.cliente.id),montarMovimentos(it,it.cliente));
        apagar.push(...plano.apagar); cancelar.push(...plano.cancelar);
        todosMov.push(...plano.movimentos);
        it.movs=plano.movimentos;
      }

      // Mesma linha repetida na planilha geraria o mesmo ID duas vezes no
      // mesmo upsert (erro no Postgres). Mantém a última ocorrência.
      const movUnicos=[...new Map(todosMov.map(m=>[m.id,m])).values()];

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
        processados.push({indice:it.indice,nome:it.nomeRaw,servidor:it.servidorFinal,status:it.status,recebimentos:it.movs.filter(m=>m.status==='pago').length,emAberto:it.movs.filter(m=>m.status!=='pago').length,valorRecebido:it.movs.reduce((s,m)=>s+Number(m.valor_pago||0),0)});
      }
    };

    // ── Caminho seguro: linha a linha (usado só se o lote falhar) ──
    const processarLinha = async (linha, numeroLinha) => {
      try {
        const info=lerLinha(linha);
        const { nomeRaw, servidorFinal, valorMensal, dia, obs, status }=info;
        if (servidorFinal) {
          const { error:eSrv } = await sb.from('servidores').upsert(
            { id:uid(), nome:servidorFinal, criado:new Date().toISOString() },
            { onConflict:'nome', ignoreDuplicates:true });
          if(eSrv) throw eSrv;
        }
        let clienteExist=null;
        const buscaExata=await sb.from('clientes').select('*').eq('nome',nomeRaw).eq('servidor',servidorFinal).limit(1);
        if(buscaExata.error) throw buscaExata.error;
        clienteExist=buscaExata.data?.[0]||null;
        if(!clienteExist) {
          const buscaNome=await sb.from('clientes').select('*').eq('nome',nomeRaw).limit(2);
          if(buscaNome.error) throw buscaNome.error;
          if((buscaNome.data||[]).length===1 && !(buscaNome.data[0].servidor||'').trim()) clienteExist=buscaNome.data[0];
        }
        let cliente;
        if(clienteExist) {
          const { data, error:eUpd }=await sb.from('clientes').update({
            servidor:servidorFinal, dia, valor:valorMensal||clienteExist.valor||0, status, obs
          }).eq('id',clienteExist.id).select('*').single();
          if(eUpd) throw eUpd;
          cliente=data; clientesAtualizados++;
        } else {
          const novo={ id:uid(), nome:nomeRaw, celular:'', servidor:servidorFinal, dia, valor:valorMensal||0, status, obs, criado:new Date().toISOString() };
          const { data, error:eIns }=await sb.from('clientes').insert(novo).select('*').single();
          if(eIns) throw eIns;
          cliente=data; clientesNovos++;
        }

        let movimentos=montarMovimentos(info,cliente);
        if(movimentos.length){
          const { data:antigos, error:eAnt } = await sb.from('movimentos_financeiros')
            .select('id,bloco_origem,pago_em,mes_ref,status,origem').eq('cliente_id',cliente.id);
          if(eAnt) throw eAnt;
          const plano=planejarLimpeza(antigos,movimentos);
          const { apagar, cancelar }=plano;
          movimentos=plano.movimentos;
          if(apagar.length){ const { error } = await sb.from('movimentos_financeiros').delete().in('id',apagar); if(error) throw error; }
          if(cancelar.length){ const { error } = await sb.from('movimentos_financeiros').update({ status:'cancelado' }).in('id',cancelar); if(error) throw error; }
          if(movimentos.length){
            const { error:eRec }=await sb.from('movimentos_financeiros').upsert(movimentos,{onConflict:'id'});
            if(eRec) throw eRec;
          }
        }
        contarMovimentos(movimentos);
        return {ok:true,detalhe:{indice:numeroLinha,nome:nomeRaw,servidor:servidorFinal,status,recebimentos:movimentos.filter(m=>m.status==='pago').length,emAberto:movimentos.filter(m=>m.status!=='pago').length,valorRecebido:movimentos.reduce((s,m)=>s+Number(m.valor_pago||0),0)}};
      } catch(e) {
        return {ok:false,erro:{indice:numeroLinha,nome:(linha.split('\t')[0]||'').trim(),mensagem:e?.message||String(e)}};
      }
    };

    let modo='lote';
    try {
      await importarEmLote();
    } catch(eLote) {
      // Tudo é idempotente (IDs fixos), então dá para refazer linha a linha
      // com segurança e descobrir exatamente qual cliente tem problema.
      console.error('Importação em lote falhou, usando linha a linha:', eLote?.message);
      modo='linha_a_linha';
      clientesNovos=0; clientesAtualizados=0;
      totalRecebimentos=0; totalEmAberto=0; totalRecebimentosComData=0; totalRecebimentosSemData=0; totalValorRecebido=0;
      processados=[]; erros=[];
      for(let i=0;i<dataLinhas.length;i++){
        const r=await processarLinha(dataLinhas[i],i+1);
        if(r.ok) processados.push(r.detalhe); else erros.push(r.erro);
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
