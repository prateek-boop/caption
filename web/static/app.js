// Captioner Studio Client Application
let state = {
  token: localStorage.getItem("captioner_token") || null,
  user: null,
  jobs: [],
  currentJob: null,
  systemInfo: null,
  activeView: "dashboard",
  pollInterval: null,
  selectedFile: null,
  audioDuration: 0,
};

// Speaker color cache
const speakerColorMap = {};
let speakerColorIndex = 0;

function getSpeakerColorClass(speaker) {
  if (!speaker) return "speaker-badge-default";
  if (!speakerColorMap[speaker]) {
    speakerColorMap[speaker] = `speaker-badge-${speakerColorIndex % 5}`;
    speakerColorIndex++;
  }
  return speakerColorMap[speaker];
}

// ------------------ Notification Toasts ------------------
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  // Deduplicate existing identical toasts
  const existingToasts = container.querySelectorAll(".toast-item");
  for (const el of existingToasts) {
    if (el.dataset.msg === message) {
      el.classList.add("scale-105", "brightness-125");
      setTimeout(() => el.classList.remove("scale-105", "brightness-125"), 300);
      return;
    }
  }

  const toast = document.createElement("div");
  toast.dataset.msg = message;
  const icon =
    type === "success" ? '<i class="fa-solid fa-circle-check text-emerald-400"></i>' :
    type === "error" ? '<i class="fa-solid fa-circle-exclamation text-rose-400"></i>' :
    '<i class="fa-solid fa-circle-info text-brand-400"></i>';

  toast.className = `toast-item toast-obsidian p-3 text-xs flex items-center gap-2.5 transition-all transform duration-200 pointer-events-auto text-slate-200 animate-fade-in`;
  toast.innerHTML = `${icon} <span class="font-medium">${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(20px)";
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

// ------------------ API Helper ------------------
async function apiRequest(endpoint, options = {}) {
  const headers = options.headers || {};
  if (state.token) {
    headers["Authorization"] = `Bearer ${state.token}`;
  }

  // Handle FormData vs JSON
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }

  try {
    const res = await fetch(endpoint, { ...options, headers });
    if (res.status === 401) {
      logout();
      throw new Error("Session expired. Please sign in again.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || `Request failed with status ${res.status}`);
    }
    return data;
  } catch (err) {
    throw err;
  }
}

// ------------------ Auth Functions ------------------
function showAuthError(msg) {
  const banner = document.getElementById("auth-error-banner");
  const text = document.getElementById("auth-error-text");
  const actions = document.getElementById("auth-error-actions");
  if (banner && text) {
    text.textContent = msg;
    if (actions) {
      actions.innerHTML = "";
      if (msg.toLowerCase().includes("already registered") || msg.toLowerCase().includes("taken")) {
        const regEmail = document.getElementById("reg-email")?.value.trim() || "";
        const regUser = document.getElementById("reg-username")?.value.trim() || "";
        const targetIdentifier = regEmail || regUser || "";

        actions.innerHTML = `
          <button type="button" onclick="switchToLoginWith('${targetIdentifier}')" class="px-2.5 py-1 rounded-lg bg-rose-900 hover:bg-rose-800 text-white text-[11px] font-semibold transition-colors flex items-center gap-1">
            <i class="fa-solid fa-arrow-right-to-bracket text-[10px]"></i>
            <span>Sign In with this Email</span>
          </button>
          <button type="button" onclick="switchToResetWith('${regEmail}')" class="px-2.5 py-1 rounded-lg bg-rose-900/60 hover:bg-rose-800 text-rose-200 text-[11px] font-medium transition-colors">
            Reset Password
          </button>
        `;
        actions.classList.remove("hidden");
      } else {
        actions.classList.add("hidden");
      }
    }
    banner.classList.remove("hidden");
  }
  showToast(msg, "error");
}

function hideAuthError() {
  const banner = document.getElementById("auth-error-banner");
  if (banner) banner.classList.add("hidden");
}

function switchToLoginWith(identifier) {
  switchAuthTab("login");
  if (identifier) {
    const input = document.getElementById("login-username");
    if (input) {
      input.value = identifier;
      document.getElementById("login-password")?.focus();
    }
  }
}

function switchToResetWith(email) {
  switchAuthTab("reset");
  if (email) {
    const input = document.getElementById("reset-email");
    if (input) {
      input.value = email;
      document.getElementById("reset-password")?.focus();
    }
  }
}

function showAuthModal() {
  const m = document.getElementById("auth-modal");
  if (m) {
    m.classList.remove("hidden");
    m.style.setProperty("display", "flex", "important");
  }
}

function hideAuthModal() {
  const m = document.getElementById("auth-modal");
  if (m) {
    m.classList.add("hidden");
    m.style.setProperty("display", "none", "important");
  }
}

function switchAuthTab(tab) {
  hideAuthError();
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const tabReset = document.getElementById("tab-reset");
  const formLogin = document.getElementById("form-login");
  const formRegister = document.getElementById("form-register");
  const formReset = document.getElementById("form-reset");

  const activeTabClass = "flex-1 pb-3 text-sm font-semibold border-b-2 border-brand-500 text-brand-400 transition-colors";
  const inactiveTabClass = "flex-1 pb-3 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition-colors";

  if (tab === "login") {
    if (tabLogin) tabLogin.className = activeTabClass;
    if (tabRegister) tabRegister.className = inactiveTabClass;
    if (tabReset) {
      tabReset.classList.add("hidden");
      tabReset.style.setProperty("display", "none", "important");
    }
    if (formLogin) {
      formLogin.classList.remove("hidden");
      formLogin.style.setProperty("display", "block", "important");
    }
    if (formRegister) {
      formRegister.classList.add("hidden");
      formRegister.style.setProperty("display", "none", "important");
    }
    if (formReset) {
      formReset.classList.add("hidden");
      formReset.style.setProperty("display", "none", "important");
    }
  } else if (tab === "register") {
    if (tabRegister) tabRegister.className = activeTabClass;
    if (tabLogin) tabLogin.className = inactiveTabClass;
    if (tabReset) {
      tabReset.classList.add("hidden");
      tabReset.style.setProperty("display", "none", "important");
    }
    if (formRegister) {
      formRegister.classList.remove("hidden");
      formRegister.style.setProperty("display", "block", "important");
    }
    if (formLogin) {
      formLogin.classList.add("hidden");
      formLogin.style.setProperty("display", "none", "important");
    }
    if (formReset) {
      formReset.classList.add("hidden");
      formReset.style.setProperty("display", "none", "important");
    }
  } else if (tab === "reset") {
    if (tabReset) {
      tabReset.classList.remove("hidden");
      tabReset.style.setProperty("display", "block", "important");
      tabReset.className = activeTabClass;
    }
    if (tabLogin) tabLogin.className = inactiveTabClass;
    if (tabRegister) tabRegister.className = inactiveTabClass;
    if (formLogin) {
      formLogin.classList.add("hidden");
      formLogin.style.setProperty("display", "none", "important");
    }
    if (formRegister) {
      formRegister.classList.add("hidden");
      formRegister.style.setProperty("display", "none", "important");
    }
    if (formReset) {
      formReset.classList.remove("hidden");
      formReset.style.setProperty("display", "block", "important");
    }
  }
}

async function handleLogin(e) {
  e.preventDefault();
  hideAuthError();

  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const btn = document.getElementById("btn-login-submit");

  if (!username) {
    showAuthError("Please enter your username or email address.");
    return;
  }
  if (!password) {
    showAuthError("Please enter your password.");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Signing in...</span>';

  try {
    const res = await apiRequest("/api/auth/login", {
      method: "POST",
      body: { username, password }
    });
    state.token = res.access_token;
    localStorage.setItem("captioner_token", res.access_token);
    state.user = res.user;
    hideAuthModal();
    showToast(`Welcome back, ${res.user.username}!`, "success");
    await initializeApp();
  } catch (err) {
    showAuthError(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Sign In</span> <i class="fa-solid fa-arrow-right text-xs"></i>';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  hideAuthError();

  const username = document.getElementById("reg-username").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;
  const btn = document.getElementById("btn-reg-submit");

  if (username.length < 3) {
    showAuthError("Username must be at least 3 characters.");
    return;
  }
  if (!email || !email.includes("@")) {
    showAuthError("Please provide a valid email address.");
    return;
  }
  if (password.length < 4) {
    showAuthError("Password must be at least 4 characters.");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Creating account...</span>';

  try {
    const res = await apiRequest("/api/auth/register", {
      method: "POST",
      body: { username, email, password }
    });
    state.token = res.access_token;
    localStorage.setItem("captioner_token", res.access_token);
    state.user = res.user;
    hideAuthModal();
    showToast(`Account created! Welcome, ${res.user.username}!`, "success");
    await initializeApp();
  } catch (err) {
    showAuthError(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Create Account</span> <i class="fa-solid fa-user-plus text-xs"></i>';
  }
}

async function handleResetPassword(e) {
  e.preventDefault();
  hideAuthError();

  const email = document.getElementById("reset-email").value.trim();
  const new_password = document.getElementById("reset-password").value;
  const btn = document.getElementById("btn-reset-submit");

  if (!email || !email.includes("@")) {
    showAuthError("Please provide a valid account email address.");
    return;
  }
  if (new_password.length < 4) {
    showAuthError("Password must be at least 4 characters.");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Updating password...</span>';

  try {
    const res = await apiRequest("/api/auth/reset-password", {
      method: "POST",
      body: { email, new_password }
    });
    state.token = res.access_token;
    localStorage.setItem("captioner_token", res.access_token);
    state.user = res.user;
    hideAuthModal();
    showToast(`Password updated! Welcome back, ${res.user.username}!`, "success");
    await initializeApp();
  } catch (err) {
    showAuthError(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Reset Password & Sign In</span> <i class="fa-solid fa-check text-xs"></i>';
  }
}

async function handleGuestLogin() {
  hideAuthError();
  const btn = document.getElementById("btn-guest-login");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Entering studio...</span>';
  }

  try {
    const res = await apiRequest("/api/auth/guest", {
      method: "POST"
    });
    state.token = res.access_token;
    localStorage.setItem("captioner_token", res.access_token);
    state.user = res.user;
    hideAuthModal();
    showToast(`Signed in as Guest! Welcome to Captioner Studio.`, "success");
    await initializeApp();
  } catch (err) {
    showAuthError("Guest sign-in failed: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-bolt text-amber-400 text-[11px]"></i> <span>Continue as Guest (Instant Access)</span>';
    }
  }
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("captioner_token");
  showAuthModal();
  hideAuthError();
  if (state.pollInterval) clearInterval(state.pollInterval);
}

// ------------------ Routing & Navigation ------------------
function navigate(viewName, params = {}) {
  state.activeView = viewName;

  document.querySelectorAll("main > section").forEach(sec => {
    sec.classList.add("hidden");
    sec.style.setProperty("display", "none", "important");
  });
  const target = document.getElementById(`view-${viewName}`);
  if (target) {
    target.classList.remove("hidden");
    target.style.setProperty("display", "block", "important");
  }

  // Update top title
  const topTitle = document.getElementById("top-header-title");
  if (topTitle) {
    const titles = {
      dashboard: "Studio Dashboard",
      "new-transcription": "Transcription Pipeline Studio",
      editor: "Transcript & Word-Level Karaoke Editor",
      clipper: "3D Media Clipper Studio",
      clips: "Clips Library",
      settings: "Hardware Diagnostics & Settings",
    };
    topTitle.textContent = titles[viewName] || "Studio Workspace";
  }

  // Update navigation button active state
  ["dashboard", "new-transcription", "clipper", "clips", "settings"].forEach(v => {
    const btn = document.getElementById(`nav-${v}`);
    if (btn) {
      if (v === viewName) {
        btn.className = "w-full px-3.5 py-2.5 rounded-xl text-xs font-semibold text-white bg-slate-800/90 transition-all flex items-center justify-between border border-slate-700/60 shadow-sm group";
      } else {
        btn.className = "w-full px-3.5 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800/60 transition-all flex items-center justify-between border border-transparent group";
      }
    }
  });

  if (viewName === "dashboard") {
    loadJobs();
    loadDashboardRecentClips();
  } else if (viewName === "editor" && params.jobId) {
    loadEditorJob(params.jobId);
  } else if (viewName === "clipper") {
    initClipperStudio(params);
  } else if (viewName === "clips") {
    loadAllClips();
  }
}

// Attach globally to window for rock-solid HTML onclick handler resolution
window.switchAuthTab = switchAuthTab;
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleResetPassword = handleResetPassword;
window.handleGuestLogin = handleGuestLogin;
window.logout = logout;
window.navigate = navigate;

// ------------------ System Information ------------------
async function loadSystemInfo() {
  try {
    const info = await apiRequest("/api/system/info");
    state.systemInfo = info;
    const gpuText = document.getElementById("gpu-info-text");
    const metricEngine = document.getElementById("metric-engine");
    const diagCuda = document.getElementById("diag-cuda");
    const diagGpu = document.getElementById("diag-gpu");

    if (info.cuda_available) {
      gpuText.textContent = `GPU: ${info.gpu_name}`;
      metricEngine.textContent = `GPU (${info.gpu_name.split(' ')[0]})`;
      diagCuda.textContent = `Active (CUDA ${info.cuda_version || '12'})`;
      diagCuda.className = "text-emerald-400 font-bold";
      diagGpu.textContent = info.gpu_name;
    } else {
      gpuText.textContent = "Engine: CPU (int8/fp32)";
      metricEngine.textContent = "CPU (faster-whisper)";
      diagCuda.textContent = "Disabled / CPU Only";
      diagCuda.className = "text-amber-400 font-bold";
      diagGpu.textContent = "None detected";
    }
  } catch (err) {
    console.error("Failed to fetch system info:", err);
  }
}

// ------------------ Job Management & Filtering ------------------
let currentJobFilter = "all";
let currentJobSearchQuery = "";

function setJobFilter(filter) {
  currentJobFilter = filter;
  ["all", "completed", "processing", "failed"].forEach(f => {
    const btn = document.getElementById(`filter-job-${f}`);
    if (btn) {
      if (f === filter) {
        btn.className = "py-1 px-3 rounded-lg bg-indigo-600 text-white font-semibold transition-all shadow-sm";
      } else {
        btn.className = "py-1 px-3 rounded-lg text-slate-400 hover:text-white transition-all";
      }
    }
  });
  applyJobFiltersAndRender();
}

function handleDashboardSearch(val) {
  currentJobSearchQuery = (val || "").trim().toLowerCase();
  const clearBtn = document.getElementById("btn-clear-dash-search");
  if (clearBtn) {
    if (currentJobSearchQuery) {
      clearBtn.classList.remove("hidden");
    } else {
      clearBtn.classList.add("hidden");
    }
  }
  applyJobFiltersAndRender();
}

function clearDashboardSearch() {
  const input = document.getElementById("dashboard-search-input");
  if (input) input.value = "";
  handleDashboardSearch("");
}

function applyJobFiltersAndRender() {
  const jobs = state.jobs || [];

  // Update counts on filter pills
  const countAll = jobs.length;
  const countCompleted = jobs.filter(j => j.status === "completed").length;
  const countProcessing = jobs.filter(j => j.status === "pending" || j.status === "running").length;
  const countFailed = jobs.filter(j => j.status === "failed").length;

  const elAll = document.getElementById("count-job-all");
  const elComp = document.getElementById("count-job-completed");
  const elProc = document.getElementById("count-job-processing");
  const elFail = document.getElementById("count-job-failed");
  if (elAll) elAll.textContent = countAll;
  if (elComp) elComp.textContent = countCompleted;
  if (elProc) elProc.textContent = countProcessing;
  if (elFail) elFail.textContent = countFailed;

  let filtered = jobs;
  if (currentJobFilter === "completed") {
    filtered = filtered.filter(j => j.status === "completed");
  } else if (currentJobFilter === "processing") {
    filtered = filtered.filter(j => j.status === "pending" || j.status === "running");
  } else if (currentJobFilter === "failed") {
    filtered = filtered.filter(j => j.status === "failed");
  }

  if (currentJobSearchQuery) {
    filtered = filtered.filter(j => {
      const title = (j.title || "").toLowerCase();
      const filename = (j.original_filename || "").toLowerCase();
      const model = ((j.options && j.options.model_size) || "").toLowerCase();
      const lang = (j.detected_language || "").toLowerCase();
      const id = (j.id || "").toLowerCase();
      return title.includes(currentJobSearchQuery) ||
             filename.includes(currentJobSearchQuery) ||
             model.includes(currentJobSearchQuery) ||
             lang.includes(currentJobSearchQuery) ||
             id.includes(currentJobSearchQuery);
    });
  }

  renderJobsTable(filtered);
}

async function loadJobs() {
  const refreshIcon = document.getElementById("refresh-jobs-icon");
  if (refreshIcon) refreshIcon.classList.add("fa-spin");
  try {
    const jobs = await apiRequest("/api/jobs");
    state.jobs = jobs;
    applyJobFiltersAndRender();
    updateMetrics(jobs);
  } catch (err) {
    console.error("Error loading jobs:", err);
  } finally {
    if (refreshIcon) {
      setTimeout(() => refreshIcon.classList.remove("fa-spin"), 400);
    }
  }
}

function updateMetrics(jobs) {
  const totalEl = document.getElementById("metric-total-jobs");
  if (totalEl) totalEl.textContent = jobs.length;

  const completed = jobs.filter(j => j.status === "completed").length;
  const compEl = document.getElementById("metric-completed-jobs");
  if (compEl) compEl.textContent = completed;

  const totalSecs = jobs.reduce((acc, j) => acc + (j.audio_duration || 0), 0);
  const hours = (totalSecs / 3600).toFixed(1);
  const durEl = document.getElementById("metric-total-duration");
  if (durEl) durEl.textContent = `${hours}h`;

  const activeCount = jobs.filter(j => j.status === "pending" || j.status === "running").length;
  const activeEl = document.getElementById("active-jobs-counter");
  if (activeEl) activeEl.textContent = `${activeCount} active`;
}

function getStatusBadge(status, step, progress) {
  if (status === "completed") {
    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
              <i class="fa-solid fa-circle-check text-[10px]"></i> Completed
            </span>`;
  }
  if (status === "failed") {
    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-semibold">
              <i class="fa-solid fa-circle-xmark text-[10px]"></i> Failed
            </span>`;
  }
  // Running or pending
  const stepLabel =
    step === "queued" ? "Queued" :
    step === "transcribing" ? "Transcribing..." :
    step === "aligning" ? "Forced Alignment..." :
    step === "diarizing" ? "Diarizing Speakers..." : "Processing...";

  return `
    <div class="space-y-1.5 min-w-[130px]">
      <div class="flex items-center justify-between text-[11px]">
        <span class="text-brand-400 font-medium flex items-center gap-1">
          <i class="fa-solid fa-spinner fa-spin text-[10px]"></i> ${stepLabel}
        </span>
        <span class="font-mono text-slate-400">${Math.round(progress)}%</span>
      </div>
      <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div class="h-full bg-brand-500 rounded-full transition-all duration-300" style="width: ${progress}%;"></div>
      </div>
    </div>
  `;
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function toggleRowExportMenu(event, jobId) {
  event.stopPropagation();
  document.querySelectorAll(".row-export-menu").forEach(el => {
    if (el.id !== `row-export-menu-${jobId}`) el.classList.add("hidden");
  });
  const menu = document.getElementById(`row-export-menu-${jobId}`);
  if (menu) menu.classList.toggle("hidden");
}

function directExportJob(jobId, format) {
  const token = state.token;
  const url = `/api/jobs/${jobId}/export/${format}${token ? '?token=' + encodeURIComponent(token) : ''}`;
  window.open(url, '_blank');
}

function renderJobsTable(jobs) {
  const tbody = document.getElementById("jobs-table-body");
  if (!tbody) return;

  if (!jobs || jobs.length === 0) {
    const isFiltered = currentJobFilter !== "all" || currentJobSearchQuery.length > 0;
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-12 text-center text-slate-500">
          <i class="fa-solid fa-folder-open text-2xl mb-2 block"></i>
          ${isFiltered ? `No jobs match your current filter or search. <button onclick="setJobFilter('all'); clearDashboardSearch();" class="text-brand-400 underline font-semibold ml-1">Clear filters</button>` : `No transcription jobs yet. Click "New Job" to begin!`}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = jobs.map(j => {
    const opts = j.options || {};
    const modelTag = opts.model_size || "base";
    const alignTag = opts.align ? '<span class="text-emerald-400" title="Aligned"><i class="fa-solid fa-bullseye text-[10px]"></i></span>' : '';
    const diarizeTag = opts.diarize ? '<span class="text-indigo-400" title="Diarized"><i class="fa-solid fa-users text-[10px]"></i></span>' : '';
    const isCompleted = j.status === "completed";

    return `
      <tr class="hover:bg-slate-800/30 transition-colors">
        <td class="py-3.5 px-5">
          <div class="font-semibold text-white truncate max-w-[200px]" title="${j.title}">${j.title}</div>
          <div class="text-xs text-slate-500 font-mono truncate max-w-[200px]">${j.original_filename}</div>
        </td>
        <td class="py-3.5 px-5">
          <div class="flex items-center gap-1.5">
            <span class="px-2 py-0.5 rounded bg-slate-800 text-[11px] font-mono text-slate-300">${modelTag}</span>
            ${alignTag}
            ${diarizeTag}
          </div>
        </td>
        <td class="py-3.5 px-5 font-mono text-xs text-slate-400">
          ${j.detected_language ? j.detected_language.toUpperCase() : 'AUTO'}
        </td>
        <td class="py-3.5 px-5 font-mono text-xs text-slate-400">
          ${formatDuration(j.audio_duration)}
        </td>
        <td class="py-3.5 px-5">
          ${getStatusBadge(j.status, j.current_step, j.progress)}
        </td>
        <td class="py-3.5 px-5 text-right whitespace-nowrap">
          <button onclick="navigate('editor', { jobId: '${j.id}' })"
                  class="px-2.5 py-1.5 rounded-lg bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 text-xs font-semibold transition-colors mr-1" title="Open in Editor">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> Open
          </button>
          <button onclick="navigate('clipper', { jobId: '${j.id}' })"
                  class="px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold transition-colors mr-1" title="Clip Media in 3D">
            <i class="fa-solid fa-scissors"></i> Clip
          </button>
          ${isCompleted ? `
            <div class="inline-block relative text-left">
              <button type="button" onclick="toggleRowExportMenu(event, '${j.id}')"
                      class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors mr-1" title="Quick Export Subtitles">
                <i class="fa-solid fa-download"></i> Export <i class="fa-solid fa-caret-down text-[9px] ml-0.5"></i>
              </button>
              <div id="row-export-menu-${j.id}" class="row-export-menu hidden absolute right-0 mt-1 w-36 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl py-1 z-30 text-left font-sans">
                <button onclick="directExportJob('${j.id}', 'srt')" class="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2">
                  <i class="fa-regular fa-closed-captioning text-brand-400"></i> SRT Subtitles
                </button>
                <button onclick="directExportJob('${j.id}', 'vtt')" class="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2">
                  <i class="fa-solid fa-file-lines text-indigo-400"></i> WebVTT
                </button>
                <button onclick="directExportJob('${j.id}', 'json')" class="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2">
                  <i class="fa-solid fa-code text-amber-400"></i> JSON Payload
                </button>
                <button onclick="directExportJob('${j.id}', 'txt')" class="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2">
                  <i class="fa-solid fa-align-left text-emerald-400"></i> Plain Text
                </button>
              </div>
            </div>
          ` : ''}
          <button onclick="deleteJob('${j.id}')"
                  class="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 text-xs transition-colors" title="Delete">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

async function deleteJob(jobId) {
  if (!confirm("Are you sure you want to delete this transcription job?")) return;
  try {
    await apiRequest(`/api/jobs/${jobId}`, { method: "DELETE" });
    showToast("Job deleted", "info");
    loadJobs();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ------------------ New Transcription Upload & Pipeline ------------------
function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  const dz = document.getElementById("drop-zone");
  if (dz) dz.classList.add("border-brand-500", "bg-brand-500/10");
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  const dz = document.getElementById("drop-zone");
  if (dz) dz.classList.remove("border-brand-500", "bg-brand-500/10");
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const dz = document.getElementById("drop-zone");
  if (dz) dz.classList.remove("border-brand-500", "bg-brand-500/10");

  if (e.dataTransfer && e.dataTransfer.files.length > 0) {
    processSelectedMediaFile(e.dataTransfer.files[0]);
  }
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processSelectedMediaFile(file);
}

function processSelectedMediaFile(file) {
  state.selectedFile = file;

  const prompt = document.getElementById("drop-prompt");
  const preview = document.getElementById("file-preview");
  const nameEl = document.getElementById("file-name");
  const sizeEl = document.getElementById("file-size");
  const durEl = document.getElementById("file-duration");

  if (prompt) prompt.classList.add("hidden");
  if (preview) {
    preview.classList.remove("hidden");
    preview.classList.add("flex");
  }
  if (nameEl) nameEl.textContent = file.name;
  if (sizeEl) sizeEl.textContent = formatBytes(file.size);

  // Probe audio duration using temporary Audio object
  try {
    const tempUrl = URL.createObjectURL(file);
    const audio = new Audio(tempUrl);
    audio.onloadedmetadata = () => {
      state.audioDuration = audio.duration;
      if (durEl) durEl.textContent = formatDuration(audio.duration);
      URL.revokeObjectURL(tempUrl);
    };
  } catch (err) {
    console.warn("Could not probe file duration:", err);
  }
}

function clearSelectedFile(e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  state.selectedFile = null;
  state.audioDuration = 0;

  const input = document.getElementById("file-input");
  if (input) input.value = "";

  const prompt = document.getElementById("drop-prompt");
  const preview = document.getElementById("file-preview");

  if (prompt) prompt.classList.remove("hidden");
  if (preview) {
    preview.classList.add("hidden");
    preview.classList.remove("flex");
  }
}

function toggleDiarizeOptions(enabled) {
  const opts = document.getElementById("diarize-options");
  if (opts) {
    if (enabled) {
      opts.classList.remove("hidden");
    } else {
      opts.classList.add("hidden");
    }
  }
}

async function handleStartTranscription(e) {
  e.preventDefault();
  if (!state.selectedFile) {
    showToast("Please choose or drop an audio or video file first.", "error");
    return;
  }

  const btn = document.getElementById("btn-submit-job");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Uploading & Dispatching Pipeline...</span>';
  }

  const modelVal = document.getElementById("config-model")?.value || "base";
  const deviceVal = document.getElementById("config-device")?.value || "cpu";
  const computeVal = document.getElementById("config-compute-type")?.value || "int8";
  const batchVal = document.getElementById("config-batch-size")?.value || "16";
  const langVal = document.getElementById("config-language")?.value || "";
  const vadVal = document.getElementById("config-vad-filter")?.checked ?? true;
  const alignVal = document.getElementById("config-align-words")?.checked ?? true;
  const diarizeVal = document.getElementById("config-diarize")?.checked ?? false;

  const formData = new FormData();
  formData.append("file", state.selectedFile);
  formData.append("title", state.selectedFile.name.replace(/\.[^/.]+$/, ""));
  formData.append("model_size", modelVal);
  formData.append("device", deviceVal);
  formData.append("compute_type", computeVal);
  formData.append("batch_size", batchVal);
  formData.append("language", langVal);
  formData.append("align", alignVal ? "true" : "false");
  formData.append("diarize", diarizeVal ? "true" : "false");
  formData.append("vad_filter", vadVal ? "true" : "false");

  const hfToken = document.getElementById("config-hf-token")?.value.trim();
  if (hfToken) formData.append("hf_token", hfToken);

  const minSpeakers = document.getElementById("config-min-speakers")?.value;
  if (minSpeakers) formData.append("min_speakers", minSpeakers);

  const maxSpeakers = document.getElementById("config-max-speakers")?.value;
  if (maxSpeakers) formData.append("max_speakers", maxSpeakers);

  try {
    const res = await apiRequest("/api/transcribe/upload", {
      method: "POST",
      body: formData,
    });
    showToast("Transcription pipeline launched successfully!", "success");
    clearSelectedFile();
    navigate("editor", { jobId: res.job_id });
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-bolt"></i> <span>Start Speech Pipeline</span>';
    }
  }
}

