(function(){const i=document.createElement("link").relList;if(i&&i.supports&&i.supports("modulepreload"))return;for(const t of document.querySelectorAll('link[rel="modulepreload"]'))c(t);new MutationObserver(t=>{for(const s of t)if(s.type==="childList")for(const l of s.addedNodes)l.tagName==="LINK"&&l.rel==="modulepreload"&&c(l)}).observe(document,{childList:!0,subtree:!0});function d(t){const s={};return t.integrity&&(s.integrity=t.integrity),t.referrerPolicy&&(s.referrerPolicy=t.referrerPolicy),t.crossOrigin==="use-credentials"?s.credentials="include":t.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function c(t){if(t.ep)return;t.ep=!0;const s=d(t);fetch(t.href,s)}})();function v(e){return new Promise((i,d)=>{chrome.runtime.sendMessage(e,c=>{if(chrome.runtime.lastError)return d(new Error(chrome.runtime.lastError.message));i(c??{})})})}const h=document.getElementById("app");function P(){return`<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
      stroke="#22d3ee" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`}function w(e=""){return`<div class="header">
    <div class="header-logo">${P()} QA Infinity</div>
    <div class="header-user">${e}</div>
  </div>`}function S(e,i){const d=e.replace(/_/g," ").replace(/\b\w/g,t=>t.toUpperCase()),c=i.map(t=>{switch(t.action){case"navigate":return`    Go To    ${t.url??t.locatorLabel}`;case"click":return`    Click    ${t.locator}`;case"fill":return`    Fill Text    ${t.locator}    ${t.value??""}`;case"select":return`    Select Options By    ${t.locator}    label    ${t.value??""}`;case"check":return`    Check Checkbox    ${t.locator}`;case"uncheck":return`    Uncheck Checkbox    ${t.locator}`;default:return""}}).filter(Boolean);return`*** Settings ***
Library    Browser

*** Keywords ***
${d}
${c.join(`
`)}
`}async function T(e){const i=e.textContent??"";e.textContent="✓",e.style.color="#22d3ee",e.style.borderColor="#22d3ee",await new Promise(d=>setTimeout(d,1200)),e.textContent=i,e.style.color="",e.style.borderColor=""}function z(e){switch(e){case"click":return"🖱";case"fill":return"⌨";case"select":return"▾";case"navigate":return"→";case"check":return"☑";case"uncheck":return"☐";default:return"•"}}function N(){h.innerHTML=`${w()}<div class="body" style="align-items:center;padding-top:24px">
    <div class="spinner" style="width:20px;height:20px"></div></div>`}function I(e=""){const i=localStorage.getItem("qai_api_url")??"http://localhost:3300";h.innerHTML=`${w()}
    <div class="body">
      <div><label>API URL</label>
        <input id="apiUrl" type="text" value="${i}" placeholder="http://localhost:4200"/></div>
      <div><label>Email</label>
        <input id="email" type="email" placeholder="you@example.com" autocomplete="email"/></div>
      <div><label>Password</label>
        <input id="password" type="password" autocomplete="current-password"/></div>
      ${e?`<div class="error-msg">${e}</div>`:""}
      <button class="btn btn-primary" id="loginBtn">Sign In</button>
    </div>`;const d=document.getElementById("loginBtn"),c=document.getElementById("email"),t=document.getElementById("password"),s=document.getElementById("apiUrl");async function l(){const a=c.value.trim(),n=t.value,r=s.value.trim().replace(/\/$/,"");if(!(!a||!n||!r)){d.disabled=!0,d.innerHTML='<span class="spinner"></span> Signing in…';try{const u=await v({type:"LOGIN",email:a,password:n,apiUrl:r});if(!u.ok){I(String(u.error??"Login failed"));return}localStorage.setItem("qai_api_url",r),await _()}catch(u){I(String(u))}}}d.addEventListener("click",l),t.addEventListener("keydown",a=>{a.key==="Enter"&&l()})}function C(e,i,d="",c=!0){var s;h.innerHTML=`${w(`${i} <button class="btn-link" id="logoutBtn">Logout</button>`)}
    <div class="body">
      <div><label>Project</label>
        <select id="projectSel">
          <option value="">— select project —</option>
          ${e.map(l=>`<option value="${l.id}">${l.name}</option>`).join("")}
        </select>
      </div>
      ${d?`<div class="error-msg">${d}</div>`:""}
      ${c?"":'<button class="btn btn-primary" id="continueBtn" disabled>Continue →</button>'}
    </div>`,document.getElementById("logoutBtn").addEventListener("click",async()=>{await v({type:"LOGOUT"}),I()});const t=document.getElementById("projectSel");t.addEventListener("change",async l=>{const a=l.target.value;if(c){if(!a)return;await b(e.find(n=>n.id===a),i)}else{const n=document.getElementById("continueBtn");n&&(n.disabled=!a)}}),c||(s=document.getElementById("continueBtn"))==null||s.addEventListener("click",async()=>{const l=t.value;l&&await b(e.find(a=>a.id===l),i)}),chrome.storage.local.get("lastProject",({lastProject:l})=>{const a=document.getElementById("projectSel");if(a&&l)if(a.value=l,c)a.dispatchEvent(new Event("change"));else{const n=document.getElementById("continueBtn");n&&a.value&&(n.disabled=!1)}})}async function b(e,i,d=""){let c=[];try{const n=await v({type:"GET_PAGES",projectId:e.id});n.ok&&(c=n.data.pages??[])}catch{}const t=(await chrome.storage.local.get("lastPage")).lastPage??"";h.innerHTML=`${w(`${e.name} <button class="btn-link" id="changeProject">↩</button>`)}
    <div class="body">
      <div class="datalist-wrap">
        <label>Page</label>
        <input id="pageInput" type="text" placeholder="e.g. LoginPage" value="${t}" autocomplete="off"/>
        <div class="autocomplete-list" id="acList">
          ${c.map(n=>`<div class="autocomplete-item" data-val="${n}">${n}</div>`).join("")}
        </div>
      </div>
      ${d?`<div class="error-msg">${d}</div>`:""}
      <button class="btn btn-primary" id="captureBtn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>
        </svg>
        Capture Locators
      </button>
      <button class="btn btn-secondary" id="flowBtn" style="margin-top:0">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="2"/><path d="M5 12h2M17 12h2M12 5v2M12 17v2M7.05 7.05l1.41 1.41M15.54 15.54l1.41 1.41M7.05 16.95l1.41-1.41M15.54 8.46l1.41-1.41"/>
        </svg>
        Record UI Flow
      </button>
      <div style="font-size:11px;color:#475569;text-align:center;margin-top:-4px">
        Locators → Object Repository · Flows → Skills
      </div>
      <div style="text-align:center;margin-top:8px">
        <button class="btn-link" id="backBtn" style="font-size:11px;color:#64748b">← Change project</button>
      </div>
    </div>`,document.getElementById("changeProject").addEventListener("click",async()=>{var g;const r=((g=(await v({type:"GET_AUTH_STATE"})).user)==null?void 0:g.email)??"",u=await v({type:"GET_PROJECTS"});C((u.data??{}).projects??[],r,"",!1)}),document.getElementById("backBtn").addEventListener("click",async()=>{var g;const r=((g=(await v({type:"GET_AUTH_STATE"})).user)==null?void 0:g.email)??"",u=await v({type:"GET_PROJECTS"});C((u.data??{}).projects??[],r,"",!1)});const s=document.getElementById("pageInput"),l=document.getElementById("acList");function a(n){const r=n.toLowerCase();[...l.querySelectorAll(".autocomplete-item")].forEach(g=>{g.style.display=(g.dataset.val??"").toLowerCase().includes(r)?"":"none"});const u=[...l.querySelectorAll(".autocomplete-item")].filter(g=>g.style.display!=="none");l.classList.toggle("open",u.length>0&&n.length>0)}s.addEventListener("input",()=>a(s.value)),s.addEventListener("focus",()=>a(s.value)),s.addEventListener("blur",()=>setTimeout(()=>l.classList.remove("open"),150)),l.addEventListener("click",n=>{const r=n.target.closest(".autocomplete-item");r&&(s.value=r.dataset.val??"",l.classList.remove("open"))}),document.getElementById("captureBtn").addEventListener("click",async()=>{const n=s.value.trim();if(!n){s.focus();return}await chrome.storage.local.set({lastPage:n,lastProject:e.id}),A(e,i,n),await v({type:"START_BATCH_PICK"})}),document.getElementById("flowBtn").addEventListener("click",async()=>{const n=s.value.trim();if(!n){s.focus();return}await chrome.storage.local.set({lastPage:n,lastProject:e.id});const q=await v({type:"START_FLOW_RECORD"});if(!q.ok){await b(e,i,`Cannot start recording: ${q.error??"unknown error"}`);return}O(e,i,n)})}function A(e,i,d,c=[]){const t=[...c];function s(){const n=document.getElementById("captureCounter");n&&(n.textContent=String(t.length))}h.innerHTML=`${w(`${e.name}`)}
    <div class="pick-state">
      <div class="pick-icon">⊕</div>
      <div style="color:#e2e8f0;font-weight:500">Capturing on page</div>
      <div id="captureCounter" style="font-size:26px;font-weight:700;color:#22d3ee;font-variant-numeric:tabular-nums">${t.length}</div>
      <div style="font-size:11px;color:#64748b">elements captured</div>
    </div>

    <div id="lastCapture" style="margin:0 14px 0;display:none;
      background:#1e293b;border:1px solid rgba(34,211,238,0.25);border-radius:8px;padding:10px 12px;
      transition:border-color 0.3s;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.05em">Last captured</span>
        <button id="lcRemove" title="Remove this capture"
          style="background:rgba(239,68,68,0.12);border:none;color:#f87171;border-radius:4px;
                 padding:2px 8px;font-size:11px;cursor:pointer;line-height:1.6">
          × Remove
        </button>
      </div>
      <div id="lcName" style="font-size:13px;color:#e2e8f0;font-weight:500;margin-bottom:4px;word-break:break-all"></div>
      <div style="display:flex;align-items:center;gap:6px">
        <div id="lcLocator" style="font-size:11px;font-family:monospace;color:#94a3b8;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
        <span id="lcBadge" class="confidence-badge"></span>
      </div>
    </div>

    <div style="padding:14px 14px 0">
      <div class="pick-msg" style="font-size:11px;color:#475569;text-align:center;margin-bottom:10px">
        Click elements on the page, then press <strong style="color:#94a3b8">Done</strong>.
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-danger" id="cancelBtn" style="flex:1;padding:7px 0;font-size:12px">
          Cancel
        </button>
        <button class="btn btn-primary" id="doneBtn" style="flex:2;padding:7px 0;font-size:13px">
          Done
        </button>
      </div>
    </div>`,document.getElementById("doneBtn").addEventListener("click",async()=>{chrome.runtime.onMessage.removeListener(a),await v({type:"FINISH_CAPTURE"}),t.length>0?M(e,i,d,t):b(e,i,"No elements captured.")}),document.getElementById("cancelBtn").addEventListener("click",async()=>{chrome.runtime.onMessage.removeListener(a),await v({type:"CANCEL_PICK"}),await b(e,i)});function l(n){const r=document.getElementById("lastCapture");if(!r)return;const u=n.locators[0];document.getElementById("lcName").textContent=n.suggestedName||"—";const g=document.getElementById("lcLocator");g.textContent=(u==null?void 0:u.label)??"—",g.title=(u==null?void 0:u.label)??"";const x=document.getElementById("lcBadge");x.textContent=(u==null?void 0:u.confidence)??"",x.className=`confidence-badge conf-${(u==null?void 0:u.confidence)??"low"}`,r.style.display="block",r.style.borderColor="rgba(34,211,238,0.8)",setTimeout(()=>{r.isConnected&&(r.style.borderColor="rgba(34,211,238,0.25)")},400);const o=document.getElementById("lcRemove"),p=o.cloneNode(!0);o.replaceWith(p),p.addEventListener("click",()=>{const m=t.indexOf(n);m!==-1&&t.splice(m,1),s(),t.length>0?l(t[t.length-1]):r.style.display="none"})}function a(n){if(n.type==="ELEMENT_CAPTURED"){const r=n.element;r&&(t.push(r),l(r)),s()}n.type==="CAPTURE_DONE"&&(chrome.runtime.onMessage.removeListener(a),n.cancelled?b(e,i):t.length===0?b(e,i,"No elements captured."):M(e,i,d,t))}chrome.runtime.onMessage.addListener(a)}function M(e,i,d,c){const t=c.map((o,p)=>({id:p,locators:o.locators,name:o.suggestedName,selectedLocatorIdx:o.locators.findIndex(m=>m.confidence==="high")>=0?o.locators.findIndex(m=>m.confidence==="high"):0,deleted:!1}));function s(){return t.filter(o=>!o.deleted).length}function l(){const o=s(),p=document.getElementById("reviewCount");p&&(p.textContent=`${d} · ${o} element${o!==1?"s":""}`);const m=document.getElementById("importAllBtn");m&&(m.disabled=o===0,m.textContent=`Add ${o} to Repository`);const y=document.getElementById("batchList");y&&o===0&&(y.innerHTML='<div style="color:#475569;font-size:12px;text-align:center;padding:20px 0">All removed</div>')}function a(o){var m;let p=document.getElementById("importError");p||(p=document.createElement("div"),p.id="importError",p.className="error-msg",(m=document.getElementById("importAllBtn"))==null||m.insertAdjacentElement("beforebegin",p)),p.textContent=o}function n(o){var B;const p=document.createElement("div");p.className="batch-row",p.dataset.id=String(o.id);const m=o.locators.map((L,E)=>`<option value="${E}" ${E===o.selectedLocatorIdx?"selected":""}>${L.label}</option>`).join(""),y=((B=o.locators[o.selectedLocatorIdx])==null?void 0:B.confidence)??"low";p.innerHTML=`
      <div class="batch-row-top">
        <span class="batch-idx">${o.id+1}</span>
        <input class="batch-name ext-input" type="text" value="${o.name.replace(/"/g,"&quot;")}"
          placeholder="element_name" data-id="${o.id}" autocomplete="off"/>
        <button class="batch-del" data-id="${o.id}" title="Remove">×</button>
      </div>
      <div class="batch-row-loc">
        <select class="batch-loc ext-select" data-id="${o.id}">${m}</select>
        <span class="confidence-badge conf-${y}">${y}</span>
        <button class="copy-loc-btn" title="Copy locator"
          style="background:none;border:1px solid rgba(255,255,255,0.12);color:#64748b;border-radius:4px;
                 padding:2px 6px;font-size:11px;cursor:pointer;line-height:1.6;flex-shrink:0;transition:color 0.2s,border-color 0.2s">⎘</button>
      </div>`,p.querySelector(".batch-name").addEventListener("input",L=>{o.name=L.target.value}),p.querySelector(".batch-loc").addEventListener("change",L=>{var k;o.selectedLocatorIdx=parseInt(L.target.value,10);const E=p.querySelector(".confidence-badge"),$=((k=o.locators[o.selectedLocatorIdx])==null?void 0:k.confidence)??"low";E.className=`confidence-badge conf-${$}`,E.textContent=$}),p.querySelector(".batch-del").addEventListener("click",()=>{o.deleted=!0,p.remove(),l()});const f=p.querySelector(".copy-loc-btn");return f.addEventListener("click",async()=>{var E;const L=((E=o.locators[o.selectedLocatorIdx])==null?void 0:E.value)??"";await navigator.clipboard.writeText(L),T(f)}),p}const r=s();h.innerHTML=`${w(`${e.name}`)}
    <div class="body" style="padding-bottom:0">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <label style="margin-bottom:0">Review captures</label>
        <span id="reviewCount" style="font-size:11px;color:#64748b">${d} · ${r} element${r!==1?"s":""}</span>
      </div>
    </div>
    <div id="batchList" style="overflow-y:auto;max-height:calc(100vh - 200px);padding:0 14px;display:flex;flex-direction:column;gap:8px;margin-top:8px"></div>
    <div class="body" style="padding-top:10px;border-top:1px solid rgba(255,255,255,0.07);margin-top:8px">
      <button class="btn btn-primary" id="importAllBtn" ${r===0?"disabled":""}>
        Add ${r} to Repository
      </button>
      <div style="display:flex;gap:8px;margin-top:-4px">
        <button class="btn btn-ghost" id="captureMoreBtn" style="flex:1">+ Capture more</button>
        <button class="btn btn-ghost" id="copyAllBtn" style="flex:1" ${r===0?"disabled":""}>⎘ Copy all</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:-4px">
        <button class="btn btn-ghost" id="homeBtn" style="flex:1">← Home</button>
        <button class="btn btn-ghost" id="clearAllBtn" style="flex:1;color:#f87171" ${r===0?"disabled":""}>✕ Clear all</button>
      </div>
    </div>`;const u=document.getElementById("batchList");t.forEach(o=>u.appendChild(n(o))),document.getElementById("importAllBtn").addEventListener("click",x),document.getElementById("homeBtn").addEventListener("click",()=>void b(e,i)),document.getElementById("clearAllBtn").addEventListener("click",()=>{t.forEach(o=>{o.deleted=!0}),u.innerHTML='<div style="color:#475569;font-size:12px;text-align:center;padding:20px 0">All cleared</div>',l()}),document.getElementById("captureMoreBtn").addEventListener("click",async()=>{const o=t.filter(p=>!p.deleted).map(p=>({locators:p.locators,suggestedName:p.name}));A(e,i,d,o),await v({type:"START_BATCH_PICK"})});const g=document.getElementById("copyAllBtn");g&&g.addEventListener("click",async()=>{const p=t.filter(m=>!m.deleted).map(m=>{var B;const y=m.name.trim().replace(/\s+/g,"_")||`element_${m.id+1}`,f=((B=m.locators[m.selectedLocatorIdx])==null?void 0:B.value)??"";return`\${${y}}    ${f}`}).join(`
`);await navigator.clipboard.writeText(p),T(g),g.textContent="✓ Copied",setTimeout(()=>{g.isConnected&&(g.textContent="⎘ Copy all")},1500)});async function x(){const o=t.filter(y=>!y.deleted),p=o.map(y=>{var f;return{name:y.name.trim().replace(/\s+/g,"_")||`element_${y.id+1}`,locatorValue:((f=y.locators[y.selectedLocatorIdx])==null?void 0:f.value)??""}}).filter(y=>y.locatorValue);if(p.length===0)return;const m=document.getElementById("importAllBtn");m.disabled=!0,m.innerHTML='<span class="spinner"></span> Importing…';try{const y=await v({type:"IMPORT_BATCH",projectId:e.id,pageName:d,elements:p});if(!y.ok){m.disabled=!1,m.textContent=`Add ${o.length} to Repository`,a(String(y.error??"Import failed"));return}const f=y.data;H(e,i,d,((f==null?void 0:f.created)??0)+((f==null?void 0:f.updated)??0))}catch(y){m.disabled=!1,m.textContent=`Add ${o.length} to Repository`,a(String(y))}}}function O(e,i,d){const c=[];function t(){const l=document.getElementById("flowStepCount");l&&(l.textContent=String(c.length))}h.innerHTML=`${w(`${e.name}`)}
    <div class="pick-state">
      <div class="pick-icon" style="color:#a78bfa">▶</div>
      <div style="color:#e2e8f0;font-weight:500">Recording UI flow</div>
      <div id="flowStepCount" style="font-size:26px;font-weight:700;color:#a78bfa;font-variant-numeric:tabular-nums">0</div>
      <div style="font-size:11px;color:#64748b">steps recorded</div>
    </div>

    <div id="lastStep" style="margin:0 14px 0;display:none;
      background:#1e293b;border:1px solid rgba(167,139,250,0.25);border-radius:8px;padding:10px 12px;
      transition:border-color 0.3s;">
      <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Last step</div>
      <div id="lsAction" style="font-size:12px;color:#a78bfa;font-weight:600;margin-bottom:2px"></div>
      <div id="lsLabel" style="font-size:11px;font-family:monospace;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
    </div>

    <div style="padding:14px 14px 0">
      <div style="font-size:11px;color:#475569;text-align:center;margin-bottom:10px">
        Interact on the page. Clicks, fills, selects &amp; navigation are recorded.
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-danger" id="cancelFlowBtn" style="flex:1;padding:7px 0;font-size:12px">
          Cancel
        </button>
        <button class="btn btn-primary" id="doneFlowBtn" style="flex:2;padding:7px 0;font-size:13px;background:#7c3aed;border-color:#7c3aed">
          Done
        </button>
      </div>
    </div>`,document.getElementById("doneFlowBtn").addEventListener("click",async()=>{chrome.runtime.onMessage.removeListener(s),await v({type:"FINISH_FLOW"}),c.length>0?R(e,i,d,c):b(e,i,"No steps recorded.")}),document.getElementById("cancelFlowBtn").addEventListener("click",async()=>{chrome.runtime.onMessage.removeListener(s),await v({type:"CANCEL_FLOW"}),await b(e,i)});function s(l){if(l.type==="STEP_RECORDED"){const a=l.step;if(a){const Z=c[c.length-1];if(Z&&Z.action===a.action&&Z.locator===a.locator&&Z.url===a.url)return;c.push(a),t();const n=document.getElementById("lastStep");if(n){document.getElementById("lsAction").textContent=`${z(a.action)} ${a.action.toUpperCase()}`;const r=a.action==="navigate"?a.url??a.locatorLabel:a.locatorLabel,u=document.getElementById("lsLabel");u.textContent=a.value?`${r}  →  "${a.value}"`:r,u.title=u.textContent,n.style.display="block",n.style.borderColor="rgba(167,139,250,0.8)",setTimeout(()=>{n.isConnected&&(n.style.borderColor="rgba(167,139,250,0.25)")},400)}}}l.type==="FLOW_DONE"&&(chrome.runtime.onMessage.removeListener(s),l.cancelled?b(e,i):c.length===0?b(e,i,"No steps recorded."):R(e,i,d,c))}chrome.runtime.onMessage.addListener(s)}function R(e,i,d,c){const t=`${d.replace(/[^a-z0-9]/gi,"_").toLowerCase()}_flow`,s=S(t,c);h.innerHTML=`${w(`${e.name}`)}
    <div class="body" style="padding-bottom:0">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <label style="margin-bottom:0">Review flow</label>
        <span style="font-size:11px;color:#64748b">${c.length} step${c.length!==1?"s":""}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:flex-end">
        <div style="flex:1">
          <label>Skill name</label>
          <input id="skillNameInput" class="ext-input" type="text" value="${t}"
            placeholder="skill_name" autocomplete="off"
            style="font-family:monospace;font-size:12px"/>
        </div>
      </div>
    </div>

    <div style="padding:8px 14px 0;display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.05em">RF Script — edit before importing</span>
      <button id="copyScriptBtn"
        style="background:none;border:1px solid rgba(255,255,255,0.12);color:#64748b;border-radius:4px;
               padding:2px 8px;font-size:11px;cursor:pointer;transition:color 0.2s,border-color 0.2s">⎘ Copy</button>
    </div>
    <div style="padding:6px 14px 0;flex:1">
      <textarea id="rfScript"
        style="width:100%;box-sizing:border-box;height:220px;font-family:monospace;font-size:11px;
               background:#0f172a;color:#e2e8f0;border:1px solid rgba(167,139,250,0.3);border-radius:6px;
               padding:10px;resize:vertical;outline:none;line-height:1.6;tab-size:4"
        spellcheck="false">${s.replace(/</g,"&lt;")}</textarea>
    </div>

    <div class="body" style="padding-top:10px;border-top:1px solid rgba(255,255,255,0.07);margin-top:8px">
      <div id="flowImportError" class="error-msg" style="display:none"></div>
      <button class="btn btn-primary" id="importSkillBtn" style="background:#7c3aed;border-color:#7c3aed">
        Import as Skill
      </button>
      <button class="btn btn-ghost" id="discardFlowBtn" style="margin-top:-4px">
        Discard
      </button>
    </div>`;const l=document.getElementById("skillNameInput"),a=document.getElementById("rfScript"),n=document.getElementById("copyScriptBtn");l.addEventListener("input",()=>{const r=l.value.trim().replace(/\s+/g,"_")||t,u=S(r,c);a.value=u}),n.addEventListener("click",async()=>{await navigator.clipboard.writeText(a.value);const r=n.textContent??"";n.textContent="✓ Copied",n.style.color="#22d3ee",n.style.borderColor="#22d3ee",setTimeout(()=>{n.isConnected&&(n.textContent=r,n.style.color="",n.style.borderColor="")},1500)}),document.getElementById("discardFlowBtn").addEventListener("click",()=>void b(e,i)),document.getElementById("importSkillBtn").addEventListener("click",async()=>{const r=l.value.trim().replace(/\s+/g,"_")||t,u=a.value,g=document.getElementById("importSkillBtn"),x=document.getElementById("flowImportError");g.disabled=!0,g.innerHTML='<span class="spinner"></span> Importing…',x.style.display="none";try{const o=await v({type:"IMPORT_SKILL",projectId:e.id,skillName:r,content:u});if(!o.ok){g.disabled=!1,g.textContent="Import as Skill",x.textContent=String(o.error??"Import failed"),x.style.display="block";return}F(e,i,r)}catch(o){g.disabled=!1,g.textContent="Import as Skill",x.textContent=String(o),x.style.display="block"}})}function H(e,i,d,c){h.innerHTML=`${w(`${e.name}`)}
    <div class="success-state">
      <div class="success-check">✓</div>
      <div style="color:#e2e8f0;font-weight:500">Added to Repository</div>
      <div class="success-msg">
        <strong style="color:#22d3ee">${c}</strong> locator${c!==1?"s":""} → ${d}
      </div>
      <button class="btn btn-primary" id="nextBtn" style="width:auto;padding:7px 20px;margin-top:8px">
        Capture more
      </button>
    </div>`,document.getElementById("nextBtn").addEventListener("click",()=>void b(e,i))}function F(e,i,d){h.innerHTML=`${w(`${e.name}`)}
    <div class="success-state">
      <div class="success-check" style="background:rgba(124,58,237,0.15);color:#a78bfa">✓</div>
      <div style="color:#e2e8f0;font-weight:500">Skill Created</div>
      <div class="success-msg" style="font-family:monospace;color:#a78bfa">${d}</div>
      <button class="btn btn-primary" id="nextBtn" style="width:auto;padding:7px 20px;margin-top:8px;background:#7c3aed;border-color:#7c3aed">
        Record another
      </button>
    </div>`,document.getElementById("nextBtn").addEventListener("click",()=>void b(e,i))}async function _(){N();try{const e=await v({type:"GET_AUTH_STATE"});if(!e.ok||!e.authenticated){I();return}const i=e.user,c=((await v({type:"GET_PROJECTS"})).data??{}).projects??[];if(c.length===0){C([],i.email,"No projects found.");return}C(c,i.email)}catch(e){I(`Error: ${String(e)}`)}}_();
