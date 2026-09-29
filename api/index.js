import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
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

function parseCookies(req) {
  const raw = req.headers?.cookie || '';
  return Object.fromEntries(raw.split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf('=');
    return [i >= 0 ? v.slice(0, i) : v, i >= 0 ? decodeURIComponent(v.slice(i + 1)) : ''];
  }));
}

function cookieOptions(maxAge) {
  const secure = process.env.VERCEL ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function setAuthCookies(res, session) {
  const access = encodeURIComponent(session.access_token);
  const refresh = encodeURIComponent(session.refresh_token);
  res.setHeader('Set-Cookie', [
    `gc_access=${access}; ${cookieOptions(session.expires_in || 3600)}`,
    `gc_refresh=${refresh}; ${cookieOptions(60 * 60 * 24 * 30)}`
  ]);
}

function clearAuthCookies(res) {
  const secure = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `gc_access=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    `gc_refresh=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  ]);
}

async function requireUser(req, res) {
  const cookies = parseCookies(req);
  const bearer = (req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const token = bearer || cookies.gc_access;
  if (!token) {
    err(res, 'Não autenticado', 401);
    return null;
  }
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) {
    err(res, 'Sessão expirada', 401);
    return null;
  }
  return data.user;
}

// ── Router manual (sem express, roda como serverless) ────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url  = req.url.replace(/^\/api/,'').split('?')[0];
  const params = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  let body = {};
  if (['POST','PUT','PATCH'].includes(req.method)) {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}; } catch {}
  }

  // ─── AUTENTICAÇÃO ─────────────────────────────────────────────
  if (url === '/auth/login' && req.method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) return err(res, 'E-mail e senha são obrigatórios');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data?.session) return err(res, 'E-mail ou senha inválidos', 401);
    setAuthCookies(res, data.session);
    return res.json({ ok: true, user: { id: data.user.id, email: data.user.email } });
  }

  if (url === '/auth/me' && req.method === 'GET') {
    const user = await requireUser(req, res);
    if (!user) return;
    return res.json({ user: { id: user.id, email: user.email } });
  }

  if (url === '/auth/refresh' && req.method === 'POST') {
    const cookies = parseCookies(req);
    if (!cookies.gc_refresh) return err(res, 'Sessão expirada', 401);
    const { data, error } = await sb.auth.refreshSession({ refresh_token: cookies.gc_refresh });
    if (error || !data?.session) {
      clearAuthCookies(res);
      return err(res, 'Sessão expirada', 401);
    }
    setAuthCookies(res, data.session);
    return res.json({ ok: true, user: { id: data.user.id, email: data.user.email } });
  }

  if (url === '/auth/logout' && req.method === 'POST') {
    clearAuthCookies(res);
    return res.json({ ok: true });
  }

  const user = await requireUser(req, res);
  if (!user) return;

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
    const { data } = await sb.from('cobrancas').select('mes_ref').order('mes_ref',{ascending:false});
    const meses = [...new Set(data.map(r=>r.mes_ref))];
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
    return res.json({ ok:true, baixadas, total:valor_total });
  }
  if (url.match(/^\/cobrancas\/[^/]+\/pagar$/) && req.method === 'PUT') {
    const id = url.split('/')[2];
    const { pago_em, valor_pago, obs_pagamento, servidor_novo } = body;
    const { data:cb } = await sb.from('cobrancas').select('*').eq('id',id).single();
    if (!cb) return err(res,'Cobrança não encontrada',404);
    await sb.from('cobrancas').update({ status:'pago', pago_em, valor_pago:parseFloat(valor_pago), obs_pagamento:obs_pagamento||'' }).eq('id',id);
    if (servidor_novo && servidor_novo !== cb.servidor)
      await sb.from('clientes').update({ servidor:servidor_novo }).eq('id',cb.cliente_id);
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
    const { data:doMes } = await sb.from('cobrancas').select('*').eq('mes_ref',mesRef);
    return res.json({
      ativos,
      totalMes:  doMes.reduce((s,c)=>s+parseFloat(c.valor),0),
      recebido:  doMes.filter(c=>c.status==='pago').reduce((s,c)=>s+parseFloat(c.valor_pago||c.valor),0),
      pendentes: doMes.filter(c=>c.status==='pendente').length,
      vencidas:  doMes.filter(c=>c.status==='vencido').length,
      mesRef, doMes
    });
  }

  // ─── FINANCEIRO ───────────────────────────────────────────────
  if (url === '/financeiro') {
    await marcarVencidos();
    const { de, ate } = params;
    const { data:todasCobs } = await sb.from('cobrancas').select('*');
    const { data:todasOv }   = await sb.from('outras_vendas').select('*');
    const { data:todasDp }   = await sb.from('despesas').select('*');
    const mesesSet = new Set();
    todasCobs.forEach(r=>r.mes_ref && mesesSet.add(r.mes_ref));
    todasOv.forEach(r=>r.mes_ref && mesesSet.add(r.mes_ref));
    todasDp.forEach(r=>r.mes_ref && mesesSet.add(r.mes_ref));
    // Adicionar meses com caixa (pago_em)
    todasCobs.filter(c=>c.status==='pago'&&c.pago_em).forEach(c=>mesesSet.add(c.pago_em.slice(0,7)));
    const meses = [...mesesSet].sort();
    // Caixa por mês (data do pagamento)
    const caixaPorMes = {};
    todasCobs.filter(c=>c.status==='pago'&&c.pago_em).forEach(c=>{
      const m = c.pago_em.slice(0,7);
      caixaPorMes[m] = (caixaPorMes[m]||0) + parseFloat(c.valor_pago||c.valor);
    });
    const resultado = [];
    for (const mr of meses) {
      if (de && mr < de) continue;
      if (ate && mr > ate) continue;
      const cobs = todasCobs.filter(c=>c.mes_ref===mr);
      const em_aberto = cobs.filter(c=>c.status==='pendente').reduce((s,c)=>s+parseFloat(c.valor),0);
      const atrasado  = cobs.filter(c=>c.status==='vencido').reduce((s,c)=>s+parseFloat(c.valor),0);
      const totalMensalidade = cobs.reduce((s,c)=>s+parseFloat(c.valor),0);
      const recebidoMensalidade = caixaPorMes[mr]||0;
      const porServidor = {};
      cobs.forEach(c=>{
        if (!porServidor[c.servidor]) porServidor[c.servidor]={qtd:0,valor:0};
        porServidor[c.servidor].qtd++;
        porServidor[c.servidor].valor+=parseFloat(c.valor);
      });
      const ovs = todasOv.filter(r=>r.mes_ref===mr);
      const outrasReceitas = ovs.reduce((s,r)=>s+parseFloat(r.total),0);
      const dps = todasDp.filter(r=>r.mes_ref===mr);
      const totalDespesas = dps.reduce((s,r)=>s+parseFloat(r.total),0);
      const receitaTotal = recebidoMensalidade + outrasReceitas;
      const lucroLiquido = receitaTotal - totalDespesas;
      resultado.push({
        mes_ref:mr, recebido:recebidoMensalidade, em_aberto, atrasado, total:totalMensalidade,
        outras_receitas:outrasReceitas, despesas:totalDespesas,
        receita_total:receitaTotal, lucro_liquido:lucroLiquido,
        clientes_ativos:[...new Set(cobs.filter(c=>c.status==='pago'||c.status==='vencido').map(c=>c.cliente_id))].length,
        por_servidor:porServidor
      });
    }
    const totais = resultado.reduce((acc,r)=>({
      recebido:acc.recebido+r.recebido, em_aberto:acc.em_aberto+r.em_aberto,
      atrasado:acc.atrasado+r.atrasado, total:acc.total+r.total,
      outras_receitas:acc.outras_receitas+r.outras_receitas, despesas:acc.despesas+r.despesas,
      receita_total:acc.receita_total+r.receita_total, lucro_liquido:acc.lucro_liquido+r.lucro_liquido,
      clientes_ativos:Math.max(acc.clientes_ativos,r.clientes_ativos),
    }),{recebido:0,em_aberto:0,atrasado:0,total:0,outras_receitas:0,despesas:0,receita_total:0,lucro_liquido:0,clientes_ativos:0});
    return res.json({ meses:resultado.reverse(), totais });
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
    await sb.from('cobrancas').delete().neq('id','_');
    await sb.from('clientes').delete().neq('id','_');
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
  if (url === '/importar-clientes-historico' && req.method==='POST') {
    const { texto } = body;
    if (!texto?.trim()) return err(res,'Texto vazio');
    const pad2=n=>String(n).padStart(2,'0');
    const parseValor=s=>s ? parseFloat(String(s).replace(/R\$\s?/g,'').replace(/\./g,'').replace(',','.').trim())||0 : 0;
    const parseDataBR=s=>{ if(!s) return null; s=s.trim(); const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${pad2(m[2])}-${pad2(m[1])}` : null; };
    const linhasBrutas=texto.split(/\r?\n/).filter(l=>l.trim());
    let hi=-1;
    for(let i=0;i<Math.min(linhasBrutas.length,5);i++) { if(linhasBrutas[i].toLowerCase().includes('cliente')&&linhasBrutas[i].toLowerCase().includes('ativ')) { hi=i; break; } }
    if(hi===-1) hi=1;
    const dataLinhas=linhasBrutas.slice(hi+1);
    let clientesNovos=0, clientesAtualizados=0, totalCobrancasCriadas=0, totalCobrancasPagas=0;
    const anoAtual=new Date().getFullYear(); const hojeISO=new Date().toISOString().slice(0,10);
    for (const linha of dataLinhas) {
      const cols=linha.split('\t');
      if(cols.length<6) continue;
      const nomeRaw=(cols[0]||'').trim(); if(!nomeRaw) continue;
      const ativoRaw=(cols[1]||'').trim().toLowerCase();
      const servidor=(cols[2]||'').trim();
      const valorMensal=parseValor(cols[3]);
      const dia=parseInt(cols[4])||1;
      const obs=(cols[5]||'').trim();
      const status=ativoRaw==='sim'?'ativo':'inativo';
      const servidorFinal=normalizarServidor(servidor)||'';
      // Garantir servidor
      if (servidorFinal) await sb.from('servidores').upsert({ id:uid(), nome:servidorFinal, criado:new Date().toISOString() },{ onConflict:'nome', ignoreDuplicates:true });
      // Cliente
      const { data:clienteExist }=await sb.from('clientes').select('*').eq('nome',nomeRaw).maybeSingle();
      let cliente;
      if (clienteExist) {
        await sb.from('clientes').update({ servidor:servidorFinal, dia, valor:valorMensal||clienteExist.valor, status, obs }).eq('id',clienteExist.id);
        cliente={ ...clienteExist, servidor:servidorFinal, dia, valor:valorMensal||clienteExist.valor };
        clientesAtualizados++;
      } else {
        const id=uid();
        await sb.from('clientes').insert({ id, nome:nomeRaw, celular:'', servidor:servidorFinal, dia, valor:valorMensal||0, status, obs, criado:new Date().toISOString() });
        cliente={ id, nome:nomeRaw, servidor:servidorFinal, dia, valor:valorMensal||0 };
        clientesNovos++;
      }
      // Detectar anoBase
      let anoBase=anoAtual;
      for(let b=6;b+4<cols.length;b+=5) { const d=parseDataBR((cols[b]||'').trim()); if(d) { const a=parseInt(d.slice(0,4)); if(a>anoBase) anoBase=a; } }
      // Blocos mensais
      let blocoStart=6, mesIdx=0;
      while(blocoStart+4<cols.length) {
        const dataStr=(cols[blocoStart]||'').trim();
        const recebidoStr=(cols[blocoStart+1]||'').trim().toLowerCase();
        const valorStr=(cols[blocoStart+4]||'').trim();
        blocoStart+=5;
        const mesBlocoNum=(mesIdx%12)+1, anoBlocoNum=anoBase+Math.floor(mesIdx/12);
        mesIdx++;
        const dataVazia=!dataStr||dataStr==='-';
        const recebidoVazio=!recebidoStr||recebidoStr==='-';
        if(dataVazia&&recebidoVazio) continue;
        if(dataVazia&&recebidoStr==='0') continue;
        const isPago=recebidoStr==='sim'||recebidoStr==='s';
        if(dataVazia&&!isPago&&recebidoStr!=='não'&&recebidoStr!=='nao') continue;
        const valorCobranca=parseValor(valorStr)||valorMensal;
        const mesRef=`${anoBlocoNum}-${pad2(mesBlocoNum)}`;
        const diasNoMesBl=new Date(anoBlocoNum,mesBlocoNum,0).getDate();
        const diaVenc=Math.min(dia,diasNoMesBl);
        const vencimentoISO=`${anoBlocoNum}-${pad2(mesBlocoNum)}-${pad2(diaVenc)}`;
        const statusCob=isPago?'pago':vencimentoISO<hojeISO?'vencido':'pendente';
        const dataISO=parseDataBR(dataStr);
        const { data:cobExist }=await sb.from('cobrancas').select('id').eq('cliente_id',cliente.id).eq('mes_ref',mesRef).maybeSingle();
        if (cobExist) {
          await sb.from('cobrancas').update({ servidor:servidorFinal, valor:valorCobranca, vencimento:vencimentoISO, status:statusCob, pago_em:isPago&&dataISO?dataISO:null, valor_pago:isPago?valorCobranca:null }).eq('id',cobExist.id);
        } else {
          await sb.from('cobrancas').insert({ id:uid(), cliente_id:cliente.id, cliente_nome:nomeRaw, servidor:servidorFinal, valor:valorCobranca, vencimento:vencimentoISO, mes_ref:mesRef, status:statusCob, pago_em:isPago&&dataISO?dataISO:null, valor_pago:isPago?valorCobranca:null, criado:new Date().toISOString() });
          totalCobrancasCriadas++;
          if(isPago) totalCobrancasPagas++;
        }
      }
    }
    return res.json({ ok:true, clientesNovos, clientesAtualizados, totalCobrancasCriadas, totalCobrancasPagas, erros:[] });
  }

  return res.status(404).json({ erro: 'Rota não encontrada', url });
}
