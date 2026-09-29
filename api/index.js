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
  await sb.from('cobrancas')
    .update({ status: 'vencido' })
    .eq('status','pendente')
    .lt('vencimento', hoje);
}

function err(res, msg, code=400) {
  return res.status(code).json({ erro: msg });
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
    const { data } = await sb.from('cobrancas').select('*').eq('cliente_id',id).order('vencimento',{ascending:false});
    return res.json(data);
  }
  if (url.match(/^\/clientes\/[^/]+\/parcelas-lote$/)) {
    await marcarVencidos();
    const id = url.split('/')[2];
    const { data:cliente } = await sb.from('clientes').select('*').eq('id',id).single();
    if (!cliente) return err(res,'Cliente não encontrado',404);
    const { data:abertas } = await sb.from('cobrancas').select('*').eq('cliente_id',id).in('status',['pendente','vencido']).order('vencimento');
    const hoje = new Date();
    const futuros = [];
    for (let i=0;i<=12;i++) {
      const d=new Date(hoje.getFullYear(),hoje.getMonth()+i,1);
      const mes=d.getMonth()+1, ano=d.getFullYear(), mr=`${ano}-${pad(mes)}`;
      const { data:existe } = await sb.from('cobrancas').select('id').eq('cliente_id',id).eq('mes_ref',mr).maybeSingle();
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
    let q = sb.from('cobrancas').select('*').order('vencimento');
    if (params.mes_ref) q = q.eq('mes_ref', params.mes_ref);
    if (params.status)  q = q.eq('status', params.status);
    if (params.busca)   q = q.or(`cliente_nome.ilike.%${params.busca}%,servidor.ilike.%${params.busca}%`);
    const { data } = await q;
    return res.json(data);
  }
  if (url === '/cobrancas/meses') {
    const { data:cobs } = await sb.from('cobrancas').select('mes_ref').order('mes_ref',{ascending:false});
    const { data:rec } = await sb.from('recebimentos').select('mes_ref').not('mes_ref','is',null).order('mes_ref',{ascending:false});
    const meses = [...new Set([...(cobs||[]).map(r=>r.mes_ref), ...(rec||[]).map(r=>r.mes_ref)].filter(Boolean))].sort().reverse();
    return res.json(meses);
  }
  if (url === '/cobrancas/inadimplentes') {
    await marcarVencidos();
    const { data } = await sb.from('cobrancas').select('*').eq('status','vencido').order('vencimento');
    return res.json(data);
  }
  if (url === '/cobrancas/gerar' && req.method === 'POST') {
    const agora=new Date(), mes=agora.getMonth()+1, ano=agora.getFullYear(), mesRef=`${ano}-${pad(mes)}`;
    const { data:clientes } = await sb.from('clientes').select('*').eq('status','ativo');
    const { data:existentes } = await sb.from('cobrancas').select('cliente_id').eq('mes_ref',mesRef);
    const jaTem = new Set(existentes.map(r=>r.cliente_id));
    const novos = clientes.filter(c=>!jaTem.has(c.id)).map(c=>{
      const dia=Math.min(c.dia,diasNoMes(mes,ano));
      return { id:uid(), cliente_id:c.id, cliente_nome:c.nome, servidor:c.servidor,
        valor:c.valor, vencimento:`${ano}-${pad(mes)}-${pad(dia)}`, mes_ref:mesRef,
        status:'pendente', criado:new Date().toISOString() };
    });
    if (novos.length) await sb.from('cobrancas').insert(novos);
    return res.json({ novos:novos.length, mesRef });
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
      const { data:exist } = await sb.from('cobrancas').select('*').in('id',ids_existentes).order('vencimento');
      for (const cb of exist) {
        const vp = idx===totalIds-1 ? parseFloat((valor_total-base*(totalIds-1)).toFixed(2)) : base;
        await sb.from('cobrancas').update({ status:'pago', pago_em, valor_pago:vp, obs_pagamento:obs||'' }).eq('id',cb.id);
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
      const { data:nova } = await sb.from('cobrancas').upsert({
        id:novoId, cliente_id, cliente_nome:cliente.nome, servidor:cliente.servidor,
        valor:cliente.valor, vencimento:venc, mes_ref:mr,
        status:'pago', pago_em, valor_pago:vp, obs_pagamento:obs||'', criado:new Date().toISOString()
      }).select().single();
      baixadas.push(nova);
      idx++;
    }
    // Registra o valor efetivamente recebido no caixa. O valor é dividido nas parcelas acima;
    // cada parcela recebe um registro idempotente para não duplicar em reenvios.
    for (const b of baixadas) {
      if (!b) continue;
      await sb.from('recebimentos').upsert({
        id:`rec_cob_${b.id}`, cliente_id:cliente.id, cliente_nome:cliente.nome, servidor:cliente.servidor,
        data_recebimento:pago_em, mes_ref:String(pago_em).slice(0,7),
        valor_original:parseFloat(b.valor||0), desconto:Math.max(0,parseFloat(b.valor||0)-parseFloat(b.valor_pago||0)),
        valor_recebido:parseFloat(b.valor_pago||0), descricao:obs||'', pontos:0, bloco_origem:0,
        origem:'cobranca_pagamento', criado:new Date().toISOString()
      },{onConflict:'id'});
    }
    return res.json({ ok:true, baixadas, total:valor_total });
  }
  if (url.match(/^\/cobrancas\/[^/]+\/pagar$/) && req.method === 'PUT') {
    const id = url.split('/')[2];
    const { pago_em, valor_pago, obs_pagamento, servidor_novo } = body;
    const { data:cb } = await sb.from('cobrancas').select('*').eq('id',id).single();
    if (!cb) return err(res,'Cobrança não encontrada',404);
    const valorPagoNum=parseFloat(valor_pago);
    await sb.from('cobrancas').update({ status:'pago', pago_em, valor_pago:valorPagoNum, obs_pagamento:obs_pagamento||'' }).eq('id',id);
    if (servidor_novo && servidor_novo !== cb.servidor)
      await sb.from('clientes').update({ servidor:servidor_novo }).eq('id',cb.cliente_id);
    const clienteRec=(await sb.from('clientes').select('nome,servidor').eq('id',cb.cliente_id).single()).data;
    await sb.from('recebimentos').upsert({
      id:`rec_cob_${cb.id}`, cliente_id:cb.cliente_id, cliente_nome:clienteRec?.nome||cb.cliente_nome,
      servidor:servidor_novo||clienteRec?.servidor||cb.servidor, data_recebimento:pago_em, mes_ref:String(pago_em).slice(0,7),
      valor_original:parseFloat(cb.valor||0), desconto:Math.max(0,parseFloat(cb.valor||0)-valorPagoNum),
      valor_recebido:valorPagoNum, descricao:obs_pagamento||'', pontos:0, bloco_origem:0,
      origem:'cobranca_pagamento', criado:new Date().toISOString()
    },{onConflict:'id'});
    const { data } = await sb.from('cobrancas').select('*').eq('id',id).single();
    return res.json(data);
  }
  if (url.match(/^\/cobrancas\/[^/]+\/cancelar$/) && req.method === 'PUT') {
    const id = url.split('/')[2];
    await sb.from('cobrancas').update({ status:'cancelado' }).eq('id',id);
    return res.json({ ok:true });
  }

  // ─── DASHBOARD ────────────────────────────────────────────────
  if (url === '/dashboard') {
    await marcarVencidos();
    const hoje = new Date().toISOString().slice(0,10);
    const mesRef = hoje.slice(0,7);
    const { count:ativos } = await sb.from('clientes').select('*',{count:'exact',head:true}).eq('status','ativo');
    const { data:doMes } = await sb.from('cobrancas').select('*').eq('mes_ref',mesRef).order('vencimento');
    const { data:recebMes } = await sb.from('recebimentos').select('id,cliente_id,cliente_nome,servidor,data_recebimento,valor_recebido').eq('mes_ref',mesRef);
    const recebido= (recebMes||[]).reduce((s,r)=>s+parseFloat(r.valor_recebido||0),0);
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
    const { data:todasCobs } = await sb.from('cobrancas').select('*');
    const { data:todosReceb } = await sb.from('recebimentos').select('*').not('mes_ref','is',null);
    const { data:todasOv }   = await sb.from('outras_vendas').select('*');
    const { data:todasDp }   = await sb.from('despesas').select('*');

    const cobs=todasCobs||[], receb=todosReceb||[], ovs0=todasOv||[], dps0=todasDp||[];
    const mesesSet = new Set();
    cobs.forEach(r=>r.mes_ref && mesesSet.add(r.mes_ref));
    receb.forEach(r=>r.mes_ref && mesesSet.add(r.mes_ref));
    ovs0.forEach(r=>r.mes_ref && mesesSet.add(r.mes_ref));
    dps0.forEach(r=>r.mes_ref && mesesSet.add(r.mes_ref));

    const meses = [...mesesSet].sort();
    const resultado=[];
    for(const mr of meses){
      if(de && mr<de) continue;
      if(ate && mr>ate) continue;
      const cobsMes=cobs.filter(c=>c.mes_ref===mr);
      const recebMes=receb.filter(r=>r.mes_ref===mr);
      const em_aberto=cobsMes.filter(c=>c.status==='pendente').reduce((s,c)=>s+parseFloat(c.valor||0),0);
      const atrasado=cobsMes.filter(c=>c.status==='vencido').reduce((s,c)=>s+parseFloat(c.valor||0),0);
      const totalCobrancas=cobsMes.reduce((s,c)=>s+parseFloat(c.valor||0),0);
      const recebidoMensalidade=recebMes.reduce((s,r)=>s+parseFloat(r.valor_recebido||0),0);
      const porServidor={};
      recebMes.forEach(r=>{
        const srv=r.servidor||'Sem servidor';
        if(!porServidor[srv]) porServidor[srv]={qtd:0,valor:0};
        porServidor[srv].qtd++;
        porServidor[srv].valor+=parseFloat(r.valor_recebido||0);
      });
      const ovs=ovs0.filter(r=>r.mes_ref===mr);
      const outrasReceitas=ovs.reduce((s,r)=>s+parseFloat(r.total||0),0);
      const dps=dps0.filter(r=>r.mes_ref===mr);
      const totalDespesas=dps.reduce((s,r)=>s+parseFloat(r.total||0),0);
      const receitaTotal=recebidoMensalidade+outrasReceitas;
      const lucroLiquido=receitaTotal-totalDespesas;
      const clientesReceberam=[...new Set(recebMes.map(r=>r.cliente_id))].length;
      const total=totalCobrancas || (recebidoMensalidade+em_aberto+atrasado);
      resultado.push({
        mes_ref:mr,
        recebido:recebidoMensalidade,
        em_aberto,
        atrasado,
        total,
        outras_receitas:outrasReceitas,
        despesas:totalDespesas,
        receita_total:receitaTotal,
        lucro_liquido:lucroLiquido,
        clientes_ativos:clientesReceberam,
        por_servidor:porServidor,
        qtd_recebimentos:recebMes.length,
        qtd_recebimentos_sem_data:0
      });
    }
    const totais=resultado.reduce((acc,r)=>({
      recebido:acc.recebido+r.recebido,
      em_aberto:acc.em_aberto+r.em_aberto,
      atrasado:acc.atrasado+r.atrasado,
      total:acc.total+r.total,
      outras_receitas:acc.outras_receitas+r.outras_receitas,
      despesas:acc.despesas+r.despesas,
      receita_total:acc.receita_total+r.receita_total,
      lucro_liquido:acc.lucro_liquido+r.lucro_liquido,
      clientes_ativos:Math.max(acc.clientes_ativos,r.clientes_ativos),
      qtd_recebimentos:acc.qtd_recebimentos+r.qtd_recebimentos
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
    const { data:parcelas } = await sb.from('cobrancas').select('*').eq('cliente_id',id).eq('status',tipo==='vencido'?'vencido':'pendente').order('vencimento');
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
    await sb.from('recebimentos').delete().neq('id','_');
    await sb.from('cobrancas').delete().neq('id','_');
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
    const { data:cobs } = await sb.from('cobrancas').select('id,servidor');
    for (const c of cobs) { const norm=normalizarServidor(c.servidor); if (norm!==c.servidor) await sb.from('cobrancas').update({ servidor:norm }).eq('id',c.id); }
    return res.json({ ok:true, clientes_atualizados:atualizados });
  }

  // ─── IMPORTAR CLIENTES + HISTÓRICO ────────────────────────────
  // Importa os clientes e PRESERVA CADA RECEBIMENTO como um registro
  // independente. Não usamos a posição DATA/DATA2... como mês de referência,
  // pois esses campos são eventos de pagamento e podem conter vários
  // pagamentos no mesmo mês/data.
  if (url === '/importar-clientes-historico' && req.method==='POST') {
    const { texto } = body;
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
    const processados=[];
    const erros=[];

    const processarLinha = async (linha, numeroLinha) => {
      try {
        const cols=linha.split('\t');
        if(cols.length<6) throw new Error(`Linha com apenas ${cols.length} colunas; esperado pelo menos 6`);
        const nomeRaw=(cols[0]||'').trim();
        if(!nomeRaw) throw new Error('Nome do cliente vazio');
        const ativoRaw=(cols[1]||'').trim().toLowerCase();
        const servidorFinal=normalizarServidor((cols[2]||'').trim())||'';
        const valorMensal=parseValor(cols[3]);
        const dia=parseInt(cols[4],10)||1;
        const obs=(cols[5]||'').trim();
        const status=ativoRaw==='sim'?'ativo':'inativo';

        if (servidorFinal) {
          const { error:eSrv } = await sb.from('servidores').upsert(
            { id:uid(), nome:servidorFinal, criado:new Date().toISOString() },
            { onConflict:'nome', ignoreDuplicates:true }
          );
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

        let blocoStart=6, bloco=0;
        while(blocoStart+4<cols.length) {
          bloco++;
          const dataStr=(cols[blocoStart]||'').trim();
          const recebidoStr=(cols[blocoStart+1]||'').trim().toLowerCase();
          const descStr=(cols[blocoStart+2]||'').trim();
          const pontos=parseInt(cols[blocoStart+3],10)||0;
          const valorStr=(cols[blocoStart+4]||'').trim();
          blocoStart+=5;

          if(recebidoStr!=='sim' && recebidoStr!=='s') continue;

          const dataISO=parseDataBR(dataStr);
          const valorRecebido=parseValor(valorStr);
          const desconto=parseValor(descStr);
          const valorOriginal=desconto>0 ? valorRecebido+desconto : Math.max(valorMensal||0, valorRecebido);
          const mesRef=dataISO ? dataISO.slice(0,7) : null;
          const receiptId=`rec_${cliente.id}_${String(bloco).padStart(2,'0')}`;

          const { error:eRec }=await sb.from('recebimentos').upsert({
            id:receiptId,
            cliente_id:cliente.id,
            cliente_nome:nomeRaw,
            servidor:servidorFinal,
            data_recebimento:dataISO,
            mes_ref:mesRef,
            valor_original:valorOriginal,
            desconto,
            valor_recebido:valorRecebido,
            descricao:descStr,
            pontos,
            bloco_origem:bloco,
            origem:'importacao_historico',
            criado:new Date().toISOString()
          },{onConflict:'id'});
          if(eRec) throw eRec;

          totalRecebimentos++;
          totalValorRecebido+=valorRecebido;
          if(dataISO) totalRecebimentosComData++; else totalRecebimentosSemData++;
        }

        return {ok:true,detalhe:{indice:numeroLinha,nome:nomeRaw,servidor:servidorFinal,status}};
      } catch(e) {
        return {ok:false,erro:{indice:numeroLinha,nome:(linha.split('\t')[0]||'').trim(),mensagem:e?.message||String(e)}};
      }
    };

    const resultados=await Promise.all(dataLinhas.map((linha,i)=>processarLinha(linha,i+1)));
    for(const r of resultados) {
      if(r.ok) processados.push(r.detalhe); else erros.push(r.erro);
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
      processadosDetalhes:processados,
      erros
    });
  }

  return res.status(404).json({ erro: 'Rota não encontrada', url });
}
