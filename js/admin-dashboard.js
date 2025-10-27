/* Admin dashboard with corrected empty-state logic.
   Empty state now:
   - NEVER shows on initial load if there are records.
   - NEVER shows when there are any cards rendered.
   - ONLY shows after the admin has interacted (filter/search/refresh OR realtime event causes zero records) AND the filtered list is empty.
*/

document.addEventListener("DOMContentLoaded", async () => {
  const { data: sessionData } = await sb.auth.getSession();
  if(!sessionData.session){
    window.location.href="admin-login.html";
    return;
  }

  const adminEmail = sessionData.session.user.email;
  document.getElementById("adminEmailBadge").textContent = adminEmail;

  // Elements
  const logoutBtn    = document.getElementById("logoutBtn");
  const statusFilter = document.getElementById("statusFilter");
  const searchInput  = document.getElementById("searchInput");
  const refreshBtn   = document.getElementById("refreshBtn");
  const cardsGrid    = document.getElementById("cardsGrid");
  const emptyAdmin   = document.getElementById("emptyAdmin");
  const adminStatus  = document.getElementById("adminStatus");
  const metricsRow   = document.getElementById("metricsRow");
  const modal        = document.getElementById("detailModal");
  const modalBody    = document.getElementById("modalBody");
  const modalFoot    = document.getElementById("modalFoot");
  const closeBtn     = modal.querySelector(".close-btn");
  const toastStack   = document.getElementById("toasts");

  // State
  let defaultRetentionDays = 90;
  let cache = [];
  let loading = false;
  let userInteracted = false; // Controls whether empty state may display

  // Utilities
  function toast(msg,type="success"){
    const div=document.createElement("div");
    div.className="toast "+type;
    div.textContent=msg;
    toastStack.appendChild(div);
    setTimeout(()=>div.remove(),4200);
  }

  function escapeHTML(s=""){
    return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }

  function remainingString(ts){
    const target = new Date(ts).getTime();
    const now = Date.now();
    if(target < now) return "Expired";
    const diff = target - now;
    const days = Math.floor(diff/86400000);
    const hours = Math.floor((diff%86400000)/3600000);
    if(days>0) return `${days}d ${hours}h left`;
    const minutes = Math.floor((diff%3600000)/60000);
    return `${hours}h ${minutes}m left`;
  }

  async function fetchSettings(){
    const { data, error } = await sb.from("recycling_settings").select("*").eq("id",1).maybeSingle();
    if(!error && data) defaultRetentionDays = data.default_retention_days;
  }

  async function load() {
    if(loading) return;
    loading = true;
    adminStatus.textContent="Loading...";
    adminStatus.className="form-status info";
    await fetchSettings();
    const { data, error } = await sb.from("recycling_submissions").select("*").order("created_at",{ ascending:false });
    loading=false;
    if(error){
      adminStatus.textContent=error.message;
      adminStatus.className="form-status error";
      return;
    }
    adminStatus.textContent="";
    adminStatus.className="form-status";
    cache = data;
    // Initial load (no interaction yet) should not show empty block even if there are zero records
    renderAll(false);
  }

  // Retention banner
  function renderRetentionBanner(){
    if(!document.getElementById("retentionControl")){
      const banner = document.createElement("div");
      banner.id="retentionControl";
      banner.className="req-card fade-in";
      banner.style.display="flex";
      banner.style.flexDirection="column";
      banner.style.gap=".75rem";
      banner.innerHTML = `
        <h4 style="margin:0;font-size:.95rem;">Retention Policy</h4>
        <p style="margin:0;font-size:.75rem;color:#8fa8b6;">
          Default auto-delete: <strong id="currentRetentionVal">${defaultRetentionDays}</strong> day(s).
        </p>
        <div class="retention-row">
          ${[7,30,60,90].map(d=>`<span class="retention-chip ${d===defaultRetentionDays?'active':''}" data-retention="${d}">${d}d</span>`).join("")}
          <span class="retention-chip" data-retention="custom">Custom</span>
          <span class="badge-retain ${defaultRetentionDays?'active':''}">DEFAULT</span>
          <div class="inline-edit hidden" id="customRetentionBox">
            <input type="number" min="1" id="customRetentionInput" placeholder="Days">
            <button class="btn primary small" id="applyCustomBtn">Apply</button>
          </div>
        </div>
      `;
      metricsRow.insertAdjacentElement("afterend", banner);

      banner.addEventListener("click", async (e)=>{
        const chip = e.target.closest(".retention-chip");
        if(!chip) return;
        const val = chip.getAttribute("data-retention");
        banner.querySelectorAll(".retention-chip").forEach(c=>c.classList.remove("active"));

        if(val==="custom"){
          document.getElementById("customRetentionBox").classList.remove("hidden");
          chip.classList.add("active");
          return;
        } else {
          document.getElementById("customRetentionBox").classList.add("hidden");
        }

        const days = parseInt(val,10);
        if(!Number.isFinite(days) || days<1) return;
        const { data: updated, error } = await sb.rpc("rpc_set_default_retention",{ _days: days });
        if(error){ toast(error.message,"error"); return; }
        defaultRetentionDays = updated;
        chip.classList.add("active");
        document.getElementById("currentRetentionVal").textContent = defaultRetentionDays;
        toast("Default retention updated","success");
      });

      document.getElementById("applyCustomBtn").addEventListener("click", async ()=>{
        const v = parseInt(document.getElementById("customRetentionInput").value,10);
        if(!Number.isFinite(v) || v<1){ toast("Invalid days","error"); return; }
        const { data: upd, error } = await sb.rpc("rpc_set_default_retention",{ _days: v });
        if(error){ toast(error.message,"error"); return; }
        defaultRetentionDays = upd;
        document.getElementById("currentRetentionVal").textContent = defaultRetentionDays;
        banner.querySelectorAll(".retention-chip").forEach(c=>c.classList.remove("active"));
        toast("Custom retention applied","success");
      });
    } else {
      document.getElementById("currentRetentionVal").textContent = defaultRetentionDays;
    }
  }

  function renderMetrics(){
    const total=cache.length;
    const pending=cache.filter(r=>r.status==='pending').length;
    const accepted=cache.filter(r=>r.status==='accepted').length;
    const rejected=cache.filter(r=>r.status==='rejected').length;
    metricsRow.innerHTML =
      metricCard("Total", total) +
      metricCard("Pending", pending) +
      metricCard("Accepted", accepted) +
      metricCard("Rejected", rejected);
  }

  function metricCard(label,value){
    return `
      <div class="req-card" style="padding:1rem 1rem 1.1rem;">
        <h4 style="margin:0;font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:#87a1b1;">${escapeHTML(label)}</h4>
        <div style="font-size:1.7rem;font-weight:600;background:linear-gradient(90deg,#fff,#45f59a);-webkit-background-clip:text;color:transparent;line-height:1.15;">${value}</div>
      </div>
    `;
  }

  function cardHTML(r){
    const url = getPublicUrl(r.image_path);
    const countdown = r.auto_delete_at ? remainingString(r.auto_delete_at) : "";
    return `
      <div class="req-card fade-in" data-id="${r.id}">
        <div class="req-thumb"><img src="${url}" alt=""></div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div class="status ${r.status}">${r.status}</div>
          <small style="font-size:.55rem;letter-spacing:.14em;color:#6e8896;">${new Date(r.created_at).toLocaleDateString()}</small>
        </div>
        <h4 style="margin:.35rem 0 .45rem;font-size:.95rem;">${escapeHTML(r.product_details.slice(0,80))}</h4>
        <div class="req-meta">
          <span>${escapeHTML(r.name||"")}</span>
          <span>${escapeHTML(r.mobile||"")}</span>
          <span>${escapeHTML(r.email||"")}</span>
        </div>
        ${countdown ? `<div class="countdown">${countdown}</div>` : ""}
        <div class="actions-row">
          <button class="btn subtle small" data-action="open" data-id="${r.id}">View</button>
          ${r.status==="pending" ? `
            <button class="btn primary small" data-action="accept" data-id="${r.id}">Accept</button>
            <button class="btn danger small" data-action="reject" data-id="${r.id}">Reject</button>` : ""}
          <button class="delete-btn-soft" data-action="delete" data-id="${r.id}">Delete</button>
        </div>
      </div>
    `;
  }

  function renderList(allowEmpty=true){
    // Always hide empty placeholder up front
    emptyAdmin.classList.add("hidden");

    let list = [...cache];
    const f = statusFilter.value;
    const q = searchInput.value.trim().toLowerCase();

    if(f) list = list.filter(r => r.status === f);
    if(q){
      list = list.filter(r =>
        (r.name||"").toLowerCase().includes(q) ||
        (r.mobile||"").toLowerCase().includes(q) ||
        (r.email||"").toLowerCase().includes(q) ||
        (r.product_details||"").toLowerCase().includes(q)
      );
    }

    if(!list.length){
      cardsGrid.innerHTML = "";
      // Show empty only if user has interacted AND we allow showing
      if(userInteracted && allowEmpty){
        emptyAdmin.classList.remove("hidden");
      }
      return;
    }

    // We have records; ensure empty hidden
    emptyAdmin.classList.add("hidden");
    cardsGrid.innerHTML = list.map(cardHTML).join("");
  }

  function renderAll(allowEmpty){
    renderMetrics();
    renderRetentionBanner();
    renderList(allowEmpty);
  }

  // Event listeners marking interaction
  statusFilter.addEventListener("change", () => { userInteracted = true; renderList(); });
  searchInput.addEventListener("input", () => { userInteracted = true; renderList(); });
  refreshBtn.addEventListener("click", () => { userInteracted = true; load(); });

  // Card actions
  cardsGrid.addEventListener("click", async (e)=>{
    const btn = e.target.closest("[data-action]");
    if(!btn) return;
    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");
    const row = cache.find(r=>r.id===id);
    if(!row) return;
    if(action==="open") openModal(row);
    if(action==="accept") await updateStatus(id,"accepted", true);
    if(action==="reject") await updateStatus(id,"rejected");
    if(action==="delete") await deleteSubmission(id);
  });

  async function deleteSubmission(id){
    if(!confirm("Delete this submission permanently?")) return;
    const { error } = await sb.from("recycling_submissions").delete().eq("id",id);
    if(error){ toast(error.message,"error"); return; }
    cache = cache.filter(r=>r.id!==id);
    toast("Deleted","success");
    // This counts as interaction so userInteracted remains true if previously set
    renderAll();
  }

  async function updateStatus(id,status,applyRetention=false){
    let updateObj = { status };
    if(applyRetention){
      updateObj.auto_delete_at = new Date(Date.now() + defaultRetentionDays * 86400000).toISOString();
    }
    const { error } = await sb.from("recycling_submissions").update(updateObj).eq("id",id);
    if(error){ toast(error.message,"error"); return; }
    const idx = cache.findIndex(r=>r.id===id);
    if(idx>-1) cache[idx] = { ...cache[idx], ...updateObj };
    toast("Status updated","success");
    renderAll();
  }

  async function fetchImagesFor(submissionId){
    const { data, error } = await sb
      .from("recycling_submission_images")
      .select("*")
      .eq("submission_id", submissionId)
      .order("position",{ ascending:true });
    if(error) return [];
    return data || [];
  }

  function openModal(r){
    modalBody.innerHTML = `<div class="form-status info">Loading images...</div>`;
    modalFoot.innerHTML = "";
    modal.showModal();

    (async ()=>{
      const images = await fetchImagesFor(r.id);
      const gallery = images.map(img => `
        <div style="border:1px solid #274353;border-radius:18px;overflow:hidden;aspect-ratio:4/3;position:relative;">
          <img src="${getPublicUrl(img.image_path)}" alt="" style="width:100%;height:100%;object-fit:cover;">
          ${img.position===0 ? `<span style="position:absolute;top:.5rem;left:.5rem;background:#142b33;padding:.3rem .55rem;border:1px solid #2d4a57;font-size:.55rem;letter-spacing:.12em;border-radius:12px;">COVER</span>`:``}
        </div>`).join("");

      modalBody.innerHTML = `
        <div style="display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));">
          <div><strong>Status:</strong><br><span class="status ${r.status}">${r.status}</span></div>
          <div><strong>Name:</strong><br>${escapeHTML(r.name||"")}</div>
          <div><strong>Mobile:</strong><br>${escapeHTML(r.mobile||"")}</div>
          <div><strong>Email:</strong><br>${escapeHTML(r.email||"-")}</div>
          <div style="grid-column:1/-1;"><strong>Address:</strong><br>${escapeHTML(r.address||"")}</div>
          <div style="grid-column:1/-1;"><strong>Details:</strong><br>${escapeHTML(r.product_details||"")}</div>
          <div><strong>Created:</strong><br>${new Date(r.created_at).toLocaleString()}</div>
          ${r.auto_delete_at ? `<div><strong>Auto Delete:</strong><br>${new Date(r.auto_delete_at).toLocaleString()}<br><span class="countdown">${remainingString(r.auto_delete_at)}</span></div>` :
            `<div><strong>Auto Delete:</strong><br><span style="color:#7d96a4;">None</span></div>`}
          <div style="grid-column:1/-1;display:grid;gap:.9rem;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));">
            ${gallery || '<div style="opacity:.65;font-size:.8rem;">No images found.</div>'}
          </div>
        </div>
        <div class="retention-row" style="margin-top:1rem;">
          <span style="font-size:.65rem;letter-spacing:.15em;text-transform:uppercase;font-weight:600;color:#7f9ca9;">Set Retention:</span>
          ${[7,30,60,90].map(d=>`<span class="retention-chip" data-retention-modal="${d}" data-id="${r.id}">${d}d</span>`).join("")}
          <span class="retention-chip" data-retention-modal="custom" data-id="${r.id}">Custom</span>
          <div class="inline-edit hidden" id="modalCustomBox">
            <input type="number" min="1" id="modalCustomInput" placeholder="Days">
            <button class="btn primary small" id="modalApplyCustomBtn">Apply</button>
          </div>
          ${ r.auto_delete_at ? `<button class="btn subtle small" data-clear-retention="${r.id}">Clear</button>` : "" }
        </div>
      `;

      if(r.status==="pending"){
        const acceptBtn=document.createElement("button");
        acceptBtn.className="btn primary small";
        acceptBtn.textContent="Accept (+Retention)";
        acceptBtn.onclick=async()=>{acceptBtn.disabled=true;await updateStatus(r.id,"accepted",true);modal.close();};

        const rejectBtn=document.createElement("button");
        rejectBtn.className="btn danger small";
        rejectBtn.textContent="Reject";
        rejectBtn.onclick=async()=>{rejectBtn.disabled=true;await updateStatus(r.id,"rejected");modal.close();};

        const delBtn=document.createElement("button");
        delBtn.className="delete-btn-soft";
        delBtn.textContent="Delete";
        delBtn.onclick=async()=>{delBtn.disabled=true;await deleteSubmission(r.id);modal.close();};

        modalFoot.append(acceptBtn,rejectBtn,delBtn);
      } else {
        const delBtn=document.createElement("button");
        delBtn.className="delete-btn-soft";
        delBtn.textContent="Delete";
        delBtn.onclick=async()=>{delBtn.disabled=true;await deleteSubmission(r.id);modal.close();};
        modalFoot.append(delBtn);
      }

      modalBody.addEventListener("click", async (e)=>{
        const chip=e.target.closest(".retention-chip");
        if(chip && chip.hasAttribute("data-retention-modal")){
          const val=chip.getAttribute("data-retention-modal");
          modalBody.querySelectorAll(".retention-chip").forEach(c=>c.classList.remove("active"));
          chip.classList.add("active");
          if(val==="custom"){
            document.getElementById("modalCustomBox").classList.remove("hidden");
            return;
          } else {
            document.getElementById("modalCustomBox").classList.add("hidden");
          }
            const days=parseInt(val,10);
          if(Number.isFinite(days)&&days>0) await setSubmissionRetention(r.id,days);
        }
        if(e.target.matches("[data-clear-retention]")){
          await clearRetention(r.id);
        }
      });

      document.getElementById("modalApplyCustomBtn")?.addEventListener("click", async ()=>{
        const d = parseInt(document.getElementById("modalCustomInput").value,10);
        if(!Number.isFinite(d)||d<1){toast("Invalid days","error");return;}
        await setSubmissionRetention(r.id,d);
      });
    })();
  }

  async function setSubmissionRetention(id,days){
    const { data, error } = await sb.rpc("rpc_set_submission_retention", { _id:id, _days:days });
    if(error){ toast(error.message,"error"); return; }
    const idx = cache.findIndex(r=>r.id===id);
    if(idx>-1) cache[idx].auto_delete_at = data;
    toast("Retention set","success");
    renderAll();
  }

  async function clearRetention(id){
    const { error } = await sb.from("recycling_submissions").update({ auto_delete_at:null }).eq("id",id);
    if(error){ toast(error.message,"error"); return; }
    const idx = cache.findIndex(r=>r.id===id);
    if(idx>-1) cache[idx].auto_delete_at = null;
    toast("Retention cleared","success");
    renderAll();
  }

  // Auth state change (if they sign out elsewhere)
  sb.auth.onAuthStateChange((evt, sess)=>{
    if(evt === "SIGNED_OUT"){
      window.location.href="admin-login.html";
    }
  });

  // Real-time updates
  sb.channel('recycling_submissions_live')
    .on('postgres_changes',{ event:'*', schema:'public', table:'recycling_submissions' }, payload => {
      if(payload.eventType==='INSERT'){
        cache.unshift(payload.new);
        toast("New submission","info");
      } else if(payload.eventType==='UPDATE'){
        const i = cache.findIndex(r=>r.id===payload.new.id);
        if(i>-1) cache[i]=payload.new;
        toast("Updated","info");
      } else if(payload.eventType==='DELETE'){
        cache = cache.filter(r=>r.id!==payload.old.id);
        toast("Deleted","info");
      }
      // After realtime event we do not mark as userInteracted, so empty state only appears if previously interacted.
      renderAll();
    }).subscribe();

  logoutBtn.addEventListener("click", async ()=>{
    await sb.auth.signOut();
    window.location.href="admin-login.html";
  });

  closeBtn.addEventListener("click", ()=> modal.close());

  // Periodic countdown refresh (doesn't trigger empty visual)
  setInterval(()=>renderList(false),60000);

  await load();
});