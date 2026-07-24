# Clique Obras — ativação da base em nuvem

O sistema continua abrindo em modo local enquanto a nuvem não for configurada. Depois da ativação, ele exige login e sincroniza projetos, orçamentos, lançamentos, planejamento, medições, clientes, categorias e configurações.

## 1. Criar o banco

1. Crie um projeto no Supabase.
2. Abra **SQL Editor**.
3. Cole e execute todo o conteúdo de `supabase/schema.sql`.
4. Em **Authentication > Users**, crie o usuário que terá acesso ao sistema.

## 2. Ligar o site à nuvem

Edite `config/cloud-config.js`:

```js
window.CLIQUE_OBRAS_CLOUD = {
  enabled: true,
  provider: 'supabase',
  url: 'https://ID-DO-PROJETO.supabase.co',
  publishableKey: 'sb_publishable_SUA_CHAVE_PUBLICA'
};
```

Use somente a **Publishable key**. Nunca use `sb_secret_...`, `service_role`, senha do banco ou qualquer chave administrativa no navegador.

## 3. Publicar

Envie a pasta completa para o GitHub/Hostinger, preservando a estrutura de subpastas. O site deve ser servido por HTTPS.

No primeiro login:

- se a nuvem estiver vazia, a base já existente no navegador é enviada automaticamente;
- se a nuvem já tiver registros, ela passa a ser a fonte principal e atualiza o cache do aparelho;
- se a internet cair durante uma gravação, a alteração fica em fila e é sincronizada quando a conexão voltar.

## 4. Usar em outro aparelho

Abra o mesmo endereço e entre com o mesmo usuário. Os dados serão carregados da nuvem, não de um banco isolado daquele navegador.

## Segurança

O arquivo SQL ativa Row Level Security (RLS): o usuário autenticado só consegue ler e alterar as próprias linhas. A chave pública identifica o aplicativo; ela não substitui o login e não libera acesso aos dados.
