import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

// Cliente com service_role: roda só no servidor, nunca no front.
export const supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
  auth: { persistSession: false },
});
