/* GestorCob 2.1 — navegação visual, sem chamadas extras à API */
(function(){
  function wire(groupId,selectId,callback){
    const group=document.getElementById(groupId), select=document.getElementById(selectId);
    if(!group||!select)return;
    function sync(){group.querySelectorAll('button[data-value]').forEach(b=>{const on=b.dataset.value===select.value;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});}
    group.addEventListener('click',e=>{
      const btn=e.target.closest('button[data-value]');if(!btn)return;
      select.value=btn.dataset.value;
      if(groupId==='v2-billing-tabs' && typeof window.cobsLimparVencer==='function')window.cobsLimparVencer();
      sync();
      if(typeof window[callback]==='function')window[callback]();
    });
    select.addEventListener('change',sync);
    sync();
  }
  function init(){
    wire('v2-client-tabs','fsc','renderClientes');
    wire('v2-billing-tabs','fs','renderCobs');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
