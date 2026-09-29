
const LBL={pendente:'Pendente',pago:'Pago',vencido:'Vencido',cancelado:'Cancelado'};
let currentPage='dashboard', editId=null, wappDados=null, wappClienteId=null;

function pad(n){return String(n).padStart(2,'0');}
function hoje(){const d=new Date();return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
function mesAtual(){const d=new Date();return`${d.getFullYear()}-${pad(d.getMonth()+1)}`;}
function fmtD(s){if(!s)return'—';const[a,m,d]=s.split('-');return`${d}/${m}/${a}`;}
function fmtV(v){return'R$ '+parseFloat(v||0).toFixed(2).replace('.',',');}
function mesNome(m){return['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][m-1];}
const MESES_FULL=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
function fmtMesRef(mr){
  if(!mr||!mr.includes('-')) return mr||'—';
  const [a,m]=mr.split('-');
  return MESES_FULL[parseInt(m)-1]+'/'+a;
}
function esc(s){return(s||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');}

function toast(msg,tipo='ok'){
  const t=document.getElementById('toast');
  document.getElementById('toast-msg').textContent=msg;
  t.querySelector('i').className='ti ti-'+(tipo==='ok'?'check':'alert-circle');
  t.className='toast '+tipo+' show';
  clearTimeout(t._t);
  t._t=setTimeout(()=>t.classList.remove('show'),3000);
}
function closeOv(id){document.getElementById(id).classList.remove('open');}
function openOv(id){
  // Fecha todos os outros overlays antes de abrir
  document.querySelectorAll('.overlay.open').forEach(o=>{ if(o.id!==id) o.classList.remove('open'); });
  const el=document.getElementById(id);
  el.classList.add('open');
  // Fechar ao clicar no fundo (não no modal)
  el.onclick=function(e){ if(e.target===el) closeOv(id); };
}

async function api(method,url,body,retry=true){
  const opts={method,headers:{'Content-Type':'application/json'},credentials:'include'};
  if(body)opts.body=JSON.stringify(body);
  const r=await fetch(url,opts);
  if(r.status===401 && retry && !url.startsWith('/api/auth/')){
    const rr=await fetch('/api/auth/refresh',{method:'POST',credentials:'include'});
    if(rr.ok) return api(method,url,body,false);
    mostrarLogin();
  }
  if(!r.ok)throw new Error(await r.text());
  return r.json();
}

function mostrarLogin(){
  document.getElementById('login-screen').style.display='flex';
  document.querySelector('.shell').style.display='none';
  document.getElementById('login-email').focus();
}
function esconderLogin(user){
  document.getElementById('login-screen').style.display='none';
  document.querySelector('.shell').style.display='flex';
  document.getElementById('logged-user').textContent=user?.email||'';
}
function loginErro(msg){
  const el=document.getElementById('login-error');
  el.textContent=msg; el.classList.add('show');
}
async function fazerLogin(e){
  e.preventDefault();
  const btn=document.getElementById('login-submit');
  const email=document.getElementById('login-email').value.trim();
  const password=document.getElementById('login-password').value;
  const error=document.getElementById('login-error');
  error.classList.remove('show');
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i> Entrando...';
  try{
    const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({email,password})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.erro||'Não foi possível entrar');
    esconderLogin(data.user);
    showPage('dashboard');
  }catch(err){ loginErro(err.message); }
  finally{ btn.disabled=false; btn.innerHTML='<i class="ti ti-login"></i> Entrar'; }
}
async function fazerLogout(){
  try{ await fetch('/api/auth/logout',{method:'POST',credentials:'include'}); }catch{}
  document.getElementById('login-password').value='';
  mostrarLogin();
}
async function initAuth(){
  try{
    const r=await fetch('/api/auth/me',{credentials:'include'});
    if(r.ok){ const d=await r.json(); esconderLogin(d.user); showPage('dashboard'); return; }
    if(r.status===401){
      const rr=await fetch('/api/auth/refresh',{method:'POST',credentials:'include'});
      if(rr.ok){ const d=await rr.json(); esconderLogin(d.user); showPage('dashboard'); return; }
    }
  }catch(e){}
  mostrarLogin();
}

const PAGES=['dashboard','clientes','cobrancas','inadimplentes','financeiro','outras-vendas','despesas','cadastros','configuracoes'];
const TITLES={dashboard:'Painel',clientes:'Clientes',cobrancas:'Cobranças',inadimplentes:'Inadimplentes',financeiro:'Financeiro','outras-vendas':'Receitas',despesas:'Despesas',cadastros:'Cadastros Gerais',configuracoes:'Configurações'};
const ACTIONS={
  dashboard:  ()=>`<button class="btn btn-primary" onclick="gerarMes()"><i class="ti ti-refresh"></i> Gerar cobranças do mês</button>`,
  clientes:   ()=>`<div class="btn-group"><button class="btn btn-amber" onclick="gerarTeste()"><i class="ti ti-test-pipe"></i> Dados de teste</button><button class="btn btn-purple" onclick="abrirImportarIPTV()"><i class="ti ti-table-import"></i> Importar planilha</button><button class="btn btn-primary" onclick="openClienteModal()"><i class="ti ti-plus"></i> Novo cliente</button></div>`,
  cobrancas:  ()=>`<div class="btn-group"><button class="btn btn-purple" onclick="abrirLote()"><i class="ti ti-layer-group"></i> Receber em lote</button><button class="btn btn-primary" onclick="gerarMes()"><i class="ti ti-refresh"></i> Gerar cobranças do mês</button></div>`,
  inadimplentes:()=>'', financeiro:()=>'', cadastros:()=>'', configuracoes:()=>'',
  'outras-vendas':()=>`<div class="btn-group">
    <button class="btn btn-sm" onclick="ovAbrirImportar()"><i class="ti ti-file-upload"></i> Importar dados</button>
    <button class="btn btn-sm btn-danger" onclick="ovLimparTudo()"><i class="ti ti-trash"></i> Limpar tudo</button>
    <button class="btn btn-primary" onclick="ovAbrirNovo()"><i class="ti ti-plus"></i> Nova receita</button>
  </div>`,
  despesas:()=>`<div class="btn-group">
    <button class="btn btn-sm" onclick="dpAbrirImportar()"><i class="ti ti-file-upload"></i> Importar dados</button>
    <button class="btn btn-sm btn-danger" onclick="dpLimparTudo()"><i class="ti ti-trash"></i> Limpar tudo</button>
    <button class="btn btn-primary" onclick="dpAbrirNovo()"><i class="ti ti-plus"></i> Nova despesa</button>
  </div>`,
};

function showPage(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  const idx=PAGES.indexOf(name);
  if(idx>=0)document.querySelectorAll('.nav-item')[idx].classList.add('active');
  document.getElementById('topbar-title').textContent=TITLES[name]||name;
  document.getElementById('topbar-actions').innerHTML=ACTIONS[name]?ACTIONS[name]():'';
  currentPage=name;
  const fn={dashboard:renderDash,clientes:renderClientes,cobrancas:renderCobs,inadimplentes:renderInad,financeiro:renderFinanceiro,'outras-vendas':renderOutrasVendas,despesas:renderDespesas,cadastros:renderCadastros,configuracoes:carregarConfigs};
  if(fn[name])fn[name]();
}

/* ── DASHBOARD ── */
async function renderDash(){
  try{
    const d=await api('GET','/api/dashboard');
    const mes=parseInt(d.mesRef.split('-')[1]);
    document.getElementById('metrics').innerHTML=`
      <div class="metric"><div class="metric-label">Clientes ativos</div><div class="metric-value cv-blue">${d.ativos}</div></div>
      <div class="metric"><div class="metric-label">A receber (${mesNome(mes)})</div><div class="metric-value">${fmtV(d.totalMes)}</div></div>
      <div class="metric"><div class="metric-label">Recebido</div><div class="metric-value cv-green">${fmtV(d.recebido)}</div></div>
      <div class="metric"><div class="metric-label">Pendentes</div><div class="metric-value cv-amber">${d.pendentes}</div></div>
      <div class="metric"><div class="metric-label">Vencidas</div><div class="metric-value cv-red">${d.vencidas}</div></div>`;
    const rows=d.doMes.sort((a,b)=>new Date(a.vencimento)-new Date(b.vencimento));
    document.getElementById('dash-table').innerHTML=rows.length===0
      ?`<div class="empty"><i class="ti ti-receipt-off"></i><p>Nenhuma cobrança este mês. <a href="#" onclick="gerarMes();return false" style="color:var(--accent)">Gerar agora</a></p></div>`
      :`<table><thead><tr><th style="width:24%">Cliente</th><th style="width:15%">Servidor</th><th style="width:13%">Vencimento</th><th style="width:12%">Valor</th><th style="width:10%">Status</th><th style="width:26%"></th></tr></thead>
        <tbody>${rows.map(cb=>`<tr>
          <td style="font-weight:500">${cb.cliente_nome}</td>
          <td style="color:var(--muted)">${cb.servidor}</td>
          <td>${fmtD(cb.vencimento)}</td>
          <td style="font-weight:600">${fmtV(cb.valor)}</td>
          <td><span class="badge badge-${cb.status}">${LBL[cb.status]}</span></td>
          <td><div class="btn-group">
            ${cb.status!=='pago'&&cb.status!=='cancelado'?`<button class="btn btn-sm btn-success" onclick="abrirPag('${cb.id}','${esc(cb.cliente_nome)}','${cb.servidor}','${cb.vencimento}','${cb.mes_ref}',${cb.valor})"><i class="ti ti-check"></i> Pago</button>`:''}
            ${cb.status==='pendente'||cb.status==='vencido'?`<button class="btn btn-sm btn-wapp" onclick="abrirWapp('${cb.cliente_id}','${cb.status}')"><i class="ti ti-brand-whatsapp"></i></button>`:''}
          </div></td>
        </tr>`).join('')}</tbody></table>`;
    atualizarBadge();
  }catch(e){toast('Erro ao carregar painel','err');}
}

/* ── CLIENTES ── */
async function renderClientes(){
  const busca=(document.getElementById('bc')||{value:''}).value;
  const fst=(document.getElementById('fsc')||{value:''}).value;
  let url='/api/clientes?';
  if(fst)url+=`status=${fst}&`;
  if(busca)url+=`busca=${encodeURIComponent(busca)}&`;
  try{
    const lista=await api('GET',url);
    document.getElementById('clientes-table').innerHTML=lista.length===0
      ?`<div class="empty"><i class="ti ti-users"></i><p>${busca?'Nenhum cliente encontrado.':'Nenhum cliente cadastrado ainda.'}</p></div>`
      :`<table><thead><tr>
          <th>Nome</th><th>Celular</th><th>Servidor</th>
          <th>Venc.</th><th>Valor</th><th>Status</th><th></th>
        </tr></thead><tbody>${lista.map(c=>`<tr>
          <td style="font-weight:600">${c.nome} &nbsp;<span class="badge badge-${c.status}">${c.status==='ativo'?'Ativo':'Inativo'}</span></td>
          <td data-label="Celular">${c.celular||'—'}</td>
          <td data-label="Servidor">${c.servidor||'—'}</td>
          <td data-label="Venc.">Dia ${c.dia}</td>
          <td data-label="Valor" style="font-weight:600;color:var(--green)">${fmtV(c.valor)}</td>
          <td class="hide-mobile"><span class="badge badge-${c.status}">${c.status==='ativo'?'Ativo':'Inativo'}</span></td>
          <td><div class="btn-group">
            <button class="btn btn-sm btn-wapp" onclick="abrirWapp('${c.id}','pendente')" title="WhatsApp"><i class="ti ti-brand-whatsapp"></i></button>
            <button class="btn btn-sm" style="color:var(--accent);border-color:var(--accent)" onclick="abrirHist('${c.id}','${esc(c.nome)}')" title="Histórico"><i class="ti ti-clock"></i></button>
            <button class="btn btn-sm" onclick="openClienteModal('${c.id}')" title="Editar"><i class="ti ti-edit"></i></button>
            <button class="btn btn-sm" onclick="toggleSt('${c.id}','${c.status}')" title="${c.status==='ativo'?'Desativar':'Ativar'}"><i class="ti ti-${c.status==='ativo'?'pause':'player-play'}"></i></button>
            <button class="btn btn-sm btn-danger" onclick="delCliente('${c.id}')" title="Excluir"><i class="ti ti-trash"></i></button>
          </div></td>
        </tr>`).join('')}</tbody></table>`;
  }catch(e){toast('Erro ao carregar clientes','err');}
}

/* ── COBRANÇAS ── */
/* ── FILTRO PRÓXIMOS A VENCER ── */
let _cobsVencerAtivo = false; // flag se filtro de vencer está ativo

function filtrarProximosVencer(){
  const dias = parseInt(document.getElementById('vencer-dias').value) || 7;
  _cobsVencerAtivo = true;
  // Limpar outros filtros para não conflitar
  const fs = document.getElementById('fs'); if(fs) fs.value = '';
  const bcc = document.getElementById('bcc'); if(bcc) bcc.value = '';
  renderCobs(dias);
}

function cobsLimparVencer(force){
  if(!_cobsVencerAtivo && !force) return;
  _cobsVencerAtivo = false;
  const banner = document.getElementById('vencer-banner');
  const clearBtn = document.getElementById('vencer-clear');
  if(banner)  banner.style.display = 'none';
  if(clearBtn) clearBtn.style.display = 'none';
  if(force) renderCobs();
}

async function renderCobs(vencerEmDias){
  try{
    const meses=await api('GET','/api/cobrancas/meses');
    const ma=mesAtual();
    const todos=[...new Set([ma,...meses])].sort().reverse();
    const fm=document.getElementById('fm');
    const prev=fm?fm.value:'';
    if(fm)fm.innerHTML=todos.map(m=>`<option value="${m}"${m===(prev||ma)?'selected':''}>${fmtMesRef(m)}</option>`).join('');

    let lista;

    if(vencerEmDias || _cobsVencerAtivo){
      // Modo: próximos a vencer
      const dias = vencerEmDias || parseInt(document.getElementById('vencer-dias').value) || 7;
      _cobsVencerAtivo = true;

      // Calcular range de datas: hoje até hoje+dias
      const hoje = new Date(); hoje.setHours(0,0,0,0);
      const limite = new Date(hoje); limite.setDate(limite.getDate() + dias);

      const pad2 = n => String(n).padStart(2,'0');
      const fmtISO = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

      const hojeISO  = fmtISO(hoje);
      const limiteISO = fmtISO(limite);

      // Buscar todos os meses que cobrem o range
      const mesesRange = [...new Set(todos.filter(mr => mr >= hojeISO.slice(0,7) && mr <= limiteISO.slice(0,7)))];

      let todas = [];
      for(const mr of mesesRange){
        const r = await api('GET', `/api/cobrancas?mes_ref=${mr}&status=pendente`);
        todas = todas.concat(r);
      }

      // Filtrar: vencimento entre hoje e hoje+dias
      lista = todas.filter(cb => cb.vencimento >= hojeISO && cb.vencimento <= limiteISO)
                   .sort((a,b) => a.vencimento.localeCompare(b.vencimento));

      // Mostrar banner e botão limpar
      const banner = document.getElementById('vencer-banner');
      const clearBtn = document.getElementById('vencer-clear');
      if(banner){
        banner.style.display = 'flex';
        document.getElementById('vencer-banner-txt').textContent =
          `Mostrando ${lista.length} cobrança(s) pendentes que vencem nos próximos ${dias} dia(s) (até ${fmtD(limiteISO)})`;
      }
      if(clearBtn) clearBtn.style.display = '';

    } else {
      // Modo normal
      const mesRef=(document.getElementById('fm')||{value:ma}).value||ma;
      const fs=(document.getElementById('fs')||{value:''}).value;
      const busca=(document.getElementById('bcc')||{value:''}).value;
      let url=`/api/cobrancas?mes_ref=${mesRef}`;
      if(fs)url+=`&status=${fs}`;
      if(busca)url+=`&busca=${encodeURIComponent(busca)}`;
      lista = await api('GET',url);
    }

    const hoje2 = new Date(); hoje2.setHours(0,0,0,0);
    const fmtISO2 = d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const hojeISO2 = fmtISO2(hoje2);

    document.getElementById('cobs-table').innerHTML=lista.length===0
      ?'<div class="empty"><i class="ti ti-receipt"></i><p>Nenhuma cobrança encontrada.</p></div>'
      :`<table><thead><tr>
          <th>Cliente</th><th>Servidor</th>
          <th>Vencimento</th><th>Pagamento</th>
          <th>Valor</th><th>Status</th><th></th>
        </tr></thead><tbody>${lista.map(cb=>{
          const diasAteVenc = cb.vencimento && cb.status==='pendente'
            ? Math.ceil((new Date(cb.vencimento+'T00:00:00') - new Date(hojeISO2+'T00:00:00'))/(1000*60*60*24))
            : null;
          const destaque = diasAteVenc !== null && diasAteVenc <= 1
            ? 'background:rgba(245,166,35,.06)'
            : diasAteVenc !== null && diasAteVenc <= 3
            ? 'background:rgba(245,166,35,.03)' : '';
          const vencLabel = diasAteVenc !== null && cb.status==='pendente'
            ? (diasAteVenc === 0 ? ' <span style="color:var(--amber);font-size:11px;font-weight:700">hoje!</span>'
             : diasAteVenc === 1 ? ' <span style="color:var(--amber);font-size:11px">amanhã</span>'
             : diasAteVenc <= 3  ? ` <span style="color:var(--amber);font-size:11px">${diasAteVenc}d</span>` : '')
            : '';
          return`<tr style="${destaque}">
            <td style="font-weight:600">${cb.cliente_nome} <span class="badge badge-${cb.status}" style="margin-left:4px">${LBL[cb.status]}</span></td>
            <td data-label="Servidor">${cb.servidor||'—'}</td>
            <td data-label="Venc.">${fmtD(cb.vencimento)}${vencLabel}</td>
            <td data-label="Pagto.">${cb.pago_em?fmtD(cb.pago_em):'—'}</td>
            <td data-label="Valor" style="font-weight:600;color:var(--green)">${cb.valor_pago!=null&&cb.status==='pago'?fmtV(cb.valor_pago):fmtV(cb.valor)}</td>
            <td class="hide-mobile"><span class="badge badge-${cb.status}">${LBL[cb.status]}</span></td>
            <td><div class="btn-group">
              ${cb.status!=='pago'&&cb.status!=='cancelado'?`<button class="btn btn-sm btn-success" onclick="abrirPag('${cb.id}','${esc(cb.cliente_nome)}','${cb.servidor||''}','${cb.vencimento}','${cb.mes_ref}',${cb.valor})"><i class="ti ti-check"></i><span> Pago</span></button>`:''}
              ${cb.status==='pendente'||cb.status==='vencido'?`<button class="btn btn-sm btn-wapp" onclick="abrirWapp('${cb.cliente_id}','${cb.status}')"><i class="ti ti-brand-whatsapp"></i></button>`:''}
              ${cb.status!=='cancelado'&&cb.status!=='pago'?`<button class="btn btn-sm btn-danger" onclick="cancelCob('${cb.id}')"><i class="ti ti-x"></i></button>`:''}
            </div></td>
          </tr>`;
        }).join('')}</tbody></table>`;
  }catch(e){toast('Erro ao carregar cobranças','err');}
}

/* ── INADIMPLENTES ── */
async function renderInad(){
  try{
    const venc=await api('GET','/api/cobrancas/inadimplentes');
    if(!venc.length){
      document.getElementById('inad-card').innerHTML='<div class="empty"><i class="ti ti-circle-check"></i><p>Nenhum cliente inadimplente.</p></div>';
      atualizarBadge(0);return;
    }
    const mapa={};
    venc.forEach(cb=>{
      if(!mapa[cb.cliente_id])mapa[cb.cliente_id]={nome:cb.cliente_nome,id:cb.cliente_id,total:0,qtd:0,itens:[]};
      mapa[cb.cliente_id].total+=cb.valor;mapa[cb.cliente_id].qtd++;mapa[cb.cliente_id].itens.push(cb);
    });
    const grupos=Object.values(mapa).sort((a,b)=>b.total-a.total);
    atualizarBadge(grupos.length);
    const totalG=grupos.reduce((s,g)=>s+g.total,0);
    document.getElementById('inad-card').innerHTML=`
      <div class="card-header"><span class="card-title">Clientes inadimplentes</span>
        <span style="font-size:13px;color:var(--muted)">${grupos.length} cliente(s) · <strong style="color:var(--red)">${fmtV(totalG)}</strong> em aberto</span>
      </div>
      ${grupos.map(g=>`
        <div class="group-header">
          <span style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span><i class="ti ti-user" style="margin-right:5px"></i><strong>${g.nome}</strong></span>
            <span style="color:var(--muted);font-weight:400;font-size:12px">${g.qtd} parcela${g.qtd>1?'s':''}</span>
            <span class="group-total">${fmtV(g.total)}</span>
            <button class="btn btn-sm btn-wapp" onclick="abrirWapp('${g.id}','vencido')"><i class="ti ti-brand-whatsapp"></i> WhatsApp</button>
          </span>
        </div>
        <div class="table-wrap"><table style="table-layout:fixed">
          <thead><tr><th style="width:18%">Ref.</th><th style="width:22%">Vencimento</th><th style="width:20%">Servidor</th><th style="width:18%">Valor</th><th style="width:22%"></th></tr></thead>
          <tbody>${g.itens.sort((a,b)=>new Date(a.vencimento)-new Date(b.vencimento)).map(cb=>`<tr>
            <td>${fmtMesRef(cb.mes_ref)}</td><td>${fmtD(cb.vencimento)}</td>
            <td style="color:var(--muted)">${cb.servidor||'—'}</td>
            <td style="font-weight:600;color:var(--red)">${fmtV(cb.valor)}</td>
            <td><button class="btn btn-sm btn-success" onclick="abrirPag('${cb.id}','${esc(cb.cliente_nome)}','${cb.servidor||''}','${cb.vencimento}','${cb.mes_ref}',${cb.valor})"><i class="ti ti-check"></i> Pago</button></td>
          </tr>`).join('')}</tbody>
        </table></div>`).join('')}`;
  }catch(e){toast('Erro ao carregar inadimplentes','err');}
}

async function atualizarBadge(n){
  const badge=document.getElementById('badge-inad');
  if(n===undefined){
    try{const v=await api('GET','/api/cobrancas/inadimplentes');n=[...new Set(v.map(i=>i.cliente_id))].length;}catch{n=0;}
  }
  badge.style.display=n>0?'':'none';badge.textContent=n;
}

/* ── FINANCEIRO ── */
function finMesAtual(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; }
function finAnoAtualDe(){ return `${new Date().getFullYear()}-01`; }
function finAnoAtualAte(){ return `${new Date().getFullYear()}-12`; }

let _finCache = null;

async function renderFinanceiro(){
  const elDe  = document.getElementById('fin-de');
  const elAte = document.getElementById('fin-ate');
  if(!elDe||!elAte) return;
  if(!elDe.value)  elDe.value  = finMesAtual();
  if(!elAte.value) elAte.value = finMesAtual();

  // Preencher defaults dos outros filtros se ainda vazios
  const setDefault = (id, val) => { const e=document.getElementById(id); if(e&&!e.value) e.value=val; };
  setDefault('rg-de',  finAnoAtualDe());
  setDefault('rg-ate', finAnoAtualAte());
  setDefault('hm-de',  finAnoAtualDe());
  setDefault('hm-ate', finAnoAtualAte());
  setDefault('cli-de', finAnoAtualDe());
  setDefault('cli-ate',finAnoAtualAte());

  try{
    const {totais} = await api('GET', `/api/financeiro?de=${elDe.value}&ate=${elAte.value}&`);
    document.getElementById('fin-totais').innerHTML=`
      <div class="fin-metric"><div class="fin-metric-label">Mensalidades recebidas</div><div class="fin-metric-val cv-green">${fmtV(totais.recebido)}</div></div>
      <div class="fin-metric"><div class="fin-metric-label">Em aberto</div><div class="fin-metric-val cv-amber">${fmtV(totais.em_aberto)}</div></div>
      <div class="fin-metric"><div class="fin-metric-label">Em atraso</div><div class="fin-metric-val cv-red">${fmtV(totais.atrasado)}</div></div>
      <div class="fin-metric"><div class="fin-metric-label">Total faturado</div><div class="fin-metric-val">${fmtV(totais.total)}</div></div>`;
  }catch(e){ toast('Erro ao carregar financeiro','err'); return; }

  await _finPopularSelectMeses();
  await renderResumoGeral();
  await renderHistoricoMensal();
  await renderDistServidor();
  await renderClientesAtivos();
}

async function _finPopularSelectMeses(){
  try{
    const meses = await api('GET','/api/cobrancas/meses');
    const sel = document.getElementById('dist-mes');
    if(!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">Todo o período</option>' +
      meses.map(m=>`<option value="${m}"${m===prev?'selected':''}>${fmtMesRef(m)}</option>`).join('');
  }catch{}
}

async function renderResumoGeral(){
  const de  = (document.getElementById('rg-de') ||{value:''}).value;
  const ate = (document.getElementById('rg-ate')||{value:''}).value;
  try{
    let url='/api/financeiro?';
    if(de)  url+=`de=${de}&`;
    if(ate) url+=`ate=${ate}&`;
    const {totais} = await api('GET',url);
    const el = document.getElementById('fin-resumo-geral');
    if(!el) return;
    el.innerHTML=`
      <div class="fin-metric"><div class="fin-metric-label">Mensalidades</div><div class="fin-metric-val cv-green">${fmtV(totais.recebido)}</div></div>
      <div class="fin-metric"><div class="fin-metric-label">Outras receitas</div><div class="fin-metric-val cv-green">${fmtV(totais.outras_receitas)}</div></div>
      <div class="fin-metric"><div class="fin-metric-label">Receita total</div><div class="fin-metric-val cv-blue">${fmtV(totais.receita_total)}</div></div>
      <div class="fin-metric"><div class="fin-metric-label">Despesas</div><div class="fin-metric-val cv-red">${fmtV(totais.despesas)}</div></div>
      <div class="fin-metric"><div class="fin-metric-label">Lucro líquido</div><div class="fin-metric-val" style="color:${totais.lucro_liquido>=0?'var(--green)':'var(--red)'}">${fmtV(totais.lucro_liquido)}</div></div>`;
  }catch(e){toast('Erro resumo geral','err');}
}

async function renderHistoricoMensal(){
  const de  = (document.getElementById('hm-de') ||{value:''}).value;
  const ate = (document.getElementById('hm-ate')||{value:''}).value;
  const el  = document.getElementById('fin-tabela');
  if(!el) return;
  el.innerHTML='<div class="loading">Carregando...</div>';
  try{
    let url='/api/financeiro?';
    if(de)  url+=`de=${de}&`;
    if(ate) url+=`ate=${ate}&`;
    const {meses} = await api('GET',url);
    if(!meses.length){ el.innerHTML='<div class="empty"><i class="ti ti-report-money"></i><p>Nenhum dado para o período.</p></div>'; return; }
    el.innerHTML=`<table><thead><tr>
      <th style="width:12%">Mês</th><th style="width:12%">Mensalid.</th>
      <th style="width:11%">Outras Rec.</th><th style="width:10%">Em aberto</th>
      <th style="width:10%">Em atraso</th><th style="width:11%">Despesas</th>
      <th style="width:12%">Lucro líq.</th><th style="width:8%">Clientes</th><th style="width:9%">Taxa</th>
    </tr></thead><tbody>${[...meses].reverse().map(m=>{
      const tx=m.total>0?Math.round(m.recebido/m.total*100):0;
      return`<tr>
        <td style="font-weight:600">${fmtMesRef(m.mes_ref)}</td>
        <td style="color:var(--green);font-weight:600">${fmtV(m.recebido)}</td>
        <td style="color:var(--green)">${fmtV(m.outras_receitas||0)}</td>
        <td style="color:var(--amber)">${fmtV(m.em_aberto)}</td>
        <td style="color:var(--red)">${fmtV(m.atrasado)}</td>
        <td style="color:var(--red)">${fmtV(m.despesas||0)}</td>
        <td style="font-weight:700;color:${(m.lucro_liquido||0)>=0?'var(--green)':'var(--red)'}">${fmtV(m.lucro_liquido||0)}</td>
        <td style="text-align:center">${m.clientes_ativos}</td>
        <td><span style="color:${tx>=80?'var(--green)':tx>=50?'var(--amber)':'var(--red)'};font-weight:600">${tx}%</span></td>
      </tr>`;
    }).join('')}</tbody></table>`;
  }catch(e){el.innerHTML='<div class="empty"><i class="ti ti-alert-circle"></i><p>Erro ao carregar.</p></div>';}
}

async function renderDistServidor(){
  const mesFiltro = (document.getElementById('dist-mes')||{value:''}).value;
  const el = document.getElementById('fin-dist');
  if(!el) return;
  try{
    let url='/api/financeiro?';
    if(mesFiltro){ url+=`de=${mesFiltro}&ate=${mesFiltro}&`; }
    const {meses} = await api('GET',url);
    const distAcum={};
    meses.forEach(m=>{
      Object.entries(m.por_servidor||{}).forEach(([s,v])=>{
        if(!distAcum[s])distAcum[s]={qtd:0,valor:0};
        distAcum[s].qtd+=v.qtd; distAcum[s].valor+=v.valor;
      });
    });
    const distArr=Object.entries(distAcum).sort((a,b)=>b[1].qtd-a[1].qtd);
    if(!distArr.length){ el.innerHTML='<div style="color:var(--muted);font-size:13px">Sem dados</div>'; return; }
    const maxQtd=distArr[0][1].qtd||1;
    const titulo=mesFiltro?fmtMesRef(mesFiltro):'Total no período';
    el.innerHTML=`<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px">${titulo}</div>`+
      distArr.map(([s,v])=>`
        <div class="dist-bar-wrap">
          <div class="dist-bar-label"><span>${s}</span><span>${v.qtd} cobr. · ${fmtV(v.valor)}</span></div>
          <div class="dist-bar"><div class="dist-bar-fill" style="width:${Math.round(v.qtd/maxQtd*100)}%"></div></div>
        </div>`).join('');
  }catch(e){el.innerHTML='<div style="color:var(--muted);font-size:13px">Erro ao carregar.</div>';}
}

async function renderClientesAtivos(){
  const de  = (document.getElementById('cli-de') ||{value:''}).value;
  const ate = (document.getElementById('cli-ate')||{value:''}).value;
  const el  = document.getElementById('fin-clientes');
  if(!el) return;
  try{
    let url='/api/financeiro?';
    if(de)  url+=`de=${de}&`;
    if(ate) url+=`ate=${ate}&`;
    const {meses} = await api('GET',url);
    const mesesAsc=[...meses].reverse();
    const maxCli=Math.max(...mesesAsc.map(m=>m.clientes_ativos),1);
    el.innerHTML=mesesAsc.length===0
      ?'<div style="color:var(--muted);font-size:13px">Sem dados</div>'
      :mesesAsc.map(m=>`
        <div class="dist-bar-wrap">
          <div class="dist-bar-label"><span>${fmtMesRef(m.mes_ref)}</span><span>${m.clientes_ativos} cliente${m.clientes_ativos!==1?'s':''}</span></div>
          <div class="dist-bar"><div class="dist-bar-fill" style="width:${Math.round(m.clientes_ativos/maxCli*100)}%"></div></div>
        </div>`).join('');
  }catch(e){el.innerHTML='<div style="color:var(--muted);font-size:13px">Erro ao carregar.</div>';}
}

function limparFiltroFin(){
  ['fin-de','fin-ate'].forEach(id=>{ const e=document.getElementById(id);if(e)e.value=''; });
  renderFinanceiro();
}


/* ── CADASTROS ── */
async function renderCadastros(){
  try{
    const serv=await api('GET','/api/servidores');
    document.getElementById('lista-servidores').innerHTML=serv.length===0
      ?'<div style="color:var(--muted);font-size:13px">Nenhum servidor cadastrado.</div>'
      :serv.map(s=>`
        <div class="servidor-tag">
          <span>${s.nome}</span>
          <button onclick="editarServidor('${s.id}','${esc(s.nome)}')" style="background:none;border:none;cursor:pointer;color:var(--muted);padding:0 2px" title="Editar"><i class="ti ti-edit" style="font-size:13px"></i></button>
          <button onclick="delServidor('${s.id}')" style="background:none;border:none;cursor:pointer;color:var(--red);padding:0 2px" title="Excluir"><i class="ti ti-x" style="font-size:13px"></i></button>
        </div>`).join('');
  }catch(e){toast('Erro ao carregar servidores','err');}

  try{
    const tr=await api('GET','/api/tipos-receita');
    document.getElementById('lista-tipos-receita').innerHTML=tr.length===0
      ?'<div style="color:var(--muted);font-size:13px">Nenhum tipo cadastrado.</div>'
      :tr.map(t=>`
        <div class="servidor-tag">
          <span>${t.nome}</span>
          <button onclick="editarTipoReceita('${t.id}','${esc(t.nome)}')" style="background:none;border:none;cursor:pointer;color:var(--muted);padding:0 2px" title="Editar"><i class="ti ti-edit" style="font-size:13px"></i></button>
          <button onclick="delTipoReceita('${t.id}')" style="background:none;border:none;cursor:pointer;color:var(--red);padding:0 2px" title="Excluir"><i class="ti ti-x" style="font-size:13px"></i></button>
        </div>`).join('');
  }catch(e){toast('Erro ao carregar tipos de receita','err');}

  try{
    const td=await api('GET','/api/tipos-despesa');
    document.getElementById('lista-tipos-despesa').innerHTML=td.length===0
      ?'<div style="color:var(--muted);font-size:13px">Nenhum tipo cadastrado.</div>'
      :td.map(t=>`
        <div class="servidor-tag">
          <span>${t.nome}</span>
          <button onclick="editarTipoDespesa('${t.id}','${esc(t.nome)}')" style="background:none;border:none;cursor:pointer;color:var(--muted);padding:0 2px" title="Editar"><i class="ti ti-edit" style="font-size:13px"></i></button>
          <button onclick="delTipoDespesa('${t.id}')" style="background:none;border:none;cursor:pointer;color:var(--red);padding:0 2px" title="Excluir"><i class="ti ti-x" style="font-size:13px"></i></button>
        </div>`).join('');
  }catch(e){toast('Erro ao carregar tipos de despesa','err');}
}

/* Tipos de Receita */
async function addTipoReceita(){
  const el=document.getElementById('novo-tipo-receita');
  const nome=el.value.trim();
  if(!nome){ toast('Digite um nome para o tipo','err'); return; }
  try{
    await api('POST','/api/tipos-receita',{nome});
    el.value='';
    toast('Tipo de receita adicionado!');
    renderCadastros();
  }catch(e){ toast('Tipo já existe ou erro ao salvar','err'); }
}
function editarTipoReceita(id,nome){
  const novoNome=prompt('Editar tipo de receita:',nome);
  if(novoNome===null||!novoNome.trim())return;
  api('PUT',`/api/tipos-receita/${id}`,{nome:novoNome.trim()})
    .then(()=>{toast('Tipo atualizado!');renderCadastros();})
    .catch(()=>toast('Erro ao atualizar ou nome já existe','err'));
}
async function delTipoReceita(id){
  if(!confirm('Excluir este tipo de receita? (não afeta lançamentos já feitos)'))return;
  try{ await api('DELETE',`/api/tipos-receita/${id}`); toast('Tipo excluído.'); renderCadastros(); }
  catch(e){ toast('Erro ao excluir','err'); }
}

/* Tipos de Despesa */
async function addTipoDespesa(){
  const el=document.getElementById('novo-tipo-despesa');
  const nome=el.value.trim();
  if(!nome){ toast('Digite um nome para o tipo','err'); return; }
  try{
    await api('POST','/api/tipos-despesa',{nome});
    el.value='';
    toast('Tipo de despesa adicionado!');
    renderCadastros();
  }catch(e){ toast('Tipo já existe ou erro ao salvar','err'); }
}
function editarTipoDespesa(id,nome){
  const novoNome=prompt('Editar tipo de despesa:',nome);
  if(novoNome===null||!novoNome.trim())return;
  api('PUT',`/api/tipos-despesa/${id}`,{nome:novoNome.trim()})
    .then(()=>{toast('Tipo atualizado!');renderCadastros();})
    .catch(()=>toast('Erro ao atualizar ou nome já existe','err'));
}
async function delTipoDespesa(id){
  if(!confirm('Excluir este tipo de despesa? (não afeta lançamentos já feitos)'))return;
  try{ await api('DELETE',`/api/tipos-despesa/${id}`); toast('Tipo excluído.'); renderCadastros(); }
  catch(e){ toast('Erro ao excluir','err'); }
}

async function addServidor(){
  const el=document.getElementById('novo-servidor');
  const nome=el.value.trim();
  if(!nome){ toast('Digite um nome para o servidor','err'); return; }
  try{
    await api('POST','/api/servidores',{nome});
    el.value='';
    toast('Servidor adicionado!');
    renderCadastros();
  }catch(e){
    console.error('Erro addServidor:',e);
    toast('Servidor já existe ou erro ao salvar','err');
  }
}

function editarServidor(id,nome){
  document.getElementById('edit-serv-id').value=id;
  document.getElementById('edit-serv-nome').value=nome;
  openOv('ov-servidor');
}

async function salvarServidor(){
  const id=document.getElementById('edit-serv-id').value;
  const nome=document.getElementById('edit-serv-nome').value.trim();
  if(!nome){ toast('Digite um nome para o servidor','err'); return; }
  try{
    await api('PUT',`/api/servidores/${id}`,{nome});
    closeOv('ov-servidor');
    toast('Servidor atualizado!');
    renderCadastros();
  }catch(e){
    console.error('Erro salvarServidor:',e);
    toast('Erro ao salvar servidor','err');
  }
}

async function delServidor(id){
  if(!confirm('Excluir este servidor?'))return;
  try{await api('DELETE',`/api/servidores/${id}`);toast('Servidor excluído.');renderCadastros();}
  catch(e){toast('Erro ao excluir','err');}
}

/* ── CLIENTES AÇÕES ── */
async function openClienteModal(id){
  editId=id||null;

  // Carregar servidores no select (nunca troca o elemento, só o conteúdo)
  try{
    const servs=await api('GET','/api/servidores');
    const sel=document.getElementById('f-servidor');
    if(servs.length){
      sel.innerHTML='<option value="">Selecione o servidor...</option>'+
        servs.map(s=>`<option value="${s.nome}">${s.nome}</option>`).join('');
    } else {
      sel.innerHTML='<option value="">Nenhum servidor cadastrado</option>';
    }
  }catch(e){ console.error('Erro ao carregar servidores',e); }

  const f=x=>document.getElementById(x);

  if(id){
    try{
      const todos=await api('GET','/api/clientes');
      const c=todos.find(x=>x.id===id);
      if(!c){ toast('Cliente não encontrado','err'); return; }
      f('mc-title').textContent='Editar cliente';
      f('f-nome').value=c.nome;
      f('f-cel').value=c.celular||'';
      f('f-servidor').value=c.servidor;
      f('f-dia').value=c.dia;
      f('f-valor').value=c.valor;
      f('f-status').value=c.status;
      f('f-obs').value=c.obs||'';
      f('f-id').value=c.id;
    }catch(e){ toast('Erro ao carregar cliente','err'); return; }
  } else {
    f('mc-title').textContent='Novo cliente';
    f('f-nome').value='';
    f('f-cel').value='';
    f('f-servidor').value='';
    f('f-dia').value='';
    f('f-valor').value='';
    f('f-obs').value='';
    f('f-status').value='ativo';
    f('f-id').value='';
  }
  openOv('ov-cliente');
}

async function salvarCliente(){
  const g=x=>{
    const el=document.getElementById(x);
    return el ? el.value.trim() : '';
  };
  const nome=g('f-nome');
  const servidor=g('f-servidor');
  const dia=g('f-dia');
  const valor=g('f-valor');

  if(!nome)   { toast('Informe o nome do cliente','err'); return; }
  if(!servidor){ toast('Selecione o servidor','err'); return; }
  if(!dia)    { toast('Informe o dia de vencimento','err'); return; }
  if(!valor)  { toast('Informe o valor','err'); return; }

  const diaNum=parseInt(dia);
  if(diaNum<1||diaNum>31){ toast('Dia de vencimento deve ser entre 1 e 31','err'); return; }

  const body={
    nome,
    celular: g('f-cel'),
    servidor,
    dia: diaNum,
    valor: parseFloat(valor),
    status: document.getElementById('f-status').value,
    obs: g('f-obs')
  };

  try{
    if(editId) await api('PUT',`/api/clientes/${editId}`,body);
    else       await api('POST','/api/clientes',body);
    closeOv('ov-cliente');
    toast(editId?'Cliente atualizado!':'Cliente cadastrado!');
    renderClientes();
  }catch(e){
    console.error('Erro salvarCliente:',e);
    toast('Erro ao salvar cliente','err');
  }
}

async function delCliente(id){
  if(!confirm('Excluir este cliente?'))return;
  try{await api('DELETE',`/api/clientes/${id}`);toast('Cliente excluído.');renderClientes();}
  catch(e){toast('Erro ao excluir','err');}
}

async function toggleSt(id,status){
  try{
    await api('PUT',`/api/clientes/${id}`,{status:status==='ativo'?'inativo':'ativo'});
    toast(status==='ativo'?'Cliente desativado.':'Cliente ativado.');renderClientes();
  }catch{toast('Erro','err');}
}

/* ── PAGAMENTO ── */
async function abrirPag(id,nome,serv,venc,ref,valor){
  document.getElementById('p-id').value=id;
  document.getElementById('p-nome').textContent=nome;
  document.getElementById('p-serv').textContent=serv||'';
  document.getElementById('p-ref').textContent='Vencimento: '+fmtD(venc)+(ref?' · Ref: '+ref:'');
  document.getElementById('p-data').value=hoje();
  document.getElementById('p-valor').value=parseFloat(valor).toFixed(2);
  document.getElementById('p-obs').value='';
  // Carregar servidores no select e pré-selecionar o atual
  try{
    const servs=await api('GET','/api/servidores');
    const sel=document.getElementById('p-servidor');
    sel.innerHTML=servs.map(s=>`<option value="${s.nome}"${s.nome===serv?' selected':''}>${s.nome}</option>`).join('');
    // Se não achou no cadastro, adiciona como opção
    if(servs.length && !servs.find(s=>s.nome===serv)){
      sel.innerHTML=`<option value="${serv}" selected>${serv}</option>`+sel.innerHTML;
    }
  }catch(e){ document.getElementById('p-servidor').innerHTML=`<option value="${serv||''}" selected>${serv||''}</option>`; }
  openOv('ov-pagamento');
}

async function confirmarPag(){
  const id=document.getElementById('p-id').value;
  const pago_em=document.getElementById('p-data').value;
  const valor_pago=document.getElementById('p-valor').value;
  if(!pago_em||!valor_pago){toast('Informe a data e o valor','err');return;}
  const servidor_novo=document.getElementById('p-servidor').value||'';
  try{
    await api('PUT',`/api/cobrancas/${id}/pagar`,{pago_em,valor_pago:parseFloat(valor_pago),obs_pagamento:document.getElementById('p-obs').value,servidor_novo});
    closeOv('ov-pagamento');toast('Pagamento registrado!');
    if(currentPage==='dashboard')renderDash();
    else if(currentPage==='cobrancas')renderCobs();
    else if(currentPage==='inadimplentes')renderInad();
  }catch{toast('Erro ao registrar','err');}
}

async function cancelCob(id){
  if(!confirm('Cancelar esta cobrança?'))return;
  try{await api('PUT',`/api/cobrancas/${id}/cancelar`);toast('Cobrança cancelada.');renderCobs();}
  catch{toast('Erro','err');}
}

async function gerarMes(){
  try{
    const r=await api('POST','/api/cobrancas/gerar');
    toast(r.novos>0?`${r.novos} cobrança(s) gerada(s).`:'Cobranças do mês já foram geradas.');
    if(currentPage==='dashboard')renderDash();else renderCobs();
  }catch{toast('Erro ao gerar','err');}
}

/* ── HISTÓRICO ── */
async function abrirHist(id,nome){
  try{
    const hist=await api('GET',`/api/clientes/${id}/historico`);
    const pg=hist.filter(h=>h.status==='pago');
    const vc=hist.filter(h=>h.status==='vencido');
    const pn=hist.filter(h=>h.status==='pendente');
    document.getElementById('h-title').textContent='Histórico — '+nome;
    document.getElementById('h-stats').innerHTML=`
      <div class="hist-stat"><div class="hist-stat-label">Total pago</div><div class="hist-stat-val" style="color:var(--green)">${fmtV(pg.reduce((s,h)=>s+(h.valor_pago||h.valor),0))}</div></div>
      <div class="hist-stat"><div class="hist-stat-label">Vencidas</div><div class="hist-stat-val" style="color:var(--red)">${vc.length}</div></div>
      <div class="hist-stat"><div class="hist-stat-label">Em aberto</div><div class="hist-stat-val" style="color:var(--amber)">${pn.length}</div></div>`;
    document.getElementById('h-lista').innerHTML=hist.length===0
      ?'<div class="empty"><i class="ti ti-receipt-off"></i><p>Nenhuma cobrança encontrada.</p></div>'
      :`<table><thead><tr>
          <th style="width:22%">Referência</th><th style="width:16%">Vencimento</th><th style="width:16%">Pagamento</th>
          <th style="width:14%">Valor</th><th style="width:14%">Valor pago</th><th style="width:18%">Status</th>
        </tr></thead><tbody>${hist.map(h=>`<tr>
          <td style="font-weight:500;white-space:nowrap">${fmtMesRef(h.mes_ref)}</td><td>${fmtD(h.vencimento)}</td><td>${h.pago_em?fmtD(h.pago_em):'—'}</td>
          <td>${fmtV(h.valor)}</td><td>${h.valor_pago!=null?fmtV(h.valor_pago):'—'}</td>
          <td><span class="badge badge-${h.status}">${LBL[h.status]}</span></td>
        </tr>`).join('')}</tbody></table>`;
    openOv('ov-hist');
  }catch{toast('Erro ao carregar histórico','err');}
}

/* ── WHATSAPP ── */
async function abrirWapp(clienteId,tipoInicial){
  wappClienteId=clienteId;
  document.getElementById('wapp-preview').textContent='Carregando...';
  document.getElementById('wapp-info').textContent='';
  document.getElementById('wapp-sem-tel').textContent='';
  openOv('ov-wapp');
  await carregarWapp(clienteId, tipoInicial||'pendente');
}

async function carregarWapp(clienteId,tipo){
  wappDados=null;
  const btP=document.getElementById('wapp-tab-pend');
  const btV=document.getElementById('wapp-tab-venc');
  btP.className='btn btn-sm'+(tipo==='pendente'?' btn-amber':'');
  btV.className='btn btn-sm'+(tipo==='vencido'?' btn-danger':'');
  try{
    const d=await api('GET',`/api/whatsapp/${clienteId}?tipo=${tipo}`);
    wappDados={...d,clienteId,tipo};
    document.getElementById('wapp-title').textContent='WhatsApp — '+(tipo==='pendente'?'Pendentes':'Vencidas');
    if(d.vazio){
      document.getElementById('wapp-preview').textContent=`Nenhuma cobrança ${tipo==='vencido'?'vencida':'pendente'} encontrada.`;
      document.getElementById('wapp-btn-abrir').disabled=true;
      document.getElementById('wapp-info').textContent='';
      return;
    }
    document.getElementById('wapp-btn-abrir').disabled=false;
    document.getElementById('wapp-preview').textContent=d.mensagem;
    document.getElementById('wapp-info').textContent=`${d.qtd} parcela(s) · Total: ${fmtV(d.total)}`;
    document.getElementById('wapp-sem-tel').textContent=d.tel?'':`⚠️ Cliente sem celular cadastrado. O WhatsApp abrirá sem número.`;
  }catch(e){
    document.getElementById('wapp-preview').textContent='Erro ao gerar mensagem.';
    toast('Erro WhatsApp','err');
  }
}

async function trocarAbaWapp(tipo){
  if(!wappClienteId)return;
  await carregarWapp(wappClienteId,tipo);
}

function abrirWhatsApp(){
  if(!wappDados||!wappDados.mensagem)return;
  const tel=wappDados.tel||'';
  const msg=encodeURIComponent(wappDados.mensagem);
  window.open(tel?`https://wa.me/55${tel}?text=${msg}`:`https://wa.me/?text=${msg}`,'_blank');
}

function copiarMensagem(){
  if(!wappDados||!wappDados.mensagem)return;
  navigator.clipboard.writeText(wappDados.mensagem)
    .then(()=>toast('Mensagem copiada!'))
    .catch(()=>toast('Erro ao copiar','err'));
}

/* ── CONFIGURAÇÕES ── */
async function carregarConfigs(){
  try{
    const cfg=await api('GET','/api/configuracoes');
    document.getElementById('cfg-pix').value=cfg.pix||'';
    document.getElementById('cfg-msg-pendente').value=cfg.msg_pendente||'';
    document.getElementById('cfg-msg-vencido').value=cfg.msg_vencido||'';
  }catch{toast('Erro ao carregar configurações','err');}
}

async function salvarConfigs(){
  const pix=document.getElementById('cfg-pix').value.trim();
  const pendente=document.getElementById('cfg-msg-pendente').value;
  const vencido=document.getElementById('cfg-msg-vencido').value;
  if(!pendente||!vencido){toast('Preencha ambas as mensagens','err');return;}
  try{
    await api('PUT','/api/configuracoes',{pix,msg_pendente:pendente,msg_vencido:vencido});
    toast('Configurações salvas!');
  }catch{toast('Erro ao salvar','err');}
}

function inserirVar(fieldId,variavel){
  const el=document.getElementById(fieldId);
  const s=el.selectionStart,e=el.selectionEnd;
  el.value=el.value.slice(0,s)+variavel+el.value.slice(e);
  el.selectionStart=el.selectionEnd=s+variavel.length;
  el.focus();
}

/* ── SEED ── */
async function gerarTeste(){
  if(!confirm('Isso vai substituir todos os dados. Continuar?'))return;
  try{
    await api('POST','/api/seed');
    toast('Dados de teste gerados!');
    renderClientes();
  }catch{toast('Erro ao gerar dados','err');}
}

/* ── RECEBIMENTO EM LOTE ── */
let loteStep = 1;
let loteClienteId = null;
let loteCliente = null;
let loteAbertas = [];
let loteFuturos = [];
let loteSelIds = [];
let loteSelMeses = [];

function loteSetStep(n) {
  loteStep = n;
  [1,2,3].forEach(i => {
    document.getElementById('lote-step-'+i).classList.toggle('active', i===n);
    const dot = document.getElementById('lote-dot-'+i);
    dot.className = 'step-dot '+(i<n?'done':i===n?'active':'pending');
    dot.innerHTML = i<n?'<i class="ti ti-check" style="font-size:13px"></i>':String(i);
  });
  [1,2].forEach(i => document.getElementById('lote-line-'+i).classList.toggle('done', i<n));
  document.getElementById('lote-btn-voltar').style.display    = n>1  ? '':'none';
  document.getElementById('lote-btn-avancar').style.display   = n<3  ? '':'none';
  document.getElementById('lote-btn-confirmar').style.display = n===3 ? '':'none';
}

async function abrirLote() {
  loteStep=1; loteClienteId=null; loteCliente=null;
  loteAbertas=[]; loteFuturos=[]; loteSelIds=[]; loteSelMeses=[];
  try {
    const lista = await api('GET','/api/clientes?status=ativo');
    const sel = document.getElementById('lote-cliente-sel');
    sel.innerHTML = '<option value="">Selecione um cliente...</option>' +
      lista.map(c=>`<option value="${c.id}">${c.nome} \u2014 ${c.servidor}</option>`).join('');
  } catch(e) { toast('Erro ao carregar clientes','err'); return; }
  loteSetStep(1);
  document.getElementById('lote-step1-info').innerHTML =
    '<span style="color:var(--muted);font-size:13px">Selecione um cliente para ver as parcelas disponíveis.</span>';
  document.getElementById('lote-lista-parcelas').innerHTML='';
  document.getElementById('lote-resumo').style.display='none';
  document.getElementById('lote-data').value=hoje();
  document.getElementById('lote-valor').value='';
  document.getElementById('lote-obs').value='';
  openOv('ov-lote');
}

async function loteCarregarParcelas() {
  const clienteId = document.getElementById('lote-cliente-sel').value;
  if (!clienteId) return;
  const info = document.getElementById('lote-step1-info');
  info.innerHTML = '<span style="color:var(--muted);font-size:13px">Carregando...</span>';
  try {
    const d = await api('GET', `/api/clientes/${clienteId}/parcelas-lote`);
    loteClienteId = clienteId;
    loteCliente   = d.cliente;
    loteAbertas   = d.abertas;
    loteFuturos   = d.futuros;
    const totalDisp = loteAbertas.length + loteFuturos.length;
    if (!totalDisp) {
      info.innerHTML = `<div style="text-align:center;padding:1rem;color:var(--green)"><i class="ti ti-circle-check" style="font-size:28px;display:block;margin-bottom:6px"></i>Nenhuma parcela pendente para <strong>${d.cliente.nome}</strong>.</div>`;
      return;
    }
    loteSelIds   = loteAbertas.map(p=>p.id);
    loteSelMeses = [];
    document.getElementById('lote-nome').textContent = d.cliente.nome;
    document.getElementById('lote-sub').textContent  = `${d.cliente.servidor} \u00b7 Dia ${d.cliente.dia} \u00b7 ${fmtV(d.cliente.valor)}/m\u00eas`;
    renderLoteParcelas();
    const totalAberto = loteAbertas.reduce((s,p)=>s+p.valor,0);
    document.getElementById('lote-valor').value = totalAberto>0 ? totalAberto.toFixed(2) : d.cliente.valor.toFixed(2);
    loteAtualizarResumo();
    const nAb = loteAbertas.length, nFut = loteFuturos.length;
    info.innerHTML = `<div style="font-size:13px;color:var(--muted)">
      ${nAb>0?`<span style="color:var(--amber)">\u26a0 ${nAb} parcela(s) em aberto/vencidas</span> \u00b7 `:'<span style="color:var(--green)">\u2713 Sem parcelas em atraso</span> \u00b7 '}
      ${nFut} m\u00eas(es) futuros dispon\u00edveis \u2014 clique em <strong>Pr\u00f3ximo</strong>.
    </div>`;
  } catch(e) {
    console.error('loteCarregarParcelas erro:',e);
    info.innerHTML = `<span style="color:var(--red);font-size:13px">Erro ao carregar parcelas: ${e.message}</span>`;
  }
}

function renderLoteParcelas() {
  const container = document.getElementById('lote-lista-parcelas');
  let html = '';
  if (loteAbertas.length) {
    html += `<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;padding:4px 2px 6px">Em aberto / vencidas</div>`;
    html += loteAbertas.map(p => {
      const sel = loteSelIds.includes(p.id);
      const [a,m] = p.mes_ref.split('-');
      return `<label class="lote-parcela${sel?' selected':''}" id="lote-par-${p.id}">
        <input type="checkbox" ${sel?'checked':''} onchange="loteToggleId('${p.id}',this.checked)">
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="lote-parcela-mes">${mesNome(parseInt(m))}/${a}</span>
            <span class="lote-parcela-val">${fmtV(p.valor)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:2px">
            <span class="lote-parcela-venc">Venc: ${fmtD(p.vencimento)} \u00b7 ${p.servidor}</span>
            <span class="badge badge-${p.status}">${LBL[p.status]}</span>
          </div>
        </div>
      </label>`;
    }).join('');
  }
  if (loteFuturos.length) {
    html += `<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;padding:10px 2px 6px">Meses futuros (ser\u00e3o criados automaticamente)</div>`;
    html += loteFuturos.map(p => {
      const sel = loteSelMeses.includes(p.mes_ref);
      const [a,m] = p.mes_ref.split('-');
      return `<label class="lote-parcela${sel?' selected':''}" id="lote-par-${p.mes_ref}">
        <input type="checkbox" ${sel?'checked':''} onchange="loteToggleMes('${p.mes_ref}',this.checked)">
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="lote-parcela-mes">${mesNome(parseInt(m))}/${a}</span>
            <span class="lote-parcela-val">${fmtV(p.valor)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:2px">
            <span class="lote-parcela-venc">Venc: ${fmtD(p.vencimento)} \u00b7 ${p.servidor}</span>
            <span class="badge" style="background:var(--purple-bg);color:var(--purple)">A criar</span>
          </div>
        </div>
      </label>`;
    }).join('');
  }
  container.innerHTML = html;
}

function loteToggleId(id, checked) {
  if (checked) { if(!loteSelIds.includes(id)) loteSelIds.push(id); }
  else         { loteSelIds = loteSelIds.filter(x=>x!==id); }
  document.getElementById('lote-par-'+id)?.classList.toggle('selected', checked);
  loteAtualizarValorSugerido();
  loteAtualizarResumo();
}

function loteToggleMes(mr, checked) {
  if (checked) { if(!loteSelMeses.includes(mr)) loteSelMeses.push(mr); }
  else         { loteSelMeses = loteSelMeses.filter(x=>x!==mr); }
  document.getElementById('lote-par-'+mr)?.classList.toggle('selected', checked);
  loteAtualizarValorSugerido();
  loteAtualizarResumo();
}

function loteAtualizarValorSugerido() {
  const somaAb  = loteAbertas.filter(p=>loteSelIds.includes(p.id)).reduce((s,p)=>s+p.valor,0);
  const somaFut = loteFuturos.filter(p=>loteSelMeses.includes(p.mes_ref)).reduce((s,p)=>s+p.valor,0);
  document.getElementById('lote-valor').value = (somaAb+somaFut).toFixed(2);
}

function loteAtualizarResumo() {
  const qtd   = loteSelIds.length + loteSelMeses.length;
  const valor = parseFloat(document.getElementById('lote-valor').value)||0;
  const res   = document.getElementById('lote-resumo');
  if (!qtd||!valor) { res.style.display='none'; return; }
  res.style.display='';
  document.getElementById('lote-res-qtd').textContent = qtd+' parcela(s)';
  document.getElementById('lote-res-por-parcela').textContent = fmtV(valor/qtd);
  document.getElementById('lote-res-total').textContent = fmtV(valor);
}

async function loteAvancar() {
  if (loteStep===1) {
    if (!loteClienteId) { toast('Selecione um cliente','err'); return; }
    if (!loteAbertas.length && !loteFuturos.length) { toast('Nenhuma parcela disponível','err'); return; }
    loteSetStep(2); return;
  }
  if (loteStep===2) {
    const totalSel = loteSelIds.length + loteSelMeses.length;
    if (!totalSel)  { toast('Selecione ao menos 1 parcela','err'); return; }
    const data  = document.getElementById('lote-data').value;
    const valor = parseFloat(document.getElementById('lote-valor').value);
    if (!data)           { toast('Informe a data do pagamento','err'); return; }
    if (!valor||valor<=0){ toast('Informe o valor recebido','err'); return; }
    const n    = totalSel;
    const base = parseFloat((valor/n).toFixed(2));
    const selAb  = loteAbertas.filter(p=>loteSelIds.includes(p.id)).sort((a,b)=>a.vencimento.localeCompare(b.vencimento));
    const selFut = loteFuturos.filter(p=>loteSelMeses.includes(p.mes_ref)).sort((a,b)=>a.mes_ref.localeCompare(b.mes_ref));
    const todas  = [...selAb, ...selFut];
    document.getElementById('lote-conf-nome').textContent  = loteCliente.nome;
    document.getElementById('lote-conf-data').textContent  = `Data do pagamento: ${fmtD(data)}`;
    document.getElementById('lote-conf-total').textContent = fmtV(valor);
    document.getElementById('lote-conf-rows').innerHTML = todas.map((p,i) => {
      const [a,m] = p.mes_ref.split('-');
      const mes   = mesNome(parseInt(m))+'/'+a;
      const vp    = i===n-1 ? parseFloat((valor-base*(n-1)).toFixed(2)) : base;
      const isFut = p.status==='futuro';
      return `<tr>
        <td style="font-weight:600">${mes}${isFut?' <span style="font-size:10px;color:var(--purple)">(nova)</span>':''}</td>
        <td>${fmtD(p.vencimento)}</td>
        <td style="color:var(--muted)">${p.servidor}</td>
        <td style="text-align:right;font-weight:700;color:var(--green)">${fmtV(vp)}</td>
        <td><span class="badge" style="${isFut?'background:var(--purple-bg);color:var(--purple)':''}${!isFut?'':''}">
          ${isFut?'A criar':LBL[p.status]}</span></td>
      </tr>`;
    }).join('');
    loteSetStep(3);
  }
}

function loteVoltar() { if(loteStep>1) loteSetStep(loteStep-1); }

async function loteConfirmar() {
  const data  = document.getElementById('lote-data').value;
  const valor = parseFloat(document.getElementById('lote-valor').value);
  const obs   = document.getElementById('lote-obs').value.trim();
  const btn   = document.getElementById('lote-btn-confirmar');
  btn.disabled=true;
  btn.innerHTML='<i class="ti ti-loader"></i> Salvando...';
  try {
    const r = await api('POST','/api/cobrancas/receber-lote',{
      cliente_id:     loteClienteId,
      ids_existentes: loteSelIds,
      meses_futuros:  loteSelMeses,
      pago_em:        data,
      valor_total:    valor,
      obs
    });
    closeOv('ov-lote');
    toast(`${r.baixadas.length} parcela(s) baixada(s) com sucesso!`);
    if(currentPage==='dashboard')renderDash();
    else if(currentPage==='cobrancas')renderCobs();
    else if(currentPage==='inadimplentes')renderInad();
  } catch(e) {
    console.error('loteConfirmar erro:',e);
    toast('Erro ao confirmar recebimento','err');
    btn.disabled=false;
    btn.innerHTML='<i class="ti ti-check"></i> Confirmar recebimento';
  }
}


/* ── OUTRAS VENDAS ── */
let ovRegistrosParaImportar = [];
let ovEditId = null;
let ovAbaAtual = 'lista';

function ovMostrarAba(aba) {
  ovAbaAtual = aba;
  document.getElementById('ovpanel-lista').style.display   = aba==='lista'   ? '' : 'none';
  document.getElementById('ovpanel-resumo').style.display  = aba==='resumo'  ? '' : 'none';
  document.getElementById('ovtab-lista').classList.toggle('active',  aba==='lista');
  document.getElementById('ovtab-resumo').classList.toggle('active', aba==='resumo');
  if(aba==='resumo') renderOvResumo();
}

function ovMesAtual(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; }

async function renderOutrasVendas() {
  // Garantir que os elementos existem na DOM antes de prosseguir
  const elDe = document.getElementById('ov-de');
  const elAte = document.getElementById('ov-ate');
  if (!elDe || !elAte) return; // página ainda não está ativa

  if (!elDe.value) elDe.value = ovMesAtual();
  if (!elAte.value) elAte.value = ovMesAtual();

  // Mostrar loading
  const card = document.getElementById('ov-lista-card');
  if (card) card.innerHTML = '<div class="loading"><i class="ti ti-loader"></i> Carregando...</div>';

  // Carregar tipos para o filtro (sem bloquear em caso de erro)
  try {
    const tipos = await api('GET', '/api/outras-vendas/tipos');
    const sel = document.getElementById('ov-tipo');
    if (sel) {
      const prev = sel.value;
      sel.innerHTML = '<option value="">Todos os tipos</option>' +
        tipos.map(t => `<option value="${t}"${t===prev?' selected':''}>${t}</option>`).join('');
    }
  } catch(e) { console.warn('Tipos não carregados:', e.message); }

  const de    = elDe.value;
  const ate   = elAte.value;
  const tipo  = (document.getElementById('ov-tipo') || {value:''}).value;
  const busca = (document.getElementById('ov-busca') || {value:''}).value;

  let url = '/api/outras-vendas?';
  if (de)  url += `de=${de}-01&`;
  if (ate) {
    const [a,m] = ate.split('-');
    const ultimo = new Date(parseInt(a), parseInt(m), 0).getDate();
    url += `ate=${ate}-${String(ultimo).padStart(2,'0')}&`;
  }
  if (tipo)  url += `tipo_rec=${encodeURIComponent(tipo)}&`;
  if (busca) url += `busca=${encodeURIComponent(busca)}&`;

  try {
    const lista = await api('GET', url);
    const totalVal = lista.reduce((s,r) => s + r.total, 0);
    const rodape = document.getElementById('ov-lista-rodape');

    if (!lista.length) {
      card.innerHTML = '<div class="empty"><i class="ti ti-shopping-cart-off"></i><p>Nenhum lançamento encontrado.</p></div>';
      if (rodape) rodape.textContent = '';
      return;
    }
    card.innerHTML = `<div class="table-wrap"><table style="table-layout:fixed">
      <thead><tr>
        <th style="width:10%">Data</th>
        <th style="width:15%">Tipo</th>
        <th style="width:20%">Cliente</th>
        <th style="width:22%">Produto</th>
        <th style="width:10%;text-align:right">Vlr UN</th>
        <th style="width:6%;text-align:center">Qtd</th>
        <th style="width:11%;text-align:right">Total</th>
        <th style="width:6%"></th>
      </tr></thead>
      <tbody>${lista.map(r => `<tr>
        <td>${fmtD(r.data)}</td>
        <td><span class="tipo-badge">${r.tipo_rec}</span></td>
        <td style="font-weight:500">${r.cliente}</td>
        <td style="color:var(--muted)">${r.produto}</td>
        <td style="text-align:right">${fmtV(r.valor_un)}</td>
        <td style="text-align:center;color:var(--muted)">${r.qtde}</td>
        <td style="text-align:right;font-weight:600;color:var(--green)">${fmtV(r.total)}</td>
        <td><div class="actions-row">
          <button class="btn btn-sm" onclick="ovEditar('${r.id}')" title="Editar"><i class="ti ti-edit"></i></button>
          <button class="btn btn-sm btn-danger" onclick="ovExcluir('${r.id}')" title="Excluir"><i class="ti ti-trash"></i></button>
        </div></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
    if (rodape) rodape.innerHTML = `<strong>${lista.length}</strong> registro(s) &nbsp;·&nbsp; Total: <strong style="color:var(--green)">${fmtV(totalVal)}</strong>`;
  } catch(e) {
    console.error('renderOutrasVendas erro:', e);
    if (card) card.innerHTML = `<div class="empty"><i class="ti ti-alert-circle"></i><p>Erro ao carregar: ${e.message}</p></div>`;
  }
}

function ovLimparFiltro(){
  ['ov-de','ov-ate','ov-busca'].forEach(id=>{ const el=document.getElementById(id); if(el)el.value=''; });
  const s=document.getElementById('ov-tipo');if(s)s.value='';
  renderOutrasVendas();
}

/* Resumo */
async function renderOvResumo(){
  const elDe=document.getElementById('ovr-de'), elAte=document.getElementById('ovr-ate');
  if(elDe&&!elDe.value) elDe.value=ovMesAtual();
  if(elAte&&!elAte.value) elAte.value=ovMesAtual();
  const de=(elDe||{value:''}).value;
  const ate=(elAte||{value:''}).value;
  let url='/api/outras-vendas/resumo?';
  if(de){ url+=`de=${de}-01&`; }
  if(ate){
    const [a,m]=ate.split('-');
    const ultimo=new Date(parseInt(a),parseInt(m),0).getDate();
    url+=`ate=${ate}-${String(ultimo).padStart(2,'0')}&`;
  }
  try{
    const r=await api('GET',url);
    document.getElementById('ovr-metricas').innerHTML=`
      <div class="fin-metric"><div class="fin-metric-label">Total recebido</div><div class="fin-metric-val cv-green">${fmtV(r.total)}</div></div>
      <div class="fin-metric"><div class="fin-metric-label">Qtd lançamentos</div><div class="fin-metric-val cv-blue">${r.qtd}</div></div>
      <div class="fin-metric"><div class="fin-metric-label">Tipos distintos</div><div class="fin-metric-val cv-purple">${Object.keys(r.porTipo).length}</div></div>
      <div class="fin-metric"><div class="fin-metric-label">Ticket médio</div><div class="fin-metric-val">${r.qtd?fmtV(r.total/r.qtd):'R$ 0,00'}</div></div>`;

    // Por tipo
    const tiposArr=Object.entries(r.porTipo).sort((a,b)=>b[1].total-a[1].total);
    const maxTipo=tiposArr.length?tiposArr[0][1].total:1;
    document.getElementById('ovr-por-tipo').innerHTML=tiposArr.length===0
      ?'<div style="color:var(--muted);font-size:13px">Sem dados</div>'
      :tiposArr.map(([t,v])=>`
        <div class="dist-bar-wrap">
          <div class="dist-bar-label"><span>${t}</span><span>${v.qtd} lanç. · ${fmtV(v.total)}</span></div>
          <div class="dist-bar"><div class="dist-bar-fill" style="width:${Math.round(v.total/maxTipo*100)}%;background:var(--purple)"></div></div>
        </div>`).join('');

    // Por mês
    const mesesArr=Object.entries(r.porMes).sort((a,b)=>a[0].localeCompare(b[0]));
    const maxMes=mesesArr.length?Math.max(...mesesArr.map(([,v])=>v.total)):1;
    document.getElementById('ovr-por-mes').innerHTML=mesesArr.length===0
      ?'<div style="color:var(--muted);font-size:13px">Sem dados</div>'
      :mesesArr.map(([mr,v])=>{
          return`<div class="dist-bar-wrap">
            <div class="dist-bar-label"><span>${fmtMesRef(mr)}</span><span>${v.qtd} lanç. · ${fmtV(v.total)}</span></div>
            <div class="dist-bar"><div class="dist-bar-fill" style="width:${Math.round(v.total/maxMes*100)}%;background:var(--green)"></div></div>
          </div>`;}).join('');
  }catch(e){toast('Erro ao carregar resumo','err');}
}

function ovLimparResumo(){
  ['ovr-de','ovr-ate'].forEach(id=>{ const el=document.getElementById(id);if(el)el.value=''; });
  renderOvResumo();
}

/* Nova / Editar */
async function ovCarregarSelectTipos(selecionado){
  try{
    const tipos=await api('GET','/api/outras-vendas/tipos');
    const sel=document.getElementById('ov-tipo-rec');
    if(!tipos.length){
      sel.innerHTML='<option value="">Nenhum tipo cadastrado — cadastre em Cadastros Gerais</option>';
      return;
    }
    sel.innerHTML='<option value="">Selecione...</option>'+
      tipos.map(t=>`<option value="${t}"${t===selecionado?' selected':''}>${t}</option>`).join('');
  }catch{
    document.getElementById('ov-tipo-rec').innerHTML='<option value="">Erro ao carregar tipos</option>';
  }
}

async function ovAbrirNovo(){
  ovEditId=null;
  document.getElementById('ov-modal-title').textContent='Nova receita';
  document.getElementById('ov-data').value=hoje();
  document.getElementById('ov-cliente').value='';
  document.getElementById('ov-produto').value='';
  document.getElementById('ov-valor-un').value='';
  document.getElementById('ov-qtde').value='1';
  document.getElementById('ov-total').value='';
  document.getElementById('ov-edit-id').value='';
  await ovCarregarSelectTipos('');
  openOv('ov-modal-venda');
}

async function ovEditar(id){
  try{
    const r = await api('GET', `/api/outras-vendas/${id}`);
    if(!r){ toast('Registro não encontrado','err'); return; }
    ovEditId = id;
    document.getElementById('ov-modal-title').textContent = 'Editar receita';
    document.getElementById('ov-data').value      = r.data;
    document.getElementById('ov-cliente').value   = r.cliente;
    document.getElementById('ov-produto').value   = r.produto;
    document.getElementById('ov-valor-un').value  = r.valor_un;
    document.getElementById('ov-qtde').value      = r.qtde;
    document.getElementById('ov-total').value     = r.total;
    document.getElementById('ov-edit-id').value   = id;
    await ovCarregarSelectTipos(r.tipo_rec);
    openOv('ov-modal-venda');
  } catch(e){ toast('Erro ao carregar registro','err'); console.error(e); }
}

function ovCalcTotal(){
  const vu=parseFloat(document.getElementById('ov-valor-un').value)||0;
  const q=parseInt(document.getElementById('ov-qtde').value)||1;
  document.getElementById('ov-total').value=(vu*q).toFixed(2);
}

async function ovSalvar(){
  const g=x=>document.getElementById(x).value.trim();
  if(!g('ov-data')||!g('ov-tipo-rec')||!g('ov-cliente')||!g('ov-produto')||!g('ov-valor-un')){
    toast('Preencha todos os campos obrigatórios','err'); return;
  }
  const body={
    data:g('ov-data'), tipo_rec:g('ov-tipo-rec'), cliente:g('ov-cliente'),
    produto:g('ov-produto'), valor_un:parseFloat(g('ov-valor-un')),
    qtde:parseInt(document.getElementById('ov-qtde').value)||1,
    total:parseFloat(document.getElementById('ov-total').value)||parseFloat(g('ov-valor-un'))
  };
  try{
    if(ovEditId) await api('PUT',`/api/outras-vendas/${ovEditId}`,body);
    else         await api('POST','/api/outras-vendas',body);
    closeOv('ov-modal-venda');
    toast(ovEditId?'Registro atualizado!':'Venda salva!');
    renderOutrasVendas();
  }catch(e){toast('Erro ao salvar','err');}
}

async function ovExcluir(id){
  if(!confirm('Excluir este registro?'))return;
  try{ await api('DELETE',`/api/outras-vendas/${id}`); toast('Excluído.'); renderOutrasVendas(); }
  catch{ toast('Erro ao excluir','err'); }
}

/* Importação */
function ovAbrirImportar(){
  ovRegistrosParaImportar=[];
  document.getElementById('ov-paste-area').value='';
  document.getElementById('ov-import-preview').style.display='none';
  document.getElementById('ov-btn-importar').disabled=true;
  document.getElementById('ov-btn-count').textContent='';
  openOv('ov-modal-importar');
}

function ovHandleDrop(e){
  e.preventDefault();
  document.getElementById('ov-drop-area').classList.remove('drag');
  const file=e.dataTransfer.files[0];
  if(file) ovHandleFile({files:[file]});
}

function ovHandleFile(input){
  const file=input.files[0];
  if(!file){return;}
  // Tentar ler como texto TSV/CSV
  const reader=new FileReader();
  reader.onload=ev=>{
    document.getElementById('ov-paste-area').value=ev.target.result;
    ovParsePaste();
  };
  reader.readAsText(file,'UTF-8');
}

function ovParsarValor(s){
  if(!s) return 0;
  return parseFloat(String(s).replace(/R\$\s?/g,'').replace(/\./g,'').replace(',','.').trim())||0;
}

function ovParsePaste(){
  const texto=document.getElementById('ov-paste-area').value.trim();
  if(!texto){ document.getElementById('ov-import-preview').style.display='none'; return; }

  const linhas=texto.split(/\r?\n/).map(l=>l.trim()).filter(l=>l);
  // Detectar separador
  const sep=linhas[0].indexOf('\t')>=0 ? '\t' : ';';

  // Verificar se primeira linha é cabeçalho
  const primeiraLower=linhas[0].toLowerCase();
  const temHeader=primeiraLower.includes('data')||primeiraLower.includes('tipo')||primeiraLower.includes('cliente');
  const inicio=temHeader?1:0;

  const registros=[];
  const erros=[];
  for(let i=inicio;i<linhas.length;i++){
    const cols=linhas[i].split(sep);
    if(cols.length<6){ erros.push(`Linha ${i+1}: colunas insuficientes`); continue; }
    const data    = cols[0]?.trim();
    const tipo    = cols[1]?.trim();
    const cliente = cols[2]?.trim();
    const produto = cols[3]?.trim();
    const valorUn = ovParsarValor(cols[4]);
    const qtde    = parseInt(cols[5]?.trim())||1;
    const total   = cols[6]!=null ? ovParsarValor(cols[6]) : valorUn*qtde;
    if(!data||!tipo||!cliente){ erros.push(`Linha ${i+1}: dados incompletos`); continue; }
    registros.push({data,tipo_rec:tipo,cliente,produto:produto||'-',valor_un:valorUn,qtde,total:total||valorUn*qtde});
  }

  ovRegistrosParaImportar=registros;
  const prev=document.getElementById('ov-import-preview');
  prev.style.display='';
  document.getElementById('ov-preview-count').textContent=registros.length;
  document.getElementById('ov-preview-erros').textContent=erros.length?`(${erros.length} linha(s) ignorada(s))`:'';
  document.getElementById('ov-btn-importar').disabled=registros.length===0;
  document.getElementById('ov-btn-count').textContent=registros.length?`(${registros.length})`:'';

  document.getElementById('ov-preview-body').innerHTML=registros.slice(0,50).map(r=>`<tr>
    <td style="padding:5px 8px;white-space:nowrap">${r.data}</td>
    <td style="padding:5px 8px"><span class="tipo-badge">${r.tipo_rec}</span></td>
    <td style="padding:5px 8px">${r.cliente}</td>
    <td style="padding:5px 8px;color:var(--muted)">${r.produto}</td>
    <td style="padding:5px 8px;text-align:right">${fmtV(r.valor_un)}</td>
    <td style="padding:5px 8px;text-align:center">${r.qtde}</td>
    <td style="padding:5px 8px;text-align:right;color:var(--green);font-weight:600">${fmtV(r.total)}</td>
    <td style="padding:5px 8px;text-align:center;color:var(--green)"><i class="ti ti-check"></i></td>
  </tr>`).join('')+(registros.length>50?`<tr><td colspan="8" style="padding:8px;text-align:center;color:var(--muted)">... e mais ${registros.length-50} registros</td></tr>`:'');
}

async function ovConfirmarImporte(){
  if(!ovRegistrosParaImportar.length){toast('Nenhum registro para importar','err');return;}
  const btn=document.getElementById('ov-btn-importar');
  btn.disabled=true;
  btn.innerHTML='<i class="ti ti-loader"></i> Importando...';
  try{
    const r=await api('POST','/api/outras-vendas/importar',{registros:ovRegistrosParaImportar});
    closeOv('ov-modal-importar');
    const msgOv = `${r.importados} importado(s)`+(r.ignorados?` · ${r.ignorados} já existia(m), ignorado(s)`:'')+'!';
    toast(msgOv);
    renderOutrasVendas();
  }catch(e){
    toast('Erro ao importar: '+e.message,'err');
    btn.disabled=false;
    btn.innerHTML='<i class="ti ti-upload"></i> Importar';
  }
}


/* ── DESPESAS ── */
let dpRegistrosParaImportar = [];
let dpEditId = null;
let dpAbaAtual = 'lista';

function dpMostrarAba(aba) {
  dpAbaAtual = aba;
  document.getElementById('dppanel-lista').style.display  = aba==='lista'  ? '' : 'none';
  document.getElementById('dppanel-resumo').style.display = aba==='resumo' ? '' : 'none';
  document.getElementById('dptab-lista').classList.toggle('active',  aba==='lista');
  document.getElementById('dptab-resumo').classList.toggle('active', aba==='resumo');
  if (aba==='resumo') renderDpResumo();
}

function dpMesAtual(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; }

async function renderDespesas() {
  const elDe = document.getElementById('dp-de');
  const elAte = document.getElementById('dp-ate');
  if (!elDe || !elAte) return;

  if (!elDe.value) elDe.value = dpMesAtual();
  if (!elAte.value) elAte.value = dpMesAtual();

  const card = document.getElementById('dp-lista-card');
  if (card) card.innerHTML = '<div class="loading"><i class="ti ti-loader"></i> Carregando...</div>';

  try {
    const tipos = await api('GET', '/api/despesas/tipos');
    const sel = document.getElementById('dp-tipo');
    if (sel) {
      const prev = sel.value;
      sel.innerHTML = '<option value="">Todos os tipos</option>' +
        tipos.map(t => `<option value="${t}"${t===prev?' selected':''}>${t}</option>`).join('');
    }
  } catch(e) { console.warn('Tipos despesa não carregados:', e.message); }

  const de    = elDe.value;
  const ate   = elAte.value;
  const tipo  = (document.getElementById('dp-tipo') || {value:''}).value;
  const busca = (document.getElementById('dp-busca') || {value:''}).value;

  let url = '/api/despesas?';
  if (de)  url += `de=${de}-01&`;
  if (ate) {
    const [a,m] = ate.split('-');
    const ultimo = new Date(parseInt(a), parseInt(m), 0).getDate();
    url += `ate=${ate}-${String(ultimo).padStart(2,'0')}&`;
  }
  if (tipo)  url += `tipo=${encodeURIComponent(tipo)}&`;
  if (busca) url += `busca=${encodeURIComponent(busca)}&`;

  try {
    const lista = await api('GET', url);
    const totalVal = lista.reduce((s,r) => s + r.total, 0);
    const rodape = document.getElementById('dp-lista-rodape');

    if (!lista.length) {
      card.innerHTML = '<div class="empty"><i class="ti ti-receipt-2"></i><p>Nenhuma despesa encontrada.</p></div>';
      if (rodape) rodape.textContent = '';
      return;
    }
    card.innerHTML = `<div class="table-wrap"><table style="table-layout:fixed">
      <thead><tr>
        <th style="width:10%">Data</th>
        <th style="width:15%">Tipo</th>
        <th style="width:20%">Responsável</th>
        <th style="width:22%">Descrição</th>
        <th style="width:10%;text-align:right">Vlr UN</th>
        <th style="width:6%;text-align:center">Qtd</th>
        <th style="width:11%;text-align:right">Total</th>
        <th style="width:6%"></th>
      </tr></thead>
      <tbody>${lista.map(r => `<tr>
        <td>${fmtD(r.data)}</td>
        <td><span class="tipo-badge">${r.tipo}</span></td>
        <td style="font-weight:500">${r.responsavel||'—'}</td>
        <td style="color:var(--muted)">${r.descricao||'—'}</td>
        <td style="text-align:right">${fmtV(r.valor_un)}</td>
        <td style="text-align:center;color:var(--muted)">${r.qtde}</td>
        <td style="text-align:right;font-weight:600;color:var(--red)">${fmtV(r.total)}</td>
        <td><div class="actions-row">
          <button class="btn btn-sm" onclick="dpEditar('${r.id}')" title="Editar"><i class="ti ti-edit"></i></button>
          <button class="btn btn-sm btn-danger" onclick="dpExcluir('${r.id}')" title="Excluir"><i class="ti ti-trash"></i></button>
        </div></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
    if (rodape) rodape.innerHTML = `<strong>${lista.length}</strong> registro(s) &nbsp;·&nbsp; Total: <strong style="color:var(--red)">${fmtV(totalVal)}</strong>`;
  } catch(e) {
    console.error('renderDespesas erro:', e);
    if (card) card.innerHTML = `<div class="empty"><i class="ti ti-alert-circle"></i><p>Erro ao carregar: ${e.message}</p></div>`;
  }
}

function dpLimparFiltro(){
  ['dp-de','dp-ate','dp-busca'].forEach(id=>{ const el=document.getElementById(id); if(el)el.value=''; });
  const s=document.getElementById('dp-tipo'); if(s)s.value='';
  renderDespesas();
}

async function renderDpResumo(){
  const elDe=document.getElementById('dpr-de'), elAte=document.getElementById('dpr-ate');
  if(elDe&&!elDe.value) elDe.value=dpMesAtual();
  if(elAte&&!elAte.value) elAte.value=dpMesAtual();
  const de=(elDe||{value:''}).value;
  const ate=(elAte||{value:''}).value;
  let url='/api/despesas/resumo?';
  if(de){ url+=`de=${de}-01&`; }
  if(ate){
    const [a,m]=ate.split('-');
    const ultimo=new Date(parseInt(a),parseInt(m),0).getDate();
    url+=`ate=${ate}-${String(ultimo).padStart(2,'0')}&`;
  }
  try{
    const r=await api('GET',url);
    document.getElementById('dpr-metricas').innerHTML=`
      <div class="fin-metric"><div class="fin-metric-label">Total gasto</div><div class="fin-metric-val cv-red">${fmtV(r.total)}</div></div>
      <div class="fin-metric"><div class="fin-metric-label">Qtd lançamentos</div><div class="fin-metric-val cv-blue">${r.qtd}</div></div>
      <div class="fin-metric"><div class="fin-metric-label">Tipos distintos</div><div class="fin-metric-val cv-purple">${Object.keys(r.porTipo).length}</div></div>
      <div class="fin-metric"><div class="fin-metric-label">Gasto médio</div><div class="fin-metric-val">${r.qtd?fmtV(r.total/r.qtd):'R$ 0,00'}</div></div>`;

    const tiposArr=Object.entries(r.porTipo).sort((a,b)=>b[1].total-a[1].total);
    const maxTipo=tiposArr.length?tiposArr[0][1].total:1;
    document.getElementById('dpr-por-tipo').innerHTML=tiposArr.length===0
      ?'<div style="color:var(--muted);font-size:13px">Sem dados</div>'
      :tiposArr.map(([t,v])=>`
        <div class="dist-bar-wrap">
          <div class="dist-bar-label"><span>${t}</span><span>${v.qtd} lanç. · ${fmtV(v.total)}</span></div>
          <div class="dist-bar"><div class="dist-bar-fill" style="width:${Math.round(v.total/maxTipo*100)}%;background:var(--red)"></div></div>
        </div>`).join('');

    const mesesArr=Object.entries(r.porMes).sort((a,b)=>a[0].localeCompare(b[0]));
    const maxMes=mesesArr.length?Math.max(...mesesArr.map(([,v])=>v.total)):1;
    document.getElementById('dpr-por-mes').innerHTML=mesesArr.length===0
      ?'<div style="color:var(--muted);font-size:13px">Sem dados</div>'
      :mesesArr.map(([mr,v])=>{
          return`<div class="dist-bar-wrap">
            <div class="dist-bar-label"><span>${fmtMesRef(mr)}</span><span>${v.qtd} lanç. · ${fmtV(v.total)}</span></div>
            <div class="dist-bar"><div class="dist-bar-fill" style="width:${Math.round(v.total/maxMes*100)}%;background:var(--amber)"></div></div>
          </div>`;}).join('');
  }catch(e){toast('Erro ao carregar resumo','err');}
}

function dpLimparResumo(){
  ['dpr-de','dpr-ate'].forEach(id=>{ const el=document.getElementById(id);if(el)el.value=''; });
  renderDpResumo();
}

async function dpCarregarSelectTipos(selecionado){
  try{
    const tipos=await api('GET','/api/despesas/tipos');
    const sel=document.getElementById('dp-tipo-rec');
    if(!tipos.length){
      sel.innerHTML='<option value="">Nenhum tipo cadastrado — cadastre em Cadastros Gerais</option>';
      return;
    }
    sel.innerHTML='<option value="">Selecione...</option>'+
      tipos.map(t=>`<option value="${t}"${t===selecionado?' selected':''}>${t}</option>`).join('');
  }catch{
    document.getElementById('dp-tipo-rec').innerHTML='<option value="">Erro ao carregar tipos</option>';
  }
}

async function dpAbrirNovo(){
  dpEditId=null;
  document.getElementById('dp-modal-title').textContent='Nova despesa';
  document.getElementById('dp-data').value=hoje();
  document.getElementById('dp-responsavel').value='';
  document.getElementById('dp-descricao').value='';
  document.getElementById('dp-valor-un').value='';
  document.getElementById('dp-qtde').value='1';
  document.getElementById('dp-total').value='';
  document.getElementById('dp-edit-id').value='';
  await dpCarregarSelectTipos('');
  openOv('dp-modal-venda');
}

async function dpEditar(id){
  try{
    const r = await api('GET', `/api/despesas/${id}`);
    if(!r){ toast('Registro não encontrado','err'); return; }
    dpEditId = id;
    document.getElementById('dp-modal-title').textContent = 'Editar despesa';
    document.getElementById('dp-data').value        = r.data;
    document.getElementById('dp-responsavel').value  = r.responsavel||'';
    document.getElementById('dp-descricao').value    = r.descricao||'';
    document.getElementById('dp-valor-un').value     = r.valor_un;
    document.getElementById('dp-qtde').value         = r.qtde;
    document.getElementById('dp-total').value        = r.total;
    document.getElementById('dp-edit-id').value      = id;
    await dpCarregarSelectTipos(r.tipo);
    openOv('dp-modal-venda');
  } catch(e){ toast('Erro ao carregar registro','err'); console.error(e); }
}

function dpCalcTotal(){
  const vu=parseFloat(document.getElementById('dp-valor-un').value)||0;
  const q=parseInt(document.getElementById('dp-qtde').value)||1;
  document.getElementById('dp-total').value=(vu*q).toFixed(2);
}

async function dpSalvar(){
  const g=x=>document.getElementById(x).value.trim();
  if(!g('dp-data')||!g('dp-tipo-rec')||!g('dp-valor-un')){
    toast('Preencha data, tipo e valor','err'); return;
  }
  const body={
    data:g('dp-data'), tipo:g('dp-tipo-rec'), responsavel:g('dp-responsavel'),
    descricao:g('dp-descricao'), valor_un:parseFloat(g('dp-valor-un')),
    qtde:parseInt(document.getElementById('dp-qtde').value)||1,
    total:parseFloat(document.getElementById('dp-total').value)||parseFloat(g('dp-valor-un'))
  };
  try{
    if(dpEditId) await api('PUT',`/api/despesas/${dpEditId}`,body);
    else         await api('POST','/api/despesas',body);
    closeOv('dp-modal-venda');
    toast(dpEditId?'Registro atualizado!':'Despesa salva!');
    renderDespesas();
  }catch(e){toast('Erro ao salvar','err');}
}

async function dpExcluir(id){
  if(!confirm('Excluir este registro?'))return;
  try{ await api('DELETE',`/api/despesas/${id}`); toast('Excluído.'); renderDespesas(); }
  catch{ toast('Erro ao excluir','err'); }
}

/* Importação de despesas */
function dpAbrirImportar(){
  dpRegistrosParaImportar=[];
  document.getElementById('dp-paste-area').value='';
  document.getElementById('dp-import-preview').style.display='none';
  document.getElementById('dp-btn-importar').disabled=true;
  document.getElementById('dp-btn-count').textContent='';
  openOv('dp-modal-importar');
}

function dpHandleDrop(e){
  e.preventDefault();
  document.getElementById('dp-drop-area').classList.remove('drag');
  const file=e.dataTransfer.files[0];
  if(file) dpHandleFile({files:[file]});
}

function dpHandleFile(input){
  const file=input.files[0];
  if(!file){return;}
  const reader=new FileReader();
  reader.onload=ev=>{
    document.getElementById('dp-paste-area').value=ev.target.result;
    dpParsePaste();
  };
  reader.readAsText(file,'UTF-8');
}

function dpParsarValor(s){
  if(!s) return 0;
  return parseFloat(String(s).replace(/R\$\s?/g,'').replace(/\./g,'').replace(',','.').trim())||0;
}

// Converte data tipo "05/jan" para ISO, assumindo ano corrente (ou anterior se mês já passou muito à frente)
function dpParsarDataAbreviada(s){
  if(!s) return null;
  s = s.trim();
  // Formato dd/mm/yyyy completo
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [d,m,a] = s.split('/');
    return `${a}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  // Formato dd/mmm (abreviação portuguesa do mês)
  const meses = {jan:'01',fev:'02',mar:'03',abr:'04',mai:'05',jun:'06',jul:'07',ago:'08',set:'09',out:'10',nov:'11',dez:'12'};
  const m = s.toLowerCase().match(/^(\d{1,2})\/([a-zç]{3,})/);
  if (m) {
    const dia = m[1].padStart(2,'0');
    const mesAbrev = m[2].slice(0,3);
    const mesNum = meses[mesAbrev];
    if (mesNum) {
      // Assume ano atual; ajuste manual depois se necessário
      const ano = new Date().getFullYear();
      return `${ano}-${mesNum}-${dia}`;
    }
  }
  return null;
}

function dpParsePaste(){
  const texto=document.getElementById('dp-paste-area').value.trim();
  if(!texto){ document.getElementById('dp-import-preview').style.display='none'; return; }

  const linhas=texto.split(/\r?\n/).map(l=>l.trim()).filter(l=>l);
  const sep=linhas[0].indexOf('\t')>=0 ? '\t' : ';';

  const primeiraLower=linhas[0].toLowerCase();
  const temHeader=primeiraLower.includes('data')||primeiraLower.includes('tipo')||primeiraLower.includes('responsável')||primeiraLower.includes('responsavel');
  const inicio=temHeader?1:0;

  // Formato esperado: Data | Vl Unit | Qtde | Total | Responsável/Servidor | Nome cliente | Tipo
  const registros=[];
  const erros=[];
  for(let i=inicio;i<linhas.length;i++){
    const cols=linhas[i].split(sep);
    if(cols.length<7){ erros.push(`Linha ${i+1}: colunas insuficientes`); continue; }
    const dataRaw    = cols[0]?.trim();
    const valorUn     = dpParsarValor(cols[1]);
    const qtde        = parseInt(cols[2]?.trim())||1;
    const totalRaw    = cols[3]?.trim();
    const responsavel = cols[4]?.trim();
    const descricao   = cols[5]?.trim();
    const tipo        = cols[6]?.trim();

    const dataISO = dpParsarDataAbreviada(dataRaw);
    if(!dataISO){ erros.push(`Linha ${i+1}: data inválida (${dataRaw})`); continue; }
    if(!tipo){ erros.push(`Linha ${i+1}: tipo vazio`); continue; }

    const total = totalRaw ? dpParsarValor(totalRaw) : valorUn*qtde;
    registros.push({
      data:dataISO, tipo, responsavel:responsavel||'', descricao:descricao||'',
      valor_un:valorUn, qtde, total:total||valorUn*qtde
    });
  }

  dpRegistrosParaImportar=registros;
  const prev=document.getElementById('dp-import-preview');
  prev.style.display='';
  document.getElementById('dp-preview-count').textContent=registros.length;
  document.getElementById('dp-preview-erros').textContent=erros.length?`(${erros.length} linha(s) ignorada(s))`:'';
  document.getElementById('dp-btn-importar').disabled=registros.length===0;
  document.getElementById('dp-btn-count').textContent=registros.length?`(${registros.length})`:'';

  document.getElementById('dp-preview-body').innerHTML=registros.slice(0,50).map(r=>`<tr>
    <td style="padding:5px 8px;white-space:nowrap">${fmtD(r.data)}</td>
    <td style="padding:5px 8px"><span class="tipo-badge">${r.tipo}</span></td>
    <td style="padding:5px 8px">${r.responsavel}</td>
    <td style="padding:5px 8px;color:var(--muted)">${r.descricao}</td>
    <td style="padding:5px 8px;text-align:right">${fmtV(r.valor_un)}</td>
    <td style="padding:5px 8px;text-align:center">${r.qtde}</td>
    <td style="padding:5px 8px;text-align:right;color:var(--red);font-weight:600">${fmtV(r.total)}</td>
    <td style="padding:5px 8px;text-align:center;color:var(--green)"><i class="ti ti-check"></i></td>
  </tr>`).join('')+(registros.length>50?`<tr><td colspan="8" style="padding:8px;text-align:center;color:var(--muted)">... e mais ${registros.length-50} registros</td></tr>`:'');
}

async function dpConfirmarImporte(){
  if(!dpRegistrosParaImportar.length){toast('Nenhum registro para importar','err');return;}
  const btn=document.getElementById('dp-btn-importar');
  btn.disabled=true;
  btn.innerHTML='<i class="ti ti-loader"></i> Importando...';
  try{
    const r=await api('POST','/api/despesas/importar',{registros:dpRegistrosParaImportar});
    closeOv('dp-modal-importar');
    const msgDp = `${r.importados} importado(s)`+(r.ignorados?` · ${r.ignorados} já existia(m), ignorado(s)`:'')+'!';
    toast(msgDp);
    renderDespesas();
  }catch(e){
    toast('Erro ao importar: '+e.message,'err');
    btn.disabled=false;
    btn.innerHTML='<i class="ti ti-upload"></i> Importar';
  }
}



/* ── IMPORTAÇÃO PLANILHA IPTV ── */
let iptvLinhas = []; // array de arrays de strings (uma por cliente)

function abrirImportarIPTV(){
  try {
    console.log('abrirImportarIPTV chamado');
    iptvLinhas = [];
    const paste = document.getElementById('iptv-paste');
    const preview = document.getElementById('iptv-preview');
    const btnImp = document.getElementById('iptv-btn-importar');
    const btnCount = document.getElementById('iptv-btn-count');
    console.log('elementos:', {paste:!!paste, preview:!!preview, btnImp:!!btnImp, btnCount:!!btnCount});
    if (paste) paste.value = '';
    if (preview) preview.style.display = 'none';
    if (btnImp) btnImp.disabled = true;
    if (btnCount) btnCount.textContent = '';
    const ovEl = document.getElementById('ov-iptv');
    console.log('overlay ov-iptv:', ovEl);
    openOv('ov-iptv');
    console.log('openOv chamado, classes:', ovEl ? ovEl.className : 'null');
  } catch(e) {
    console.error('abrirImportarIPTV erro:', e);
    toast('Erro ao abrir modal: ' + e.message, 'err');
  }
}

function iptvHandleDrop(e){
  e.preventDefault();
  document.getElementById('iptv-drop-area').classList.remove('drag');
  const file = e.dataTransfer.files[0];
  if (file) iptvHandleFile({files:[file]});
}

function iptvHandleFile(input){
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    document.getElementById('iptv-paste').value = ev.target.result;
    iptvParsePaste();
  };
  reader.readAsText(file, 'UTF-8');
}

function iptvParsarValor(s){
  if (!s) return 0;
  return parseFloat(String(s).replace(/R\$\s?/g,'').replace(/\./g,'').replace(',','.').trim()) || 0;
}

function iptvParsePaste(){
  const texto = document.getElementById('iptv-paste').value.trim();
  if (!texto) { document.getElementById('iptv-preview').style.display='none'; return; }

  const todasLinhas = texto.split(/\r?\n/).map(l => l.replace(/\r/g,''));

  // Detectar linha de cabeçalho (contém "cliente" e "ativo")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(todasLinhas.length, 5); i++) {
    const low = todasLinhas[i].toLowerCase();
    if (low.includes('cliente') && low.includes('ativ')) { headerIdx = i; break; }
  }
  // Pular também a linha antes do header (ex: "IPTV | 183 | ...")
  const dataStart = headerIdx >= 0 ? headerIdx + 1 : 0;

  // Filtrar linhas vazias e de sub-cabeçalho (ex: linha com "DATA | Recebido")
  const linhasData = todasLinhas.slice(dataStart).filter(l => {
    const trimmed = l.trim();
    if (!trimmed) return false;
    const low = trimmed.toLowerCase();
    // Pular linhas de sub-cabeçalho dos meses
    if (low.startsWith('data') && low.includes('recebido')) return false;
    return true;
  });

  iptvLinhas = linhasData.map(l => l.split('\t'));

  // Filtrar apenas linhas com nome de cliente válido (col 0 não vazio)
  iptvLinhas = iptvLinhas.filter(cols => cols[0] && cols[0].trim().length > 0);

  // Montar prévia
  const prev = document.getElementById('iptv-preview');
  if (!iptvLinhas.length) {
    prev.style.display = 'none';
    document.getElementById('iptv-btn-importar').disabled = true;
    return;
  }

  prev.style.display = '';
  document.getElementById('iptv-preview-count').textContent = iptvLinhas.length;
  document.getElementById('iptv-btn-importar').disabled = false;
  document.getElementById('iptv-btn-count').textContent = `(${iptvLinhas.length})`;

  // Contar cobranças por cliente para prévia
  const previewRows = iptvLinhas.slice(0, 30).map(cols => {
    const nome    = (cols[0]||'').trim();
    const ativo   = (cols[1]||'').trim();
    const servidor= (cols[2]||'').trim();
    const mensal  = iptvParsarValor(cols[3]);
    const dia     = parseInt(cols[4])||1;
    // Contar blocos com data preenchida e Recebido=Sim
    let cobQtd = 0;
    for (let b = 6; b + 4 < cols.length; b += 5) {
      const dataB = (cols[b]||'').trim();
      const recB  = (cols[b+1]||'').trim().toLowerCase();
      if (dataB && dataB !== '-' && recB === 'sim') cobQtd++;
    }
    const inatv = ativo.toLowerCase() === 'não' || ativo.toLowerCase() === 'nao';
    return `<tr>
      <td style="padding:5px 8px;font-weight:500;color:${inatv?'var(--muted)':'var(--text)'}">${nome}</td>
      <td style="padding:5px 8px;text-align:center"><span class="badge ${inatv?'badge-inativo':'badge-ativo'}">${inatv?'Inativo':'Ativo'}</span></td>
      <td style="padding:5px 8px;color:var(--muted)">${servidor||'—'}</td>
      <td style="padding:5px 8px;text-align:right">${fmtV(mensal)}</td>
      <td style="padding:5px 8px;text-align:center">${dia}</td>
      <td style="padding:5px 8px;text-align:center;color:var(--green)">${cobQtd}</td>
    </tr>`;
  }).join('');

  document.getElementById('iptv-preview-body').innerHTML = previewRows +
    (iptvLinhas.length > 30 ? `<tr><td colspan="6" style="padding:8px;text-align:center;color:var(--muted)">... e mais ${iptvLinhas.length-30} clientes</td></tr>` : '');

  const warn = iptvLinhas.filter(cols=>(cols[2]||'').trim()==='').length;
  document.getElementById('iptv-preview-warn').textContent = warn > 0 ? `⚠ ${warn} cliente(s) sem servidor` : '';
}

async function iptvConfirmar(){
  if (!iptvLinhas.length){ toast('Nenhuma linha para importar','err'); return; }
  const btn = document.getElementById('iptv-btn-importar');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Importando...';
  try {
    const r = await api('POST', '/api/importar-clientes-historico', { texto: document.getElementById('iptv-paste').value });
    closeOv('ov-iptv');
    toast(`✓ ${r.clientesNovos} cliente(s) criado(s), ${r.clientesAtualizados} atualizado(s), ${r.totalCobrancasCriadas} cobrança(s) importada(s)!`);
    renderClientes();
  } catch(e) {
    toast('Erro ao importar: ' + e.message, 'err');
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-upload"></i> Importar';
  }
}


async function limparClientesCobr(){
  if(!confirm('⚠️ Isso vai APAGAR todos os clientes e cobranças permanentemente.\n\nTem certeza?')) return;
  if(!confirm('Confirmação final: apagar tudo mesmo?')) return;
  try{
    await api('DELETE','/api/limpar-clientes-cobrancas');
    toast('Clientes e cobranças apagados.');
    renderCadastros();
    renderDash();
  }catch(e){ toast('Erro ao limpar: '+e.message,'err'); }
}

async function normalizarServidores(){
  try{
    const r = await api('POST','/api/normalizar-servidores');
    toast(`Servidores padronizados! (${r.clientes_atualizados} cliente(s) atualizado(s))`);
    renderCadastros();
  }catch(e){ toast('Erro ao padronizar','err'); }
}


async function ovLimparTudo(){
  if(!confirm('Apagar TODAS as receitas? Isso não pode ser desfeito.')) return;
  try{
    await api('DELETE','/api/outras-vendas/limpar');
    toast('Receitas apagadas.');
    renderOutrasVendas();
  }catch(e){ toast('Erro ao limpar','err'); }
}

async function dpLimparTudo(){
  if(!confirm('Apagar TODAS as despesas? Isso não pode ser desfeito.')) return;
  try{
    await api('DELETE','/api/despesas/limpar');
    toast('Despesas apagadas.');
    renderDespesas();
  }catch(e){ toast('Erro ao limpar','err'); }
}

/* ── SIDEBAR MOBILE ── */
function openSidebar(){
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
  document.body.style.overflow='';
}
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeSidebar(); });

/* ── INIT ── */
initAuth();
