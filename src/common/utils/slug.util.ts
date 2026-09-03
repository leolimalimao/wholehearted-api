export function generateSlug(displayName: string): string {
  return displayName
    .toLowerCase()
    .normalize('NFD')                    // separa acentos dos caracteres
    .replace(/[\u0300-\u036f]/g, '')     // remove os acentos
    .replace(/[^a-z0-9\s-]/g, '')       // remove caracteres especiais
    .trim()
    .replace(/\s+/g, '-')               // espaços viram hífens
    .replace(/-+/g, '-')                // remove hífens duplos
    .slice(0, 32);                       // limita o tamanho
}

// se o slug já existir no banco, adiciona um sufixo numérico
// ex: "leonardo" → "leonardo-2"
export function generateSlugWithSuffix(base: string, suffix: number): string {
  const suffixStr = `-${suffix}`;
  return base.slice(0, 32 - suffixStr.length) + suffixStr;
}