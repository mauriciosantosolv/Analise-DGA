# CliqueObras v3.0.1

Revisão corretiva da v3.0 após homologação contra o Supabase publicado.

- A exclusão administrativa de RDO deixou de tentar apagar arquivos diretamente
  em `storage.objects`, operação bloqueada pelo Supabase.
- A nova Edge Function `delete-rdo` valida JWT e papel de proprietário/admin,
  executa o estorno no banco e remove as fotos pela API oficial do Storage.
- A RPC continua protegendo RDOs vinculados a medição e medições faturadas.
- A chamada do frontend foi transferida da RPC direta para a Edge Function.
- O cache dos arquivos e o rodapé foram atualizados para v3.0.1.

No projeto CliqueObras, a migração e as duas Edge Functions já foram publicadas.
