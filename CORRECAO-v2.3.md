# cliqueobras v2.3

## Correções desta versão

- A aceitação de convites agora é concluída em uma única transação segura no Supabase.
- O erro `new row violates row-level security policy for table "organization_invitations"` foi eliminado.
- Convites que já tinham criado o membro, mas continuavam pendentes, foram regularizados.
- O perfil não aparece mais como um botão isolado no topo.
- A logo e o nome da empresa, no início do menu, agora abrem **Perfil e configurações**.
- Os arquivos principais receberam a versão `2.3.0` no nome para evitar cache de versões anteriores.

## Publicação

Envie todo o conteúdo desta pasta para a raiz do site/repositório, preservando as subpastas.
Depois da publicação, o rodapé do menu deve mostrar `v2.3`.

O banco de produção já recebeu a correção. O arquivo
`supabase/CORRECAO-CONVITES-v2.3.sql` fica incluído apenas como histórico e para
novas instalações.
