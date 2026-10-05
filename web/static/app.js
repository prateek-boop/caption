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
  const toast = document.createElement("div");
  const bgClass =
    type === "success" ? "bg-emerald-950 border-emerald-600 text-emerald-200" :
    type === "error" ? "bg-rose-950 border-rose-600 text-rose-200" :
    "bg-slate-900 border-slate-700 text-slate-200";

  const icon =
    type === "success" ? '<i class="fa-solid fa-circle-check text-emerald-400"></i>' :
    type === "error" ? '<i class="fa-solid fa-circle-exclamation text-rose-400"></i>' :
    '<i class="fa-solid fa-info-circle text-brand-400"></i>';

  toast.className = `p-3 rounded-xl border text-xs shadow-2xl flex items-center gap-2.5 transition-all transform duration-200 pointer-events-auto ${bgClass}`;
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
function switchAuthTab(tab) {
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const formLogin = document.getElementById("form-login");
  const formRegister = document.getElementById("form-register");

  if (tab === "login") {
    tabLogin.className = "flex-1 pb-3 text-sm font-semibold border-b-2 border-brand-500 text-brand-400 transition-colors";
    tabRegister.className = "flex-1 pb-3 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition-colors";
    formLogin.classList.remove("hidden");
    formRegister.classList.add("hidden");
  } else {
    tabRegister.className = "flex-1 pb-3 text-sm font-semibold border-b-2 border-brand-500 text-brand-400 transition-colors";
    tabLogin.className = "flex-1 pb-3 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition-colors";
    formRegister.classList.remove("hidden");
    formLogin.classList.add("hidden");
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;

  try {
    const res = await apiRequest("/api/auth/login", {
      method: "POST",
      body: { username, password }
    });
    state.token = res.access_token;
    localStorage.setItem("captioner_token", res.access_token);
    state.user = res.user;
    document.getElementById("auth-modal").classList.add("hidden");
    showToast(`Welcome back, ${res.user.username}!`, "success");
    initializeApp();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById("reg-username").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;

  try {
    const res = await apiRequest("/api/auth/register", {
      method: "POST",
      body: { username, email, password }
    });
    state.token = res.access_token;
    localStorage.setItem("captioner_token", res.access_token);
    state.user = res.user;
    document.getElementById("auth-modal").classList.add("hidden");
    showToast(`Account created! Welcome, ${res.user.username}!`, "success");
    initializeApp();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("captioner_token");
  document.getElementById("auth-modal").classList.remove("hidden");
  if (state.pollInterval) clearInterval(state.pollInterval);
}

// ------------------ Routing & Navigation ------------------
function navigate(viewName, params = {}) {
  state.activeView = viewName;

  document.querySelectorAll("main > section").forEach(sec => sec.classList.add("hidden"));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.remove("hidden");

  // Update navigation button active state
  ["dashboard", "new-transcription", "settings"].forEach(v => {
    const btn = document.getElementById(`nav-${v}`);
    if (btn) {
      if (v === viewName) {
        btn.className = "px-3.5 py-1.5 rounded-lg text-white bg-slate-800 transition-all flex items-center gap-2";
      } else {
        btn.className = "px-3.5 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/50 transition-all flex items-center gap-2";
      }
    }
  });

  if (viewName === "dashboard") {
    loadJobs();
  } else if (viewName === "editor" && params.jobId) {
    loadEditorJob(params.jobId);
  }
}

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

// ------------------ Job Management ------------------
async function loadJobs() {
  try {
    const jobs = await apiRequest("/api/jobs");
    state.jobs = jobs;
    renderJobsTable(jobs);
    updateMetrics(jobs);
  } catch (err) {
    console.error("Error loading jobs:", err);
  }
}

function updateMetrics(jobs) {
  document.getElementById("metric-total-jobs").textContent = jobs.length;
  const completed = jobs.filter(j => j.status === "completed").length;
  document.getElementById("metric-completed-jobs").textContent = completed;

  const totalSecs = jobs.reduce((acc, j) => acc + (j.audio_duration || 0), 0);
  const hours = (totalSecs / 3600).toFixed(1);
  document.getElementById("metric-total-duration").textContent = `${hours}h`;

  const activeCount = jobs.filter(j => j.status === "pending" || j.status === "running").length;
  document.getElementById("active-jobs-counter").textContent = `${activeCount} active`;
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

function renderJobsTable(jobs) {
  const tbody = document.getElementById("jobs-table-body");
  if (!jobs || jobs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-12 text-center text-slate-500">
          <i class="fa-solid fa-folder-open text-2xl mb-2 block"></i>
          No transcription jobs yet. Click "Transcribe Audio" to begin!
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
        <td class="py-3.5 px-5">
          ${getStatusBadge(j.status, j.current_step, j.progress)}
        </td>
        <td class="py-3.5 px-5 font-mono text-xs text-slate-400">
          ${formatDuration(j.audio_duration)}
        </td>
        <td class="py-3.5 px-5 text-xs text-slate-500">
          ${j.created_at ? new Date(j.created_at).toLocaleDateString() : '--'}
        </td>
        <td class="py-3.5 px-5 text-right whitespace-nowrap">
          <button onclick="navigate('editor', { jobId: '${j.id}' })"
                  class="px-2.5 py-1.5 rounded-lg bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 text-xs font-semibold transition-colors mr-1">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> Open
          </button>
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

// ------------------ New Transcription Upload & Presets ------------------
function handleFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;

  state.selectedFile = file;
  document.getElementById("selected-file-info").classList.remove("hidden");
  document.getElementById("selected-file-name").textContent = file.name;
  const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
  document.getElementById("selected-file-size").textContent = `(${sizeMB} MB)`;

  const titleInput = document.getElementById("job-title");
  if (!titleInput.value) {
    titleInput.value = file.name.replace(/\.[^/.]+$/, "");
  }
}

function selectPreset(preset) {
  document.querySelectorAll(".preset-card").forEach(el => {
    el.className = "preset-card cursor-pointer p-4 rounded-xl border border-slate-800 bg-slate-950/40 hover:border-brand-500/50 transition-all";
  });
  const card = document.getElementById(`preset-${preset}`);
  if (card) {
    card.className = "preset-card cursor-pointer p-4 rounded-xl border-2 border-brand-500 bg-brand-500/10 transition-all";
  }

  const modelSelect = document.getElementById("config-model-size");
  const computeSelect = document.getElementById("config-compute-type");

  if (preset === "fast") {
    modelSelect.value = "base";
    computeSelect.value = "int8";
  } else if (preset === "balanced") {
    modelSelect.value = "small";
    computeSelect.value = state.systemInfo?.cuda_available ? "float16" : "int8";
  } else if (preset === "accurate") {
    modelSelect.value = "large-v3";
    computeSelect.value = state.systemInfo?.cuda_available ? "float16" : "float32";
  }
}

function toggleAdvancedSettings() {
  const body = document.getElementById("advanced-settings-body");
  const chevron = document.getElementById("advanced-chevron");
  body.classList.toggle("hidden");
  chevron.classList.toggle("rotate-180");
}

function toggleDiarizeFields(enabled) {
  const opts = document.getElementById("diarize-options");
  if (enabled) {
    opts.classList.remove("hidden");
  } else {
    opts.classList.add("hidden");
  }
}

async function handleStartTranscription(e) {
  e.preventDefault();
  if (!state.selectedFile) {
    showToast("Please choose an audio or video file first.", "error");
    return;
  }

  const btn = document.getElementById("btn-submit-transcription");
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading audio...';

  const formData = new FormData();
  formData.append("file", state.selectedFile);
  formData.append("title", document.getElementById("job-title").value.trim());
  formData.append("model_size", document.getElementById("config-model-size").value);
  formData.append("device", document.getElementById("config-device").value);
  formData.append("compute_type", document.getElementById("config-compute-type").value);
  formData.append("batch_size", document.getElementById("config-batch-size").value);
  formData.append("language", document.getElementById("config-language").value);
  formData.append("align", document.getElementById("config-align").checked);
  formData.append("diarize", document.getElementById("config-diarize").checked);
  formData.append("interleaved_context", document.getElementById("config-interleaved").checked);

  const hfToken = document.getElementById("config-hf-token").value.trim();
  if (hfToken) formData.append("hf_token", hfToken);

  const minSpeakers = document.getElementById("config-min-speakers").value;
  if (minSpeakers) formData.append("min_speakers", minSpeakers);

  const maxSpeakers = document.getElementById("config-max-speakers").value;
  if (maxSpeakers) formData.append("max_speakers", maxSpeakers);

  try {
    const res = await apiRequest("/api/transcribe/upload", {
      method: "POST",
      body: formData,
    });
    showToast("Transcription job created successfully!", "success");
    // Reset form
    state.selectedFile = null;
    document.getElementById("form-transcribe").reset();
    document.getElementById("selected-file-info").classList.add("hidden");
    navigate("editor", { jobId: res.job_id });
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-play"></i> <span>Launch Transcription Pipeline</span>';
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
          <button onclick="editSegmentText(${sIdx})" class="text-slate-500 hover:text-slate-300 text-xs" title="Edit text">
            <i class="fa-solid fa-pen text-[10px]"></i>
          </button>
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
  const hfToken = document.getElementById("settings-hf-token").value.trim();
  const defaultModel = document.getElementById("settings-default-model").value;
  const defaultDevice = document.getElementById("settings-default-device").value;
  const defaultCompute = document.getElementById("settings-default-compute").value;

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
    showToast("Settings updated successfully!", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ------------------ Global App Initialization ------------------
async function initializeApp() {
  if (!state.token) {
    document.getElementById("auth-modal").classList.remove("hidden");
    return;
  }

  try {
    const me = await apiRequest("/api/auth/me");
    state.user = me;
    document.getElementById("user-display-name").textContent = me.username;
    document.getElementById("user-initials").textContent = me.username.substring(0, 2).toUpperCase();
    document.getElementById("auth-modal").classList.add("hidden");

    // Populate settings form with user defaults
    if (me.settings) {
      if (me.settings.default_hf_token) {
        document.getElementById("settings-hf-token").value = me.settings.default_hf_token;
        document.getElementById("config-hf-token").value = me.settings.default_hf_token;
      }
      if (me.settings.default_model) {
        document.getElementById("settings-default-model").value = me.settings.default_model;
      }
    }

    loadSystemInfo();
    loadJobs();

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
    logout();
  }
}

// Keyboard shortcuts (Space = Play/Pause)
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
    e.preventDefault();
    toggleAudioPlay();
  }
});

// Boot application on load
window.addEventListener("DOMContentLoaded", () => {
  initializeApp();
});
