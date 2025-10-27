document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("recycleForm");
  const statusEl = document.getElementById("formStatus");
  const imagesInput = document.getElementById("imagesInput");
  const previewGallery = document.getElementById("previewGallery");
  const successPanel = document.getElementById("successPanel");
  const submitPanel = document.getElementById("submitPanel");
  const newRequestBtn = document.getElementById("newRequestBtn");
  const submitBtn = document.getElementById("submitBtn");
  const lookupInput = document.getElementById("lookupInput");
  const lookupBtn = document.getElementById("lookupBtn");
  const lookupStatus = document.getElementById("lookupStatus");
  const resultsGrid = document.getElementById("resultsGrid");
  const emptyResults = document.getElementById("emptyResults");
  document.getElementById("year").textContent = new Date().getFullYear();

  const MAX_IMAGES = 6;
  const MAX_SIZE_MB = 5;
  let lookupPerformed = false; // NEW flag

  imagesInput.addEventListener("change", (e) => {
    previewGallery.innerHTML = "";
    const files = Array.from(e.target.files || []);
    if(!files.length){ previewGallery.classList.add("hidden"); return; }
    const limited = files.slice(0, MAX_IMAGES);
    if(files.length > MAX_IMAGES){
      setStatus(`Only first ${MAX_IMAGES} images considered.`, "info");
    }
    let i = 0;
    for(const f of limited){
      if(f.size > MAX_SIZE_MB * 1024 * 1024){
        setStatus(`File ${f.name} exceeds ${MAX_SIZE_MB}MB.`, "error");
        continue;
      }
      const box = document.createElement("div");
      box.className = "img-box fade-in";
      const img = document.createElement("img");
      img.src = URL.createObjectURL(f);
      const idx = document.createElement("div");
      idx.className = "idx";
      idx.textContent = i===0 ? "Cover" : `#${i+1}`;
      box.appendChild(img);
      box.appendChild(idx);
      previewGallery.appendChild(box);
      i++;
    }
    previewGallery.classList.toggle("hidden", previewGallery.children.length === 0);
  });

  newRequestBtn?.addEventListener("click", () => {
    successPanel.classList.add("hidden");
    submitPanel.classList.remove("hidden");
    form.reset();
    previewGallery.innerHTML="";
    previewGallery.classList.add("hidden");
    statusEl.textContent="";
    submitBtn.disabled=false;
    window.scrollTo({ top:0, behavior:"smooth" });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    setStatus("Uploading images...","info");

    const name = val("nameInput");
    const mobile = val("mobileInput");
    const email = val("emailInput");
    const address = val("addressInput");
    const details = val("detailsInput");
    let files = Array.from(imagesInput.files || []);
    if(!files.length){
      setStatus("At least one image required","error");
      submitBtn.disabled=false;
      return;
    }
    files = files.slice(0, MAX_IMAGES);

    try{
      const uploadPromises = files.map(async (file) => {
        if(file.size > MAX_SIZE_MB * 1024 * 1024) throw new Error(`File ${file.name} too large`);
        const ext = file.name.split(".").pop();
        const filename = `${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await sb.storage.from("request-images").upload(filename,file);
        if(upErr) throw new Error(upErr.message);
        return `request-images/${filename}`;
      });
      const paths = await Promise.all(uploadPromises);
      if(!paths.length) throw new Error("No images uploaded");

      setStatus("Saving submission...","info");

      const { error: rpcErr } = await sb.rpc("rpc_create_recycling_submission_multi", {
        _name: name,
        _mobile: mobile,
        _email: email || null,
        _address: address,
        _product_details: details,
        _image_paths: paths,
        _apply_default_retention: false
      });

      if(rpcErr){
        setStatus("Insert failed: "+rpcErr.message,"error");
        submitBtn.disabled=false;
        return;
      }

      setStatus("");
      submitPanel.classList.add("hidden");
      successPanel.classList.remove("hidden");
    } catch(err){
      setStatus(err.message,"error");
      submitBtn.disabled=false;
    }
  });

  lookupBtn.addEventListener("click", async () => {
    const query = lookupInput.value.trim();
    lookupStatus.textContent="";
    lookupPerformed = true; // user initiated search
    if(!query){
      lookupStatus.textContent="Enter mobile or email.";
      lookupStatus.className="form-status error";
      resultsGrid.innerHTML="";
      emptyResults.classList.add("hidden"); // still hide because empty input
      return;
    }
    lookupStatus.textContent="Searching...";
    lookupStatus.className="form-status info";
    resultsGrid.innerHTML="";
    emptyResults.classList.add("hidden");

    let orExpr = query.includes("@")
      ? `email.eq.${escapeCommas(query)}`
      : `mobile.eq.${escapeCommas(query)},email.eq.${escapeCommas(query)}`;

    const { data, error } = await sb
      .from("recycling_submissions")
      .select("*")
      .or(orExpr)
      .order("created_at",{ ascending:false });

    if(error){
      lookupStatus.textContent = error.message;
      lookupStatus.className="form-status error";
      return;
    }
    if(!data.length){
      resultsGrid.innerHTML="";
      lookupStatus.textContent="No records.";
      lookupStatus.className="form-status";
      // Only show empty state if an actual search attempt returned nothing
      emptyResults.classList.remove("hidden");
      return;
    }
    emptyResults.classList.add("hidden");
    lookupStatus.textContent=`Found ${data.length}`;
    lookupStatus.className="form-status success";
    resultsGrid.innerHTML = data.map(renderCard).join("");
  });

  function renderCard(r){
    const url = getPublicUrl(r.image_path);
    return `
      <div class="req-card fade-in">
        <div class="req-thumb"><img src="${url}" alt=""></div>
        <div class="status ${r.status}">${r.status}</div>
        <h4 style="margin:.3rem 0 .4rem;font-size:.9rem;">${escapeHTML(r.product_details.slice(0,90))}</h4>
        <div class="req-meta">
          <span>${escapeHTML(r.name||"")}</span>
          <span>${new Date(r.created_at).toLocaleDateString()}</span>
        </div>
      </div>
    `;
  }

  function escapeCommas(s){ return s.replace(/,/g,"%2C"); }
  function val(id){ return document.getElementById(id).value.trim(); }
  function setStatus(msg,type=""){ statusEl.textContent=msg; statusEl.className="form-status"+(type?(" "+type):""); }
  function escapeHTML(str=""){return str.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
});