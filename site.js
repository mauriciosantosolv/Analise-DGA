/* Formulário de contato: abre o e-mail do visitante já preenchido (mesmo comportamento do protótipo) */
(function(){
  var form=document.getElementById('contato-form'),ok=document.getElementById('contato-ok');
  if(!form||!ok)return;
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var d=new FormData(form),g=function(k){return String(d.get(k)||'').trim();};
    var name=g('name'),company=g('company');
    var subject='Interesse no CliqueObras — '+(company||name);
    var body=['Nome: '+name,'Empresa: '+company,'E-mail: '+g('email'),'Telefone: '+(g('phone')||'—'),'','Mensagem:',g('message')||'—'].join('\n');
    window.location.href='mailto:suporte@cliqueobras.com?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
    var first=name.split(' ')[0]||'';
    document.getElementById('contato-nome').textContent=first?', '+first:'';
    form.hidden=true;ok.hidden=false;
  });
  document.getElementById('contato-reset').addEventListener('click',function(){ok.hidden=true;form.hidden=false;});
})();
