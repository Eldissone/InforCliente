const { createClient } = require("@supabase/supabase-js");
const { config } = require("../config");

if (!config.supabaseUrl || !config.supabaseServiceKey) {
  console.warn("⚠️ Supabase Storage credentials missing. File uploads will fail.");
}

const supabase = config.supabaseUrl && config.supabaseServiceKey 
  ? createClient(config.supabaseUrl, config.supabaseServiceKey)
  : null;

module.exports = { supabase };
