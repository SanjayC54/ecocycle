const SUPABASE_URL = "https://lppnqocvcfpujvwnhogb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwcG5xb2N2Y2ZwdWp2d25ob2diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MzI4MzAsImV4cCI6MjA3NTQwODgzMH0.UmTtOV9I4rL_fyceMxislzwMDjERdCcO8Q9alpbskYQ";

if(!window.supabase){
  console.error("Supabase JS not loaded. Include CDN before this file.");
}
window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
});
window.getPublicUrl = (path)=> path ? `${SUPABASE_URL}/storage/v1/object/public/${path}` : "";