const path = require("path");
const fs = require("fs");
const { supabase } = require("./supabase");

/**
 * Guarda um ficheiro na Supabase ou localmente conforme a configuração.
 */
async function uploadToSupabase(storagePath, fileBuffer, mimeType) {
  // Se tivermos as chaves, usamos Supabase
  if (supabase) {
    try {
      const bucketName = "infor-cliente";
      const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(storagePath, fileBuffer, {
          contentType: mimeType,
          upsert: true,
        });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from(bucketName)
        .getPublicUrl(storagePath);

      return publicUrl;
    } catch (err) {
      console.error("❌ Erro no Supabase Storage, tentando fallback local:", err.message);
    }
  }

  // Fallback Local: Se não houver Supabase ou se falhar
  const localBase = "uploads";
  const fullPath = path.join(localBase, storagePath);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, fileBuffer);

  // Retorna o caminho relativo que o frontend sabe resolver
  return storagePath.startsWith("uploads") ? storagePath : `uploads/${storagePath}`;
}

module.exports = { uploadToSupabase };