// ------------------ Transcript & Karaoke Studio ------------------
let activeSegmentIndex = -1;
let activeWordIndex = -1;
let currentSegments = [];

async function loadEditorJob(jobId) {
  try {
    const job = await apiRequest(`/api/jobs/${jobId}`);
    state.currentJob = job;
    document.getElementById("editor-job-title").textContent = job.title;

    const badge = document.getElementById("editor-job-status-badge");
    badge.innerHTML = getStatusBadge(job.status, job.current_step, job.progress);

    // Audio / Video element setup
    const isVideo = /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(job.original_filename);
    const videoViewport = document.getElementById("video-viewport");
    const videoPlayer = document.getElementById("video-player");
    const audioUrl = `/api/jobs/${job.id}/audio?token=${state.token}`;

    if (isVideo) {
      if (videoViewport) videoViewport.classList.remove("hidden");
      audioPlayer.pause();
      audioPlayer.src = "";
      if (videoPlayer.src !== window.location.origin + audioUrl) {
        videoPlayer.src = audioUrl;
        videoPlayer.load();
      }
      activeMedia = videoPlayer;
    } else {
      if (videoViewport) videoViewport.classList.add("hidden");
      videoPlayer.pause();
      videoPlayer.src = "";
      if (audioPlayer.src !== window.location.origin + audioUrl) {
        audioPlayer.src = audioUrl;
        audioPlayer.load();
      }
      activeMedia = audioPlayer;
    }

    // Progress bar for ongoing job
    const progCard = document.getElementById("editor-progress-card");
    if (job.status === "pending" || job.status === "running") {
      progCard.classList.remove("hidden");
      document.getElementById("editor-progress-step").textContent = job.current_step;
      document.getElementById("editor-progress-pct").textContent = `${Math.round(job.progress)}%`;
      document.getElementById("editor-progress-bar").style.width = `${job.progress}%`;
    } else {
      progCard.classList.add("hidden");
    }

    // Result rendering
    if (job.result_data && job.result_data.segments) {
      currentSegments = job.result_data.segments;
      renderTranscriptSegments(currentSegments);
    } else if (job.status === "failed") {
      document.getElementById("transcript-segments-container").innerHTML = `
        <div class="p-6 rounded-2xl bg-rose-950/20 border border-rose-800/40 text-center space-y-2">
          <i class="fa-solid fa-triangle-exclamation text-rose-400 text-3xl"></i>
          <h3 class="font-bold text-white">Pipeline Execution Error</h3>
          <p class="text-xs text-rose-300 font-mono">${job.error_message || 'Unknown error occurred.'}</p>
        </div>
      `;
    } else {
      document.getElementById("transcript-segments-container").innerHTML = `
        <div class="p-12 text-center text-slate-500">
          <i class="fa-solid fa-spinner fa-spin text-2xl text-brand-400 mb-3 block"></i>
          Processing audio through Captioner pipeline... Word-level timestamps will appear once finished.
        </div>
      `;
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderTranscriptSegments(segments) {
  const container = document.getElementById("transcript-segments-container");
  if (!segments || segments.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-slate-500">No speech detected in this audio.</div>`;
    return;
  }

  container.innerHTML = segments.map((seg, sIdx) => {
    const speaker = seg.speaker || "SPEAKER_00";
    const speakerClass = getSpeakerColorClass(speaker);
    const startStr = formatDuration(seg.start);
    const endStr = formatDuration(seg.end);

    // If word-level alignments exist, render interactive karaoke words
    let wordsHtml = "";
    if (seg.words && seg.words.length > 0) {
      wordsHtml = seg.words.map((w, wIdx) => {
        const hasTime = w.start !== undefined && w.start !== null;
        return `
          <span class="karaoke-word"
                id="word-${sIdx}-${wIdx}"
                data-start="${w.start}"
                data-end="${w.end}"
                onclick="seekTo(${w.start})">${w.word}</span>
        `;
      }).join(" ");
    } else {
      wordsHtml = `<span class="text-slate-200">${seg.text}</span>`;
    }

    return `
      <div class="segment-card bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 transition-all"
           id="seg-card-${sIdx}"
           data-start="${seg.start}"
           data-end="${seg.end}">
        <div class="flex items-center justify-between gap-2 mb-2">
          <div class="flex items-center gap-2">
            <span class="px-2.5 py-0.5 rounded-lg border text-xs font-semibold font-mono ${speakerClass}">
              ${speaker}
            </span>
            <button onclick="seekTo(${seg.start})" class="text-xs font-mono text-slate-400 hover:text-brand-400 transition-colors">
              <i class="fa-solid fa-play text-[10px] mr-1"></i>${startStr} - ${endStr}
            </button>
          </div>
          <div class="flex items-center gap-1.5">
            <button onclick="openSegmentInClipperStudio(${sIdx})" class="text-rose-400 hover:text-rose-300 text-xs px-2 py-0.5 rounded-lg bg-rose-950/40 border border-rose-500/20 hover:bg-rose-900/50 transition-colors flex items-center gap-1" title="Open this segment in 3D Clipper Studio">
              <i class="fa-solid fa-scissors text-[10px]"></i>
              <span class="text-[10px] font-semibold">Clip 3D</span>
            </button>
            <button onclick="editSegmentText(${sIdx})" class="text-slate-400 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-slate-800 transition-colors" title="Edit text">
              <i class="fa-solid fa-pen text-[10px]"></i>
            </button>
          </div>
        </div>
        <div class="text-sm leading-relaxed text-slate-300" id="seg-content-${sIdx}">
          ${wordsHtml}
        </div>
      </div>
    `;
  }).join("");
}

// ------------------ Audio / Video Player & Karaoke Engine ------------------
const audioPlayer = document.getElementById("audio-player");
const videoPlayer = document.getElementById("video-player");
let activeMedia = audioPlayer;

const btnPlay = document.getElementById("btn-audio-play");
const scrubber = document.getElementById("player-scrubber");
const currentTimeEl = document.getElementById("player-current-time");
const totalTimeEl = document.getElementById("player-total-time");

function toggleAudioPlay() {
  const media = activeMedia || audioPlayer;
  if (media.paused) {
    media.play();
  } else {
    media.pause();
  }
}

function bindMediaEvents(media) {
  if (!media) return;
  media.addEventListener("play", () => {
    btnPlay.innerHTML = '<i class="fa-solid fa-pause"></i>';
  });
  media.addEventListener("pause", () => {
    btnPlay.innerHTML = '<i class="fa-solid fa-play"></i>';
  });
  media.addEventListener("timeupdate", () => {
    if (media !== activeMedia) return;
    const cur = media.currentTime;
    const dur = media.duration || 1;
    scrubber.value = (cur / dur) * 100;
    currentTimeEl.textContent = formatDuration(cur);
    updateKaraokeHighlights(cur);
  });
  media.addEventListener("loadedmetadata", () => {
    if (media !== activeMedia) return;
    totalTimeEl.textContent = formatDuration(media.duration);
  });
}

bindMediaEvents(audioPlayer);
bindMediaEvents(videoPlayer);

function handleScrub(percent) {
  const media = activeMedia || audioPlayer;
  const dur = media.duration;
  if (dur) {
    media.currentTime = (percent / 100) * dur;
  }
}

function seekTo(timestamp) {
  const media = activeMedia || audioPlayer;
  if (timestamp !== undefined && timestamp !== null) {
    media.currentTime = timestamp;
    media.play();
  }
}

function skipAudio(seconds) {
  const media = activeMedia || audioPlayer;
  media.currentTime = Math.max(0, Math.min(media.duration || 0, media.currentTime + seconds));
}

function setPlaybackRate(rate) {
  if (audioPlayer) audioPlayer.playbackRate = parseFloat(rate);
  if (videoPlayer) videoPlayer.playbackRate = parseFloat(rate);
}

function setAudioVolume(vol) {
  if (audioPlayer) audioPlayer.volume = parseFloat(vol);
  if (videoPlayer) videoPlayer.volume = parseFloat(vol);
}

// Word-Level and Segment-Level Realtime Synchronization
function updateKaraokeHighlights(currentTime) {
  if (!currentSegments || currentSegments.length === 0) return;

  // 1. Highlight Active Segment
  let newActiveSeg = -1;
  for (let i = 0; i < currentSegments.length; i++) {
    const s = currentSegments[i];
    if (currentTime >= s.start && currentTime <= s.end) {
      newActiveSeg = i;
      break;
    }
  }

  if (newActiveSeg !== activeSegmentIndex) {
    if (activeSegmentIndex !== -1) {
      const prevEl = document.getElementById(`seg-card-${activeSegmentIndex}`);
      if (prevEl) prevEl.classList.remove("active-segment");
    }
    if (newActiveSeg !== -1) {
      const newEl = document.getElementById(`seg-card-${newActiveSeg}`);
      if (newEl) {
        newEl.classList.add("active-segment");
        // Smooth auto-scroll active segment into view
        newEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
    activeSegmentIndex = newActiveSeg;
  }

  // 2. Highlight Exact Word
  if (activeSegmentIndex !== -1) {
    const seg = currentSegments[activeSegmentIndex];
    if (seg.words && seg.words.length > 0) {
      let newActiveWord = -1;
      for (let w = 0; w < seg.words.length; w++) {
        const word = seg.words[w];
        if (currentTime >= word.start && currentTime <= word.end) {
          newActiveWord = w;
          break;
        }
      }

      if (newActiveWord !== activeWordIndex) {
        if (activeWordIndex !== -1) {
          const prevW = document.getElementById(`word-${activeSegmentIndex}-${activeWordIndex}`);
          if (prevW) prevW.classList.remove("active-word");
        }
        if (newActiveWord !== -1) {
          const newW = document.getElementById(`word-${activeSegmentIndex}-${newActiveWord}`);
          if (newW) newW.classList.add("active-word");
        }
        activeWordIndex = newActiveWord;
      }
    }
  }
}

// ------------------ In-place Editing & Saving ------------------
function editSegmentText(sIdx) {
  const seg = currentSegments[sIdx];
  const newText = prompt("Edit Segment Text:", seg.text);
  if (newText !== null && newText.trim() !== "") {
    seg.text = newText.trim();
    // Update word array loosely if words existed
    renderTranscriptSegments(currentSegments);
    showToast("Segment edited. Remember to click 'Save Changes'!", "info");
  }
}

async function saveTranscriptEdits() {
  if (!state.currentJob) return;
  const btn = document.getElementById("btn-save-edits");
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

  try {
    await apiRequest(`/api/jobs/${state.currentJob.id}/segments`, {
      method: "PUT",
      body: { segments: currentSegments }
    });
    showToast("Changes saved successfully to database!", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span>Save Changes</span>';
  }
}

// ------------------ Exporter & Downloads ------------------
function toggleExportMenu() {
  document.getElementById("export-menu").classList.toggle("hidden");
}

// Close export dropdown when clicking outside
document.addEventListener("click", (e) => {
  const container = document.getElementById("export-dropdown-container");
  if (container && !container.contains(e.target)) {
    const menu = document.getElementById("export-menu");
    if (menu) menu.classList.add("hidden");
  }
});

function downloadExport(fmt) {
  if (!state.currentJob) return;
  const url = `/api/jobs/${state.currentJob.id}/export/${fmt}`;

  const link = document.createElement("a");
  // Attach token header via fetch or standard query
  fetch(url, {
    headers: { Authorization: `Bearer ${state.token}` }
  })
  .then(res => res.blob())
  .then(blob => {
    const downloadUrl = window.URL.createObjectURL(blob);
    link.href = downloadUrl;
    link.download = `${state.currentJob.original_filename.split('.')[0]}.${fmt}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast(`Exported ${fmt.toUpperCase()} successfully!`, "success");
  })
  .catch(err => showToast(`Export failed: ${err.message}`, "error"));
}

function filterTranscript(query) {
  const q = query.toLowerCase().trim();
  const cards = document.querySelectorAll(".segment-card");
  cards.forEach(card => {
    const text = card.textContent.toLowerCase();
    if (!q || text.includes(q)) {
      card.style.display = "";
    } else {
      card.style.display = "none";
    }
  });
}

// ------------------ Settings View ------------------
async function handleSaveSettings(e) {
  e.preventDefault();
  const hfToken = document.getElementById("settings-hf-token")?.value.trim() || "";
  const defaultModel = document.getElementById("settings-default-model")?.value || "base";
  const defaultDevice = document.getElementById("settings-default-device")?.value || (state.systemInfo?.cuda_available ? "cuda" : "cpu");
  const defaultCompute = document.getElementById("settings-default-compute")?.value || (defaultDevice === "cuda" ? "float16" : "int8");

  try {
    await apiRequest("/api/auth/settings", {
      method: "PUT",
      body: {
        default_hf_token: hfToken,
        default_model: defaultModel,
        default_device: defaultDevice,
        default_compute_type: defaultCompute,
      }
    });
    showToast("System settings saved successfully!", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ------------------ Global App Initialization ------------------
async function initializeApp() {
  if (!state.token) {
    showAuthModal();
    return;
  }

  let me;
  try {
    me = await apiRequest("/api/auth/me");
  } catch (authErr) {
    console.warn("Session check failed:", authErr);
    logout();
    return;
  }

  try {
    state.user = me;
    const nameEl = document.getElementById("user-display-name");
    if (nameEl) nameEl.textContent = me.username;
    const initEl = document.getElementById("user-initials");
    if (initEl) initEl.textContent = me.username.substring(0, 2).toUpperCase();

    const hdrName = document.getElementById("header-user-name");
    if (hdrName) hdrName.textContent = me.username;
    const hdrInit = document.getElementById("header-user-initials");
    if (hdrInit) hdrInit.textContent = me.username.substring(0, 2).toUpperCase();

    hideAuthModal();

    // Populate settings form with user defaults
    if (me.settings) {
      if (me.settings.default_hf_token) {
        const setHf = document.getElementById("settings-hf-token");
        const cfgHf = document.getElementById("config-hf-token");
        if (setHf) setHf.value = me.settings.default_hf_token;
        if (cfgHf) cfgHf.value = me.settings.default_hf_token;
      }
      if (me.settings.default_model) {
        const setMod = document.getElementById("settings-default-model");
        if (setMod) setMod.value = me.settings.default_model;
      }
    }

    try { await loadSystemInfo(); } catch (e) { console.warn("System info load error:", e); }
    try { await loadJobs(); } catch (e) { console.warn("Jobs load error:", e); }
    try { await loadAllClips(); } catch (e) { console.warn("Clips load error:", e); }
    try { await loadDashboardRecentClips(); } catch (e) { console.warn("Recent clips error:", e); }

    // Start 3D WebGL background
    init3DBackground();

    // Start 2.5s polling loop for live progress updates
    if (state.pollInterval) clearInterval(state.pollInterval);
    state.pollInterval = setInterval(() => {
      if (state.activeView === "dashboard") {
        loadJobs();
      } else if (state.activeView === "editor" && state.currentJob) {
        if (state.currentJob.status === "pending" || state.currentJob.status === "running") {
          loadEditorJob(state.currentJob.id);
        }
      }
    }, 2500);

  } catch (err) {
    console.error("Non-fatal app init error:", err);
  }
}

// Keyboard shortcuts (Space = Play/Pause)
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
    e.preventDefault();
    if (state.activeView === "clipper") {
      toggleClipperPlay();
    } else {
      toggleAudioPlay();
    }
  } else if (state.activeView === "clipper" && e.target.tagName !== "INPUT") {
    if (e.key === "i" || e.key === "I") {
      setClipperInCurrent();
    } else if (e.key === "o" || e.key === "O") {
      setClipperOutCurrent();
    } else if (e.key === "l" || e.key === "L") {
      toggleClipperLoop();
    }
  }
});

// Boot application on load
window.addEventListener("DOMContentLoaded", () => {
  init3DBackground();
  initializeApp();
});


// =========================================================================
// 3D WebGL Background Engine (Three.js)
// =========================================================================
let threeScene = null, threeCamera = null, threeRenderer = null;
let threeParticleMesh = null, threeWirePlane = null;
let threeMouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
let isThreeInitialized = false;

function init3DBackground() {
  if (isThreeInitialized || typeof THREE === "undefined") return;
  const canvas = document.getElementById("bg-canvas-3d");
  if (!canvas) return;

  try {
    const width = window.innerWidth;
    const height = window.innerHeight;

    threeScene = new THREE.Scene();
    threeCamera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    threeCamera.position.z = 80;

    threeRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    threeRenderer.setSize(width, height);
    threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Particle constellation
    const particleCount = 380;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 180;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 110;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 90;

      // Electric Indigo, Cyber Cyan, and Neon Rose
      const rRatio = Math.random();
      if (rRatio < 0.4) {
        colors[i * 3] = 0.39; colors[i * 3 + 1] = 0.40; colors[i * 3 + 2] = 0.95;
      } else if (rRatio < 0.75) {
        colors[i * 3] = 0.02; colors[i * 3 + 1] = 0.71; colors[i * 3 + 2] = 0.83;
      } else {
        colors[i * 3] = 0.93; colors[i * 3 + 1] = 0.28; colors[i * 3 + 2] = 0.60;
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const pMaterial = new THREE.PointsMaterial({
      size: 2.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });

    threeParticleMesh = new THREE.Points(geometry, pMaterial);
    threeScene.add(threeParticleMesh);

    // Undulating 3D wave plane
    const planeGeo = new THREE.PlaneGeometry(180, 110, 36, 26);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x6366f1,
      wireframe: true,
      transparent: true,
      opacity: 0.14,
    });
    threeWirePlane = new THREE.Mesh(planeGeo, planeMat);
    threeWirePlane.rotation.x = -Math.PI / 2.3;
    threeWirePlane.position.y = -35;
    threeWirePlane.position.z = -10;
    threeScene.add(threeWirePlane);

    // Mouse parallax
    window.addEventListener("mousemove", (e) => {
      threeMouse.targetX = (e.clientX / window.innerWidth - 0.5) * 2;
      threeMouse.targetY = -(e.clientY / window.innerHeight - 0.5) * 2;
    });

    window.addEventListener("resize", () => {
      if (!threeCamera || !threeRenderer) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      threeCamera.aspect = w / h;
      threeCamera.updateProjectionMatrix();
      threeRenderer.setSize(w, h);
    });

    const clock = new THREE.Clock();
    function renderFrame() {
      requestAnimationFrame(renderFrame);
      const elapsed = clock.getElapsedTime();

      threeMouse.x += (threeMouse.targetX - threeMouse.x) * 0.05;
      threeMouse.y += (threeMouse.targetY - threeMouse.y) * 0.05;

      if (threeParticleMesh) {
        threeParticleMesh.rotation.y = elapsed * 0.035 + threeMouse.x * 0.25;
        threeParticleMesh.rotation.x = Math.sin(elapsed * 0.03) * 0.08 + threeMouse.y * 0.15;
      }

      if (threeWirePlane) {
        threeWirePlane.rotation.z = Math.sin(elapsed * 0.04) * 0.03;
        const pos = threeWirePlane.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const u = pos.getX(i);
          const v = pos.getY(i);
          const z = Math.sin(u * 0.07 + elapsed * 1.6) * 3.5 + Math.cos(v * 0.07 + elapsed * 1.2) * 2.5;
          pos.setZ(i, z);
        }
        pos.needsUpdate = true;
      }

      threeRenderer.render(threeScene, threeCamera);
    }
    renderFrame();
    isThreeInitialized = true;
  } catch (err) {
    console.warn("Three.js initialization notice:", err);
  }
}


// =========================================================================
// 3D Smart Media Clipper Studio Engine
// =========================================================================
let clipperState = {
  sourceMode: "upload", // 'upload' | 'job'
  file: null,
  job: null,
  mediaUrl: null,
  isVideo: true,
  duration: 0.0,
  inTime: 0.0,
  outTime: 0.0,
  currentTime: 0.0,
  isPlaying: false,
  loop: false,
  mode: "exact",
  fileSize: 0,
  isDragging: null, // 'in' | 'out' | null
  lastRenderedClip: null,
  isTimelineBound: false,
};

function formatTimecode(seconds) {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function initClipperStudio(params = {}) {
  // Bind timeline scrubbing events once
  if (!clipperState.isTimelineBound) {
    bindClipperTimelineEvents();
    clipperState.isTimelineBound = true;
  }

  // Populate completed jobs in the job select dropdown
  populateClipperJobsDropdown();

  // If params specifies a job or timestamps, handle immediately
  if (params.jobId) {
    switchClipperSource("job");
    const select = document.getElementById("clipper-job-select");
    if (select) select.value = params.jobId;
    handleClipperJobChosen(params.jobId, params.start, params.end);
  } else if (!clipperState.mediaUrl && state.jobs && state.jobs.length > 0) {
    // If nothing loaded yet, default to first completed job if available
    const compJob = state.jobs.find(j => j.status === "completed");
    if (compJob && clipperState.sourceMode === "job") {
      const select = document.getElementById("clipper-job-select");
      if (select) select.value = compJob.id;
      handleClipperJobChosen(compJob.id);
    }
  }
}

function populateClipperJobsDropdown() {
  const select = document.getElementById("clipper-job-select");
  if (!select) return;

  const completed = (state.jobs || []).filter(j => j.status === "completed");
  if (completed.length === 0) {
    select.innerHTML = '<option value="">No completed jobs yet. Run a transcription first or use Direct Upload!</option>';
    return;
  }

  select.innerHTML = '<option value="">-- Choose a completed transcription job --</option>' +
    completed.map(j => `<option value="${j.id}">${j.title} (${(j.audio_duration || 0).toFixed(1)}s)</option>`).join("");
}

function switchClipperSource(mode) {
  clipperState.sourceMode = mode;
  const btnUpload = document.getElementById("btn-clipper-src-upload");
  const btnJob = document.getElementById("btn-clipper-src-job");
  const uploadContainer = document.getElementById("clipper-upload-container");
  const jobContainer = document.getElementById("clipper-job-container");

  const activeClass = "py-1.5 px-3.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-rose-600 to-indigo-600 text-white shadow-sm transition-all flex items-center gap-1.5";
  const inactiveClass = "py-1.5 px-3.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition-all flex items-center gap-1.5";

  if (mode === "upload") {
    btnUpload.className = activeClass;
    btnJob.className = inactiveClass;
    uploadContainer.classList.remove("hidden");
    jobContainer.classList.add("hidden");
  } else {
    btnJob.className = activeClass;
    btnUpload.className = inactiveClass;
    jobContainer.classList.remove("hidden");
    uploadContainer.classList.add("hidden");
    populateClipperJobsDropdown();
  }
}

function handleClipperFileChosen(e) {
  const file = e.target.files[0];
  if (!file) return;

  clipperState.file = file;
  clipperState.job = null;
  const isVideo = file.type.startsWith("video") || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
  const objectUrl = URL.createObjectURL(file);

  document.getElementById("clipper-file-label").textContent = `${file.name} (${formatBytes(file.size)})`;
  document.getElementById("clipper-title-input").value = file.name.replace(/\.[^/.]+$/, "") + " (Clip)";

  loadMediaIntoClipper(objectUrl, isVideo, file.name, 0, file.size, null);
}

function handleClipperJobChosen(jobId, presetStart = null, presetEnd = null) {
  if (!jobId) return;
  const job = (state.jobs || []).find(j => j.id === jobId);
  if (!job) return;

  clipperState.job = job;
  clipperState.file = null;
  const isVideo = /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(job.original_filename);
  const streamUrl = `/api/jobs/${job.id}/stream?token=${state.token}`;

  document.getElementById("clipper-title-input").value = `${job.title} [Clip]`;

  loadMediaIntoClipper(streamUrl, isVideo, job.title, job.audio_duration || 0, job.file_size || 0, job, presetStart, presetEnd);
}

function loadMediaIntoClipper(url, isVideo, title, knownDuration, fileSize, jobData = null, presetStart = null, presetEnd = null) {
  clipperState.mediaUrl = url;
  clipperState.isVideo = isVideo;
  clipperState.fileSize = fileSize;

  const vid = document.getElementById("clipper-video");
  const aud = document.getElementById("clipper-audio");
  const overlay = document.getElementById("clipper-empty-overlay");
  const audioHud = document.getElementById("clipper-audio-hud");
  const titleEl = document.getElementById("clipper-media-title");
  const formatBadge = document.getElementById("clipper-media-format-badge");

  if (titleEl) titleEl.textContent = title;
  if (formatBadge) formatBadge.textContent = isVideo ? "VIDEO" : "AUDIO";

  if (overlay) overlay.classList.add("hidden");

  // Reset docks
  document.getElementById("clipper-export-dock").classList.add("hidden");

  const player = isVideo ? vid : aud;
  if (isVideo) {
    vid.classList.remove("hidden");
    aud.classList.add("hidden");
    if (audioHud) audioHud.classList.add("hidden");
  } else {
    vid.classList.add("hidden");
    aud.classList.remove("hidden");
    if (audioHud) audioHud.classList.remove("hidden");
  }

  player.src = url;
  player.load();

  player.onloadedmetadata = () => {
    clipperState.duration = player.duration && !isNaN(player.duration) ? player.duration : (knownDuration || 10.0);
    clipperState.inTime = presetStart !== null ? parseFloat(presetStart) : 0.0;
    clipperState.outTime = presetEnd !== null ? parseFloat(presetEnd) : clipperState.duration;

    player.currentTime = clipperState.inTime;
    clipperState.currentTime = clipperState.inTime;

    updateClipperTimelineUI();
    drawTimelineWaveform();
  };

  player.ontimeupdate = () => {
    clipperState.currentTime = player.currentTime;
    updateClipperTimelinePlayhead();

    // Loop logic
    if (clipperState.loop && player.currentTime >= clipperState.outTime) {
      player.currentTime = clipperState.inTime;
      player.play();
    } else if (!clipperState.loop && player.currentTime >= clipperState.outTime && !player.paused) {
      player.pause();
      clipperState.isPlaying = false;
      updatePlayButtonUI();
    }
  };

  player.onplay = () => {
    clipperState.isPlaying = true;
    updatePlayButtonUI();
  };

  player.onpause = () => {
    clipperState.isPlaying = false;
    updatePlayButtonUI();
  };

  player.onended = () => {
    clipperState.isPlaying = false;
    updatePlayButtonUI();
  };
}

function getActiveClipperPlayer() {
  return clipperState.isVideo ? document.getElementById("clipper-video") : document.getElementById("clipper-audio");
}

function updatePlayButtonUI() {
  const btn = document.getElementById("btn-clipper-play");
  if (!btn) return;
  if (clipperState.isPlaying) {
    btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    btn.classList.add("ring-2", "ring-rose-400");
  } else {
    btn.innerHTML = '<i class="fa-solid fa-play"></i>';
    btn.classList.remove("ring-2", "ring-rose-400");
  }
}

function toggleClipperPlay() {
  const p = getActiveClipperPlayer();
  if (!p || !p.src) return;

  if (p.paused) {
    if (p.currentTime >= clipperState.outTime || p.currentTime < clipperState.inTime) {
      p.currentTime = clipperState.inTime;
    }
    p.play();
  } else {
    p.pause();
  }
}

function jogClipper(deltaSeconds) {
  const p = getActiveClipperPlayer();
  if (!p) return;
  p.currentTime = Math.max(0, Math.min(clipperState.duration, p.currentTime + deltaSeconds));
}

function stepClipperFrame(frameDelta) {
  const p = getActiveClipperPlayer();
  if (!p) return;
  p.pause();
  const frameTime = 1.0 / 30.0;
  p.currentTime = Math.max(0, Math.min(clipperState.duration, p.currentTime + frameDelta * frameTime));
}

function setClipperInCurrent() {
  const p = getActiveClipperPlayer();
  if (!p) return;
  const cur = p.currentTime;
  if (cur >= clipperState.outTime) {
    showToast("Start (IN) cannot exceed or equal End (OUT).", "error");
    return;
  }
  clipperState.inTime = Math.max(0, cur);
  updateClipperTimelineUI();
  showToast(`Start point set to ${formatTimecode(clipperState.inTime)}`, "info");
}

function setClipperOutCurrent() {
  const p = getActiveClipperPlayer();
  if (!p) return;
  const cur = p.currentTime;
  if (cur <= clipperState.inTime) {
    showToast("End (OUT) must be greater than Start (IN).", "error");
    return;
  }
  clipperState.outTime = Math.min(clipperState.duration, cur);
  updateClipperTimelineUI();
  showToast(`End point set to ${formatTimecode(clipperState.outTime)}`, "info");
}

function toggleClipperLoop() {
  clipperState.loop = !clipperState.loop;
  const btn = document.getElementById("btn-clipper-loop");
  if (btn) {
    if (clipperState.loop) {
      btn.className = "p-2 rounded-lg bg-indigo-600 text-white text-xs transition-all shadow-md";
      showToast("Loop Clip mode activated.", "info");
    } else {
      btn.className = "p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-all";
    }
  }
}

function resetClipperFullRange() {
  clipperState.inTime = 0.0;
  clipperState.outTime = clipperState.duration;
  updateClipperTimelineUI();
}

function handleClipperModeChange(mode) {
  clipperState.mode = mode;
  updateClipperSizeEstimate();
}

function updateClipperTimelineUI() {
  const dur = clipperState.duration || 1.0;
  const inPct = Math.max(0, Math.min(100, (clipperState.inTime / dur) * 100));
  const outPct = Math.max(0, Math.min(100, (clipperState.outTime / dur) * 100));
  const widthPct = Math.max(0, outPct - inPct);

  // Markers & Region
  const mIn = document.getElementById("clipper-marker-in");
  const mOut = document.getElementById("clipper-marker-out");
  const reg = document.getElementById("clipper-region");

  if (mIn) mIn.style.left = `${inPct}%`;
  if (mOut) mOut.style.left = `${outPct}%`;
  if (reg) {
    reg.style.left = `${inPct}%`;
    reg.style.width = `${widthPct}%`;
  }

  // Timecode texts
  const inEl = document.getElementById("clipper-in-display");
  const outEl = document.getElementById("clipper-out-display");
  const durEl = document.getElementById("clipper-dur-display");
  const durPctEl = document.getElementById("clipper-dur-percent");

  if (inEl) inEl.textContent = formatTimecode(clipperState.inTime);
  if (outEl) outEl.textContent = formatTimecode(clipperState.outTime);

  const clipDuration = Math.max(0, clipperState.outTime - clipperState.inTime);
  if (durEl) durEl.textContent = `${clipDuration.toFixed(2)}s`;
  if (durPctEl) {
    const p = dur > 0 ? ((clipDuration / dur) * 100).toFixed(1) : "100";
    durPctEl.textContent = `${p}% of media`;
  }

  updateClipperSizeEstimate();
}

function updateClipperTimelinePlayhead() {
  const dur = clipperState.duration || 1.0;
  const curPct = Math.max(0, Math.min(100, (clipperState.currentTime / dur) * 100));
  const playhead = document.getElementById("clipper-playhead");
  const curEl = document.getElementById("clipper-cur-display");

  if (playhead) playhead.style.left = `${curPct}%`;
  if (curEl) curEl.textContent = formatTimecode(clipperState.currentTime);
}

function bindClipperTimelineEvents() {
  const track = document.getElementById("clipper-timeline-track");
  const mIn = document.getElementById("clipper-marker-in");
  const mOut = document.getElementById("clipper-marker-out");

  if (!track || !mIn || !mOut) return;

  function getTimeFromEvent(e) {
    const rect = track.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * (clipperState.duration || 1.0);
  }

  mIn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    clipperState.isDragging = "in";
    mIn.setPointerCapture(e.pointerId);
  });

  mOut.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    clipperState.isDragging = "out";
    mOut.setPointerCapture(e.pointerId);
  });

  window.addEventListener("pointermove", (e) => {
    if (!clipperState.isDragging) return;
    const time = getTimeFromEvent(e);

    if (clipperState.isDragging === "in") {
      clipperState.inTime = Math.max(0, Math.min(clipperState.outTime - 0.2, time));
    } else if (clipperState.isDragging === "out") {
      clipperState.outTime = Math.min(clipperState.duration, Math.max(clipperState.inTime + 0.2, time));
    }
    updateClipperTimelineUI();
  });

  window.addEventListener("pointerup", () => {
    clipperState.isDragging = null;
  });
}

function handleTimelineTrackClick(e) {
  if (clipperState.isDragging) return;
  const track = document.getElementById("clipper-timeline-track");
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const targetTime = ratio * (clipperState.duration || 1.0);

  const p = getActiveClipperPlayer();
  if (p) p.currentTime = targetTime;
}

function drawTimelineWaveform() {
  const canvas = document.getElementById("clipper-waveform-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const w = (canvas.width = canvas.offsetWidth || 600);
  const h = (canvas.height = canvas.offsetHeight || 56);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(139, 92, 246, 0.4)";

  // Draw procedural waveform bars
  const bars = Math.floor(w / 4);
  const barWidth = 2.5;
  const mid = h / 2;

  for (let i = 0; i < bars; i++) {
    const x = i * 4;
    // Pseudo-random organic speech envelope
    const noise = Math.sin(i * 0.15) * Math.cos(i * 0.05);
    const heightFactor = Math.abs(noise * 0.7 + (Math.sin(i * 0.4) * 0.3));
    const barHeight = Math.max(4, heightFactor * (h - 10));

    ctx.fillRect(x, mid - barHeight / 2, barWidth, barHeight);
  }
}

function updateClipperSizeEstimate() {
  const dur = clipperState.duration || 1.0;
  const clipDur = Math.max(0.1, clipperState.outTime - clipperState.inTime);
  const ratio = clipDur / dur;

  const srcSizeEl = document.getElementById("clipper-source-size-text");
  const estSizeEl = document.getElementById("clipper-est-size-text");
  const badge = document.getElementById("clipper-reduction-badge");

  const srcBytes = clipperState.fileSize || 10485760; // fallback 10MB
  if (srcSizeEl) srcSizeEl.textContent = formatBytes(srcBytes);

  let estBytes = srcBytes * ratio;
  // If exact CRF re-encode, apply CRF factor
  if (clipperState.mode === "exact") {
    estBytes = estBytes * 0.85; // optimized x264 CRF 18
  }

  if (estSizeEl) estSizeEl.textContent = `~${formatBytes(estBytes)}`;

  const savedPercent = Math.max(0, Math.round((1 - (estBytes / srcBytes)) * 100));
  if (badge) {
    badge.textContent = `⚡ -${savedPercent}% Size Reduced`;
  }
}

async function executeRenderClip() {
  if (!clipperState.mediaUrl) {
    showToast("Please load a media file or select a completed job first.", "error");
    return;
  }

  const btn = document.getElementById("btn-render-clip");
  const indicator = document.getElementById("clipper-render-indicator");
  const msgEl = document.getElementById("clipper-render-msg");

  btn.disabled = true;
  indicator.classList.remove("hidden");
  msgEl.textContent = "Processing frame-accurate cut with FFmpeg...";

  const titleInput = document.getElementById("clipper-title-input").value.trim();
  const title = titleInput || "Custom Media Clip";
  const targetFormat = document.getElementById("clipper-target-format").value || null;
  const burnSubtitles = document.getElementById("clipper-burn-subtitles").checked;
  const mode = document.querySelector('input[name="clipper-engine-mode"]:checked')?.value || "exact";

  try {
    let res;
    if (clipperState.sourceMode === "upload" && clipperState.file) {
      // Standalone upload clipping endpoint
      const formData = new FormData();
      formData.append("file", clipperState.file);
      formData.append("start_time", clipperState.inTime);
      formData.append("end_time", clipperState.outTime);
      formData.append("title", title);
      formData.append("mode", mode);
      formData.append("burn_subtitles", burnSubtitles ? "true" : "false");
      if (targetFormat) formData.append("target_format", targetFormat);

      res = await apiRequest("/api/media/clip", {
        method: "POST",
        body: formData,
      });
    } else if (clipperState.job) {
      // Job-linked clipping endpoint
      res = await apiRequest(`/api/jobs/${clipperState.job.id}/clip`, {
        method: "POST",
        body: {
          start_time: clipperState.inTime,
          end_time: clipperState.outTime,
          title: title,
          mode: mode,
          burn_subtitles: burnSubtitles,
          target_format: targetFormat,
        },
      });
    } else {
      throw new Error("No media source attached to render.");
    }

    clipperState.lastRenderedClip = res;
    showToast("Clip rendered and exported successfully!", "success");

    // Display in Export Dock
    const dock = document.getElementById("clipper-export-dock");
    dock.classList.remove("hidden");

    document.getElementById("dock-clip-title").textContent = res.title || "Exported Clip";
    document.getElementById("dock-clip-meta").textContent =
      `${res.duration.toFixed(1)}s • ${formatBytes(res.file_size)} • ${res.mode === "fast" ? "Fast Stream Copy" : "Smart Frame-Accurate"}`;

    const streamUrl = `${res.stream_url}?token=${state.token}`;
    const previewVideo = document.getElementById("dock-preview-video");
    previewVideo.src = streamUrl;
    previewVideo.load();

    const btnDownload = document.getElementById("dock-btn-download");
    btnDownload.href = `${res.download_url}?token=${state.token}`;
    btnDownload.download = res.filename;

    const btnSub = document.getElementById("dock-btn-subtitles");
    if (res.sliced_transcript && res.sliced_transcript.segments && res.sliced_transcript.segments.length > 0) {
      btnSub.href = `/api/clips/${res.clip_id}/subtitles/srt?token=${state.token}`;
      btnSub.classList.remove("hidden");
    } else {
      btnSub.classList.add("hidden");
    }

    // Smooth scroll down to export dock
    dock.scrollIntoView({ behavior: "smooth" });

    // Refresh clips count & library
    loadAllClips();

  } catch (err) {
    showToast("Clipping failed: " + err.message, "error");
  } finally {
    btn.disabled = false;
    indicator.classList.add("hidden");
  }
}

function copyDockStreamUrl() {
  if (!clipperState.lastRenderedClip) return;
  const fullUrl = `${window.location.origin}${clipperState.lastRenderedClip.stream_url}?token=${state.token}`;
  navigator.clipboard.writeText(fullUrl).then(() => {
    showToast("Clip streaming URL copied to clipboard!", "success");
  });
}

function openJobInClipperStudio(jobId = null, start = null, end = null) {
  const targetJobId = jobId || (state.currentJob ? state.currentJob.id : null);
  if (!targetJobId) {
    showToast("Please select a job first.", "error");
    return;
  }
  navigate("clipper", { jobId: targetJobId, start, end });
}

function openSegmentInClipperStudio(sIdx) {
  if (!currentSegments || !currentSegments[sIdx] || !state.currentJob) return;
  const seg = currentSegments[sIdx];
  navigate("clipper", { jobId: state.currentJob.id, start: seg.start, end: seg.end });
}


// =========================================================================
// Clips Library Engine
// =========================================================================
let allClipsCache = [];
let clipsLibraryFilter = "all";

async function loadAllClips() {
  try {
    const clips = await apiRequest("/api/clips");
    allClipsCache = clips || [];

    // Update nav counter badges
    const navBadge = document.getElementById("nav-clips-badge");
    const headerBadge = document.getElementById("clipper-header-clips-count");
    const metricClips = document.getElementById("metric-total-clips");
    const countText = document.getElementById("clips-library-count-text");

    if (navBadge) navBadge.textContent = allClipsCache.length;
    if (headerBadge) headerBadge.textContent = allClipsCache.length;
    if (metricClips) metricClips.textContent = allClipsCache.length;
    if (countText) countText.textContent = `${allClipsCache.length} media clips available`;

    renderClipsLibrary();
  } catch (err) {
    console.warn("Could not load clips library:", err);
  }
}

function filterClipsLibrary(type) {
  clipsLibraryFilter = type;
  ["all", "video", "audio"].forEach(t => {
    const btn = document.getElementById(`filter-clip-${t}`);
    if (btn) {
      if (t === type) {
        btn.className = "py-1.5 px-3 rounded-lg bg-indigo-600 text-white font-medium";
      } else {
        btn.className = "py-1.5 px-3 rounded-lg text-slate-400 hover:text-white font-medium";
      }
    }
  });
  renderClipsLibrary();
}

function renderClipsLibrary() {
  const grid = document.getElementById("clips-library-grid");
  if (!grid) return;

  let filtered = allClipsCache;
  if (clipsLibraryFilter === "video") {
    filtered = allClipsCache.filter(c => /\.(mp4|webm|mov|mkv)$/i.test(c.filename));
  } else if (clipsLibraryFilter === "audio") {
    filtered = allClipsCache.filter(c => /\.(mp3|wav|aac|m4a|ogg|flac)$/i.test(c.filename));
  }

  if (typeof currentClipsSearchQuery !== "undefined" && currentClipsSearchQuery) {
    filtered = filtered.filter(c => {
      const title = (c.title || "").toLowerCase();
      const fn = (c.filename || "").toLowerCase();
      return title.includes(currentClipsSearchQuery) || fn.includes(currentClipsSearchQuery);
    });
  }

  const countText = document.getElementById("clips-library-count-text");
  if (countText) countText.textContent = `${filtered.length} media clips found`;

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-16 text-center text-slate-500 glass-panel">
        <i class="fa-solid fa-scissors text-3xl mb-3 block text-slate-600"></i>
        <p class="text-sm font-medium text-slate-400">No ${clipsLibraryFilter !== "all" ? clipsLibraryFilter : ""} clips match your filter.</p>
        <p class="text-xs text-slate-500 mt-1">Open the <button onclick="navigate('clipper')" class="text-rose-400 underline font-semibold">3D Clipper Studio</button> to create your first clip.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(c => {
    const isVideo = /\.(mp4|webm|mov|mkv)$/i.test(c.filename);
    const streamUrl = `${c.stream_url}?token=${state.token}`;
    const downloadUrl = `${c.download_url}?token=${state.token}`;

    const modeBadge = c.mode === "fast" ?
      '<span class="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[9px] border border-cyan-500/30">⚡ 0ms Copy</span>' :
      '<span class="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono text-[9px] border border-rose-500/30">🎯 Exact Cut</span>';

    const burnBadge = c.burned_subtitles ?
      '<span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[9px] border border-amber-500/30">Burnt Subs</span>' : '';

    return `
      <div class="glass-panel p-4 flex flex-col justify-between gap-3 group hover:border-slate-600 transition-all">
        <div class="space-y-2">
          <!-- Inline Player -->
          <div class="rounded-xl overflow-hidden bg-black/80 aspect-video flex items-center justify-center relative">
            ${isVideo ? `
              <video src="${streamUrl}" controls class="w-full h-full object-contain" preload="none"></video>
            ` : `
              <div class="flex flex-col items-center justify-center gap-2 p-4 w-full h-full">
                <i class="fa-solid fa-music text-3xl text-indigo-400"></i>
                <audio src="${streamUrl}" controls class="w-full max-w-xs mt-2" preload="none"></audio>
              </div>
            `}
          </div>

          <!-- Metadata -->
          <div>
            <h4 class="text-xs font-bold text-white truncate" title="${c.title}">${c.title}</h4>
            <div class="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-1">
              <span>${c.duration.toFixed(1)}s</span>
              <span>•</span>
              <span>${formatBytes(c.file_size)}</span>
              <span>•</span>
              <span>${c.filename.split('.').pop().toUpperCase()}</span>
            </div>
            <div class="flex items-center gap-1.5 mt-2 flex-wrap">
              ${modeBadge}
              ${burnBadge}
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center justify-between border-t border-slate-800/80 pt-3 gap-2">
          <a href="${downloadUrl}" download="${c.filename}" class="flex-1 py-1.5 px-3 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white text-xs font-semibold text-center flex items-center justify-center gap-1.5 transition-colors">
            <i class="fa-solid fa-download text-[10px]"></i>
            <span>Download</span>
          </a>
          ${c.has_sliced_transcript ? `
          <a href="/api/clips/${c.id}/subtitles/srt?token=${state.token}" download class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-brand-400 text-xs" title="Download Subtitles (.srt)">
            <i class="fa-regular fa-closed-captioning"></i>
          </a>` : ''}
          <button type="button" onclick="deleteClipFromLibrary('${c.id}')" class="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900 text-rose-400 text-xs transition-colors" title="Delete Clip">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

async function deleteClipFromLibrary(clipId) {
  if (!confirm("Are you sure you want to permanently delete this media clip?")) return;
  try {
    await apiRequest(`/api/clips/${clipId}`, { method: "DELETE" });
    showToast("Clip deleted successfully.", "success");
    loadAllClips();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function loadDashboardRecentClips() {
  const container = document.getElementById("dashboard-recent-clips");
  if (!container) return;

  try {
    const clips = await apiRequest("/api/clips");
    if (!clips || clips.length === 0) {
      container.innerHTML = `<p class="text-xs text-slate-500 col-span-full py-4 text-center">No clips generated yet. Open the <button onclick="navigate('clipper')" class="text-rose-400 underline font-semibold">3D Clipper Studio</button> to create your first clip!</p>`;
      return;
    }

    const recent = clips.slice(0, 3);
    container.innerHTML = recent.map(c => {
      const isVideo = /\.(mp4|webm|mov|mkv)$/i.test(c.filename);
      const icon = isVideo ? '<i class="fa-solid fa-video text-rose-400"></i>' : '<i class="fa-solid fa-music text-cyan-400"></i>';
      return `
        <div class="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5 overflow-hidden">
            <div class="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center flex-shrink-0 text-xs">
              ${icon}
            </div>
            <div class="truncate">
              <span class="text-xs font-semibold text-white block truncate">${c.title}</span>
              <span class="text-[10px] text-slate-400 font-mono">${c.duration.toFixed(1)}s • ${formatBytes(c.file_size)}</span>
            </div>
          </div>
          <a href="${c.download_url}?token=${state.token}" download="${c.filename}" class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex-shrink-0" title="Download">
            <i class="fa-solid fa-download"></i>
          </a>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.warn("Could not load dashboard clips:", err);
  }
}

// ------------------ Profile Modal & Account Management ------------------
function populateProfileModalData() {
  if (!state.user) return;
  const u = state.user;
  const usernameEl = document.getElementById("profile-modal-username");
  if (usernameEl) usernameEl.textContent = u.username;
  const emailEl = document.getElementById("profile-modal-email");
  if (emailEl) emailEl.textContent = u.email || "local@studio";
  const idEl = document.getElementById("profile-modal-id");
  if (idEl) idEl.textContent = u.id || "1";
  const initialsEl = document.getElementById("profile-avatar-initials");
  if (initialsEl) initialsEl.textContent = (u.username || "U").substring(0, 2).toUpperCase();
  const tokenDisplay = document.getElementById("profile-token-display");
  if (tokenDisplay) tokenDisplay.value = state.token || "";
  const curlExample = document.getElementById("profile-curl-example");
  if (curlExample) {
    curlExample.textContent = `curl -H "Authorization: Bearer ${state.token || '<YOUR_TOKEN>'}" http://localhost:8080/api/jobs`;
  }

  // Populate preferences tab
  if (u.settings) {
    const hf = document.getElementById("profile-hf-token");
    if (hf) hf.value = u.settings.default_hf_token || "";
    const mod = document.getElementById("profile-pref-model");
    if (mod && u.settings.default_model) mod.value = u.settings.default_model;
    const cmp = document.getElementById("profile-pref-compute");
    if (cmp && u.settings.default_compute_type) cmp.value = u.settings.default_compute_type;
  }
}

function openProfileModal() {
  populateProfileModalData();
  const modal = document.getElementById("profile-modal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.style.setProperty("display", "flex", "important");
  }
}

function closeProfileModal() {
  const modal = document.getElementById("profile-modal");
  if (modal) {
    modal.classList.add("hidden");
    modal.style.setProperty("display", "none", "important");
  }
}

function switchProfileTab(tabName) {
  const tabs = ["api", "security", "prefs"];
  tabs.forEach(t => {
    const btn = document.getElementById(`tab-profile-${t}`);
    const pane = document.getElementById(`profile-pane-${t}`);
    if (t === tabName) {
      if (btn) {
        btn.classList.add("border-brand-500", "text-brand-400");
        btn.classList.remove("border-transparent", "text-slate-400");
      }
      if (pane) {
        pane.classList.remove("hidden");
        pane.style.setProperty("display", "block", "important");
      }
    } else {
      if (btn) {
        btn.classList.remove("border-brand-500", "text-brand-400");
        btn.classList.add("border-transparent", "text-slate-400");
      }
      if (pane) {
        pane.classList.add("hidden");
        pane.style.setProperty("display", "none", "important");
      }
    }
  });
}

function toggleTokenMask() {
  const input = document.getElementById("profile-token-display");
  const btn = document.getElementById("btn-toggle-token-mask");
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    if (btn) btn.innerHTML = '<i class="fa-solid fa-eye-slash mr-1"></i> Hide';
  } else {
    input.type = "password";
    if (btn) btn.innerHTML = '<i class="fa-solid fa-eye mr-1"></i> Show';
  }
}

async function copyUserToken() {
  if (!state.token) {
    showToast("No active token to copy.", "error");
    return;
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(state.token);
    } else {
      const input = document.getElementById("profile-token-display");
      if (input) {
        input.type = "text";
        input.select();
        document.execCommand("copy");
        input.type = "password";
      }
    }
    const btn = document.getElementById("btn-copy-token");
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-check text-emerald-400"></i> <span>Copied!</span>';
      setTimeout(() => btn.innerHTML = orig, 2000);
    }
    showToast("API Access Token copied to clipboard!", "success");
  } catch (err) {
    showToast("Failed to copy token: " + err.message, "error");
  }
}

async function handleProfileChangePassword(e) {
  e.preventDefault();
  const curPwd = document.getElementById("profile-cur-pwd").value;
  const newPwd = document.getElementById("profile-new-pwd").value;
  const confirmPwd = document.getElementById("profile-confirm-pwd").value;
  const btn = document.getElementById("btn-profile-change-pwd");

  if (newPwd.length < 4) {
    showToast("New password must be at least 4 characters.", "error");
    return;
  }
  if (newPwd !== confirmPwd) {
    showToast("New passwords do not match.", "error");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Updating...</span>';

  try {
    await apiRequest("/api/auth/change-password", {
      method: "POST",
      body: { current_password: curPwd, new_password: newPwd }
    });
    showToast("Password updated successfully!", "success");
    document.getElementById("profile-cur-pwd").value = "";
    document.getElementById("profile-new-pwd").value = "";
    document.getElementById("profile-confirm-pwd").value = "";
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-key"></i> <span>Update Password</span>';
  }
}

async function handleProfileSavePreferences(e) {
  e.preventDefault();
  const hfToken = document.getElementById("profile-hf-token").value.trim();
  const model = document.getElementById("profile-pref-model").value;
  const compute = document.getElementById("profile-pref-compute").value;
  const btn = document.getElementById("btn-profile-save-prefs");

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Saving...</span>';

  try {
    await apiRequest("/api/auth/settings", {
      method: "PUT",
      body: {
        default_hf_token: hfToken,
        default_model: model,
        default_compute_type: compute
      }
    });
    if (state.user) {
      if (!state.user.settings) state.user.settings = {};
      state.user.settings.default_hf_token = hfToken;
      state.user.settings.default_model = model;
      state.user.settings.default_compute_type = compute;
    }
    // Also sync to form controls
    const cfgHf = document.getElementById("config-hf-token");
    if (cfgHf) cfgHf.value = hfToken;
    const cfgMod = document.getElementById("config-model");
    if (cfgMod) cfgMod.value = model;
    const cfgCmp = document.getElementById("config-compute-type");
    if (cfgCmp) cfgCmp.value = compute;
    const setHf = document.getElementById("settings-hf-token");
    if (setHf) setHf.value = hfToken;
    const setMod = document.getElementById("settings-default-model");
    if (setMod) setMod.value = model;

    showToast("Preferences saved successfully!", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span>Save Preferences</span>';
  }
}

// ------------------ Keyboard Shortcuts Modal ------------------
function openShortcutsModal() {
  const modal = document.getElementById("shortcuts-modal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.style.setProperty("display", "flex", "important");
  }
}

function closeShortcutsModal() {
  const modal = document.getElementById("shortcuts-modal");
  if (modal) {
    modal.classList.add("hidden");
    modal.style.setProperty("display", "none", "important");
  }
}

// ------------------ Model Presets ------------------
function selectModelPreset(preset) {
  const modelEl = document.getElementById("config-model");
  const computeEl = document.getElementById("config-compute-type");
  const cards = ["fast", "balanced", "accurate"];

  cards.forEach(c => {
    const card = document.getElementById(`preset-card-${c}`);
    if (card) {
      if (c === preset) {
        card.className = "p-3.5 rounded-xl border border-brand-500/60 bg-brand-500/10 text-left transition-all group";
      } else {
        card.className = "p-3.5 rounded-xl border border-slate-800 hover:border-brand-500/50 bg-slate-950/60 hover:bg-slate-900/80 text-left transition-all group";
      }
    }
  });

  if (preset === "fast") {
    if (modelEl) modelEl.value = "tiny";
    if (computeEl) computeEl.value = "int8";
  } else if (preset === "balanced") {
    if (modelEl) modelEl.value = "base";
    if (computeEl) computeEl.value = "float16";
  } else if (preset === "accurate") {
    if (modelEl) modelEl.value = "large-v3";
    if (computeEl) computeEl.value = "float16";
  }
}

// ------------------ Clipper Micro-nudge & Preset Duration ------------------
function nudgeClipperIn(delta) {
  if (!clipperState.duration || clipperState.duration <= 0) return;
  let newIn = clipperState.inTime + delta;
  newIn = Math.max(0, Math.min(clipperState.outTime - 0.05, newIn));
  clipperState.inTime = newIn;
  updateClipperTimelineUI();
}

function nudgeClipperOut(delta) {
  if (!clipperState.duration || clipperState.duration <= 0) return;
  let newOut = clipperState.outTime + delta;
  newOut = Math.max(clipperState.inTime + 0.05, Math.min(clipperState.duration, newOut));
  clipperState.outTime = newOut;
  updateClipperTimelineUI();
}

function setClipPresetDuration(seconds) {
  if (!clipperState.duration || clipperState.duration <= 0) return;
  let newOut = clipperState.inTime + seconds;
  if (newOut > clipperState.duration) {
    newOut = clipperState.duration;
    clipperState.inTime = Math.max(0, newOut - seconds);
  }
  clipperState.outTime = newOut;
  updateClipperTimelineUI();
  showToast(`Clip range set to ${(clipperState.outTime - clipperState.inTime).toFixed(1)}s`, "info");
}

// ------------------ Clips Search ------------------
let currentClipsSearchQuery = "";
function handleClipsSearch(val) {
  currentClipsSearchQuery = (val || "").trim().toLowerCase();
  renderClipsLibrary();
}

// Global click handler to dismiss row export menus
document.addEventListener("click", () => {
  document.querySelectorAll(".row-export-menu").forEach(el => el.classList.add("hidden"));
});

// Global keyboard shortcuts
document.addEventListener("keydown", (e) => {
  const tag = (e.target && e.target.tagName) || "";
  const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable);

  if (e.key === "Escape") {
    closeProfileModal();
    closeShortcutsModal();
    return;
  }

  if (isInput) return;

  if (e.key === "?" || (e.shiftKey && e.key === "/")) {
    e.preventDefault();
    openShortcutsModal();
  } else if (e.key === "p" || e.key === "P") {
    e.preventDefault();
    openProfileModal();
  } else if (e.key === "1") {
    navigate("dashboard");
  } else if (e.key === "2") {
    navigate("new-transcription");
  } else if (e.key === "3") {
    navigate("clipper");
  } else if (e.key === "4") {
    navigate("clips");
  } else if (e.key === "5") {
    navigate("settings");
  }
});

// Expose functions globally for inline HTML event handlers
window.openProfileModal = openProfileModal;
window.closeProfileModal = closeProfileModal;
window.switchProfileTab = switchProfileTab;
window.toggleTokenMask = toggleTokenMask;
window.copyUserToken = copyUserToken;
window.handleProfileChangePassword = handleProfileChangePassword;
window.handleProfileSavePreferences = handleProfileSavePreferences;
window.openShortcutsModal = openShortcutsModal;
window.closeShortcutsModal = closeShortcutsModal;
window.setJobFilter = setJobFilter;
window.handleDashboardSearch = handleDashboardSearch;
window.clearDashboardSearch = clearDashboardSearch;
window.toggleRowExportMenu = toggleRowExportMenu;
window.directExportJob = directExportJob;
window.selectModelPreset = selectModelPreset;
window.nudgeClipperIn = nudgeClipperIn;
window.nudgeClipperOut = nudgeClipperOut;
window.setClipPresetDuration = setClipPresetDuration;
window.handleClipsSearch = handleClipsSearch;

