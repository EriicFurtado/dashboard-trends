'use strict';

(function initializeSupabase(global) {
  const config = Object.freeze(global.SUPABASE_CONFIG || {});

  function configuredValue(value) {return typeof value === 'string' && value.trim() !== ''}

  function createBrowserClient() {
    if(!configuredValue(config.url) || !configuredValue(config.publishableKey))
      throw new Error('Configuração do Supabase ausente. Preencha o arquivo .env e reinicie o servidor.');
    if(!global.supabase || typeof global.supabase.createClient !== 'function')
      throw new Error('The Supabase JavaScript client wasn\'t loaded.');
    
    return global.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }

  global.supabaseConfig = config;
  global.getSupabaseClient = function getSupabaseClient() {
    if(!global.supabaseClient) global.supabaseClient = createBrowserClient();
    return global.supabaseClient;
  };
})(window);
