/* Enhanced admin auth with deep diagnostics */
(function(){
  const dbg = (msg) => {
    console.log("[ADMIN-AUTH]", msg);
    const el = document.getElementById("adminDebug");
    if(el){
      el.textContent += `[${new Date().toISOString()}] ${msg}\n`;
    }
  };

  document.addEventListener("DOMContentLoaded", async () => {
    dbg("DOM loaded");
    const statusEl = document.getElementById("adminStatus");
    const form = document.getElementById("adminLoginForm");
    const loginBtn = document.getElementById("loginBtn");

    if(!window.sb){
      dbg("Supabase client (sb) not found.");
      setStatus("Internal error: client not loaded","error");
      return;
    }
    dbg("Supabase client present. URL="+sb.supabaseUrl);

    // 1. Initial session check
    try{
      const { data, error } = await sb.auth.getSession();
      if(error) dbg("getSession error: "+ error.message);
      dbg("Initial session result: "+ JSON.stringify(data));
      if(data?.session){
        dbg("Session exists. Redirecting to dashboard.");
        window.location.href="admin-dashboard.html";
        return;
      } else {
        dbg("No existing session. Staying on login page.");
      }
    }catch(e){
      dbg("Exception in initial getSession: "+e.message);
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("adminEmail").value.trim();
      const password = document.getElementById("adminPassword").value;
      if(!email || !password){
        setStatus("Missing credentials","error");
        return;
      }
      setStatus("Authenticating...","info");
      loginBtn.disabled = true;
      dbg("Attempting signInWithPassword for "+email);

      try{
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        dbg("signIn response: data="+JSON.stringify(data)+" error="+(error?error.message:"null"));
        if(error){
          setStatus(error.message,"error");
          loginBtn.disabled=false;
          return;
        }
        // Force a fresh session fetch (sometimes immediate redirect can race)
        const { data: afterData, error: afterErr } = await sb.auth.getSession();
        dbg("Post-login getSession: "+JSON.stringify(afterData)+" err="+(afterErr?afterErr.message:"null"));
        if(afterErr){
          setStatus(afterErr.message,"error");
          loginBtn.disabled=false;
          return;
        }
        if(afterData?.session){
          setStatus("Success. Redirecting...","success");
          dbg("Session confirmed. Redirect in 400ms");
          setTimeout(()=>window.location.href="admin-dashboard.html",400);
        } else {
          setStatus("Login succeeded but no session found. Check cookies/storage.", "error");
          loginBtn.disabled=false;
        }
      }catch(ex){
        dbg("Exception during login: "+ex.message);
        setStatus("Unexpected error: "+ex.message,"error");
        loginBtn.disabled=false;
      }
    });

    // 2. Auth state listener for extra diagnostics
    sb.auth.onAuthStateChange((evt, session)=>{
      dbg("Auth state change: "+evt+" session="+(session?"YES":"NO"));
      if(evt==="SIGNED_IN" && session){
        dbg("Auth listener redirect → dashboard");
        window.location.href="admin-dashboard.html";
      }
    });

    // 3. Environment diagnostics (only once)
    try{
      dbg("localStorage test start");
      const testKey="__eco_auth_test__";
      localStorage.setItem(testKey,"1");
      localStorage.removeItem(testKey);
      dbg("localStorage OK");
    }catch(e){
      dbg("localStorage blocked: "+e.message);
      setStatus("Storage blocked (disable strict privacy / use http server)","error");
    }

    function setStatus(msg,type=""){
      statusEl.textContent = msg;
      statusEl.className = "form-status"+(type?(" "+type):"");
    }
  });
})();