
| Componente          | Cenário                      | Garantia                                                        |
| ------------------- | ---------------------------- | --------------------------------------------------------------- |
| `EncryptionService` | Encrypt/decrypt íntegro      | Dados sensíveis podem ser protegidos e recuperados corretamente |
| `EncryptionService` | IV aleatório                 | Cada operação de criptografia produz resultado único            |
| `EncryptionService` | Ciphertext corrompido        | Dados adulterados não são aceitos silenciosamente               |
| `slug.util`         | Acentos/caracteres especiais | Slugs válidos e normalizados                                    |
| `slug.util`         | Limite de tamanho            | Slugs possuem no máximo 32 caracteres                           |
| `slug.util`         | Sufixos                      | Unicidade e formato consistente                                 |
| `SyncProcessor`     | Usuário inexistente          | Jobs órfãos não executam chamadas externas                      |
| `SyncProcessor`     | Nenhuma música nova          | Nenhum INSERT desnecessário                                     |
| `SyncProcessor`     | Música duplicada             | Registros existentes não são duplicados                         |
| `SyncProcessor`     | Nova + duplicada             | Apenas registros novos são inseridos                            |
| `SyncProcessor`     | Cursor                       | Sincronização incremental utiliza timestamp correto             |
| `SyncProcessor`     | Sem histórico                | Primeira sincronização utiliza cursor `undefined`               |
| `SyncProcessor`     | Novos scrobbles              | Cache é invalidado quando necessário                            |
| `SyncProcessor`     | Sem novos scrobbles          | Cache é preservado                                              |