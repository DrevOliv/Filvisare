const FOLDER_SVG = `
  <svg class="folder-icon" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
    <path d="M6 14c0-2.2 1.8-4 4-4h14l6 6h24c2.2 0 4 1.8 4 4v30c0 2.2-1.8 4-4 4H10c-2.2 0-4-1.8-4-4V14z"/>
  </svg>`;

const TREE_FOLDER_SVG = `<svg viewBox="0 0 64 64" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M6 14c0-2.2 1.8-4 4-4h14l6 6h24c2.2 0 4 1.8 4 4v30c0 2.2-1.8 4-4 4H10c-2.2 0-4-1.8-4-4V14z"/></svg>`;

const TREE_ARROW_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5l8 7-8 7z"/></svg>`;

const PLAY_BADGE_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;

const VIDEO_EXTS = new Set(["mp4", "webm", "m4v", "mov", "ogv", "ogg"]);

const state = {
  path: "",
  folders: [],
  files: [],
  previewable: [],   // files array filtered to items we can preview
  likedSet: new Set(),
  lightboxIndex: -1,
  likedView: false,
  lightboxLoading: false,
  selectMode: false,
  selected: new Set(),
};

const CHECKBOX_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

const el = {
  grid: document.getElementById("grid"),
  empty: document.getElementById("empty"),
  loading: document.getElementById("loading"),
  location: document.getElementById("location"),
  tree: document.getElementById("tree"),
  logout: document.getElementById("logout-btn"),
  likesBtn: document.getElementById("likes-btn"),
  selectBtn: document.getElementById("select-btn"),
  selectAllBtn: document.getElementById("select-all-btn"),
  downloadBtn: document.getElementById("download-btn"),
  downloadLabel: document.getElementById("download-label"),
  lightbox: document.getElementById("lightbox"),
  lbImage: document.getElementById("lb-image"),
  lbVideo: document.getElementById("lb-video"),
  lbVideoWrap: document.getElementById("lb-video-wrap"),
  lbSpinner: document.getElementById("lb-spinner"),
  vcBigPlay: document.getElementById("vc-big-play"),
  vcPlay: document.getElementById("vc-play"),
  vcCurrent: document.getElementById("vc-current"),
  vcDuration: document.getElementById("vc-duration"),
  vcScrub: document.getElementById("vc-scrub"),
  vcMute: document.getElementById("vc-mute"),
  vcFs: document.getElementById("vc-fs"),
  lbFs: document.getElementById("lb-fs"),
  lbPrev: document.getElementById("lb-prev"),
  lbNext: document.getElementById("lb-next"),
  lbClose: document.getElementById("lb-close"),
  lbLike: document.getElementById("lb-like"),
  lbFilename: document.getElementById("lb-filename"),
  lbCounter: document.getElementById("lb-counter"),
};

// ───── API ─────
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function loadLikes() {
  const data = await api("/api/likes");
  state.likedSet = new Set(data.liked);
}

async function toggleLike(path) {
  const data = await api("/api/likes/toggle", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
  if (data.liked) state.likedSet.add(data.path);
  else state.likedSet.delete(data.path);
  return data.liked;
}

// ───── Navigation ─────
async function navigate(path) {
  state.likedView = false;
  el.likesBtn.classList.remove("active");
  showLoading(true);
  try {
    const data = await api(`/api/browse?path=${encodeURIComponent(path)}`);
    state.path = data.path === "." ? "" : data.path;
    state.folders = data.folders;
    state.files = data.files;
    state.previewable = data.files.filter((f) => f.previewable);
    window.history.replaceState({}, "", `#/${state.path}`);
    render();
    revealAndSelect(state.path);
  } catch (err) {
    if (err.message !== "unauthorized") alert(err.message);
  } finally {
    showLoading(false);
  }
}

async function showLikedView() {
  state.likedView = true;
  el.likesBtn.classList.add("active");
  showLoading(true);
  try {
    const { liked } = await api("/api/likes");
    state.likedSet = new Set(liked);
    state.folders = [];
    state.files = liked.map((p) => {
      const extension = (p.split(".").pop() || "").toLowerCase();
      return {
        name: p.split("/").pop(),
        path: p,
        type: "file",
        previewable: true,
        is_video: VIDEO_EXTS.has(extension),
        extension,
      };
    });
    state.previewable = state.files;
    renderLiked();
    clearTreeSelection();
  } catch (err) {
    if (err.message !== "unauthorized") alert(err.message);
  } finally {
    showLoading(false);
  }
}

// ───── Render ─────
function render() {
  el.location.textContent = state.path ? state.path : "Home";
  renderGrid();
}

function renderLiked() {
  el.location.textContent = "Liked Images";
  renderGrid();
}

const HEART_BADGE_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 21s-7.5-4.58-10-9.13C.49 8.36 2.42 5 5.5 5c1.74 0 3.41.81 4.5 2.09C11.09 5.81 12.76 5 14.5 5 17.58 5 19.51 8.36 18 11.87 19.5 16.42 12 21 12 21z"/></svg>`;

// Build a path → fast-lookup map so delegated click handlers can find the
// corresponding file in O(1) on huge folders.
let pathIndex = new Map();

function renderGrid() {
  const items = state.folders.length + state.files.length;
  el.empty.classList.toggle("hidden", items > 0);

  pathIndex = new Map();
  state.folders.forEach((f, i) => pathIndex.set(f.path, { kind: "folder", data: f, i }));
  state.files.forEach((f, i) => pathIndex.set(f.path, { kind: "file", data: f, i }));

  // Build off-tree in a fragment so we only trigger one reflow.
  const fragment = document.createDocumentFragment();
  for (const folder of state.folders) fragment.appendChild(folderTile(folder));
  for (const file of state.files) fragment.appendChild(fileTile(file));
  el.grid.replaceChildren(fragment);

  updateSelectAllButton();
}

function folderTile(folder) {
  const node = document.createElement("div");
  node.className = "item";
  node.dataset.path = folder.path;
  node.dataset.kind = "folder";
  node.innerHTML = `
    <div class="item-thumb">${FOLDER_SVG}</div>
    <div class="item-name">${escapeHtml(folder.name)}</div>
  `;
  node.appendChild(selectCheckbox());
  if (state.selected.has(folder.path)) node.classList.add("selected");
  return node;
}

function fileTile(file) {
  const node = document.createElement("div");
  node.className = "item";
  node.dataset.path = file.path;
  node.dataset.kind = "file";
  const liked = state.likedSet.has(file.path);

  const thumb = document.createElement("div");
  thumb.className = "item-thumb";
  if (file.is_video) {
    thumb.classList.add("video", "loading");
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.addEventListener("loadeddata", () => {
      video.classList.add("loaded");
      thumb.classList.remove("loading");
    });
    video.addEventListener("error", () => {
      thumb.classList.remove("loading");
    });
    video.src = `/api/video?path=${encodeURIComponent(file.path)}#t=0.1`;
    thumb.appendChild(video);
    const badge = document.createElement("div");
    badge.className = "play-badge";
    badge.innerHTML = PLAY_BADGE_SVG;
    thumb.appendChild(badge);
  } else if (file.previewable) {
    thumb.classList.add("loading");
    const img = document.createElement("img");
    img.alt = file.name;
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("load", () => {
      img.classList.add("loaded");
      thumb.classList.remove("loading");
    });
    img.addEventListener("error", () => {
      thumb.classList.remove("loading");
    });
    img.src = `/api/preview?path=${encodeURIComponent(file.path)}&size=thumbnail`;
    thumb.appendChild(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "placeholder";
    ph.textContent = file.extension || "FILE";
    thumb.appendChild(ph);
  }

  const name = document.createElement("div");
  name.className = "item-name";
  name.textContent = file.name;

  node.appendChild(thumb);
  node.appendChild(name);

  if (liked) node.appendChild(heartBadge());
  node.appendChild(selectCheckbox());
  if (state.selected.has(file.path)) node.classList.add("selected");
  return node;
}

function selectCheckbox() {
  const box = document.createElement("div");
  box.className = "select-checkbox";
  box.innerHTML = CHECKBOX_SVG;
  return box;
}

function heartBadge() {
  const badge = document.createElement("div");
  badge.className = "heart-badge";
  badge.innerHTML = HEART_BADGE_SVG;
  return badge;
}

function updateTileLiked(path, liked) {
  const tile = el.grid.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (!tile) return;
  const existing = tile.querySelector(".heart-badge");
  if (liked && !existing) tile.appendChild(heartBadge());
  else if (!liked && existing) existing.remove();
}

// One delegated click listener for the whole grid.
let lastTap = { path: null, time: 0 };
el.grid.addEventListener("click", (e) => {
  const tile = e.target.closest(".item");
  if (!tile) return;
  const entry = pathIndex.get(tile.dataset.path);
  if (!entry) return;

  if (state.selectMode) {
    toggleSelected(entry.data.path, tile);
    return;
  }

  if (entry.kind === "folder") {
    // Single-tap-to-enter on touch; desktop uses dblclick via the below.
    const now = Date.now();
    if (lastTap.path === entry.data.path && now - lastTap.time < 300) {
      navigate(entry.data.path);
    }
    lastTap = { path: entry.data.path, time: now };
    return;
  }

  if (entry.data.previewable) {
    const idx = state.previewable.findIndex((f) => f.path === entry.data.path);
    if (idx >= 0) openLightbox(idx);
  }
});

el.grid.addEventListener("dblclick", (e) => {
  if (state.selectMode) return;
  const tile = e.target.closest(".item[data-kind='folder']");
  if (!tile) return;
  const entry = pathIndex.get(tile.dataset.path);
  if (entry) navigate(entry.data.path);
});

// ───── Sidebar tree ─────
function buildTreeNode(folder, depth) {
  const li = document.createElement("li");
  li.className = "tree-node";
  li.dataset.path = folder.path;
  li.dataset.depth = String(depth);
  li.dataset.loaded = "false";
  if (folder.has_subfolders === false) {
    li.classList.add("is-leaf");
  }

  const row = document.createElement("div");
  row.className = "tree-row";
  row.style.setProperty("--depth", String(depth));

  const arrow = document.createElement("button");
  arrow.className = "tree-arrow";
  arrow.type = "button";
  arrow.tabIndex = -1;
  arrow.setAttribute("aria-label", "Expand");
  arrow.innerHTML = TREE_ARROW_SVG;

  const icon = document.createElement("span");
  icon.className = "tree-icon";
  icon.innerHTML = TREE_FOLDER_SVG;

  const label = document.createElement("span");
  label.className = "tree-label";
  label.textContent = folder.name;

  row.append(icon, label, arrow);

  const children = document.createElement("ul");
  children.className = "tree-children";

  li.append(row, children);
  return li;
}

async function loadChildren(li) {
  if (li.dataset.loaded === "true") return;
  const path = li.dataset.path;
  const depth = parseInt(li.dataset.depth, 10) + 1;
  const children = li.querySelector(":scope > .tree-children");
  try {
    const data = await api(`/api/browse?path=${encodeURIComponent(path)}`);
    children.replaceChildren();
    for (const folder of data.folders) {
      children.appendChild(buildTreeNode(folder, depth));
    }
    if (data.folders.length === 0) li.classList.add("is-leaf");
    li.dataset.loaded = "true";
  } catch (err) {
    if (err.message !== "unauthorized") console.warn("tree load failed", err);
  }
}

async function toggleNode(li, expand) {
  const shouldExpand =
    expand === undefined ? !li.classList.contains("expanded") : expand;
  if (shouldExpand) {
    await loadChildren(li);
    li.classList.add("expanded");
  } else {
    li.classList.remove("expanded");
  }
}

function clearTreeSelection() {
  el.tree.querySelectorAll(".tree-row.selected").forEach((r) =>
    r.classList.remove("selected"),
  );
}

async function revealAndSelect(targetPath) {
  clearTreeSelection();
  if (!targetPath) return;

  const parts = targetPath.split("/");
  let currentLi = Array.from(el.tree.children).find(
    (li) => li.dataset.path === parts[0],
  );
  if (!currentLi) return;
  await toggleNode(currentLi, true);

  let acc = parts[0];
  for (let i = 1; i < parts.length; i++) {
    acc = `${acc}/${parts[i]}`;
    const childUl = currentLi.querySelector(":scope > .tree-children");
    const nextLi = Array.from(childUl.children).find(
      (c) => c.dataset.path === acc,
    );
    if (!nextLi) break;
    await toggleNode(nextLi, true);
    currentLi = nextLi;
  }

  const row = currentLi.querySelector(":scope > .tree-row");
  row.classList.add("selected");
  row.scrollIntoView({ block: "nearest" });
}

async function initTree() {
  el.tree.replaceChildren();
  try {
    const data = await api(`/api/browse?path=`);
    for (const folder of data.folders) {
      el.tree.appendChild(buildTreeNode(folder, 0));
    }
  } catch (err) {
    if (err.message !== "unauthorized") console.warn("tree init failed", err);
  }
}

el.tree.addEventListener("click", async (e) => {
  const arrow = e.target.closest(".tree-arrow");
  const row = e.target.closest(".tree-row");
  if (!row) return;
  const li = row.closest(".tree-node");
  if (!li) return;

  if (arrow) {
    e.stopPropagation();
    await toggleNode(li);
    return;
  }

  clearTreeSelection();
  row.classList.add("selected");
});

el.tree.addEventListener("dblclick", async (e) => {
  if (e.target.closest(".tree-arrow")) return;
  const row = e.target.closest(".tree-row");
  if (!row) return;
  const li = row.closest(".tree-node");
  if (!li) return;
  await navigate(li.dataset.path);
});

// ───── Lightbox ─────
function openLightbox(index) {
  state.lightboxIndex = index;
  el.lightbox.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  showLightboxImage();
}

function closeLightbox() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  el.lightbox.classList.add("hidden");
  document.body.style.overflow = "";
  el.lbImage.src = "";
  el.lbImage.classList.remove("loaded");
  resetVideo();
  el.lbSpinner.classList.add("hidden");
  state.lightboxLoading = false;
  state.lightboxIndex = -1;
}

function resetVideo() {
  el.lbVideo.pause();
  el.lbVideo.removeAttribute("src");
  el.lbVideo.load();
  el.lbVideoWrap.classList.add("hidden");
  el.lbVideoWrap.classList.remove("playing");
  el.lightbox.classList.remove("idle");
  stopIdleTimer();
}

function setLightboxLoading(loading) {
  state.lightboxLoading = loading;
  el.lbSpinner.classList.toggle("hidden", !loading);
  updateLightboxNavDisabled();
}

function updateLightboxNavDisabled() {
  el.lbPrev.disabled =
    state.lightboxLoading || state.lightboxIndex === 0;
  el.lbNext.disabled =
    state.lightboxLoading ||
    state.lightboxIndex === state.previewable.length - 1;
}

function showLightboxImage() {
  const file = state.previewable[state.lightboxIndex];
  if (!file) return;
  setLightboxLoading(true);

  if (file.is_video) {
    el.lbImage.classList.add("hidden");
    el.lbImage.src = "";
    el.lbImage.classList.remove("loaded");
    el.lbVideoWrap.classList.remove("hidden", "playing");
    el.lightbox.classList.remove("idle");
    resetVideoUi();
    el.lbVideo.src = `/api/video?path=${encodeURIComponent(file.path)}`;
    el.lbVideo.load();
  } else {
    resetVideo();
    el.lbImage.classList.remove("hidden", "loaded");
    el.lbImage.src = `/api/preview?path=${encodeURIComponent(file.path)}&size=full`;
    if (el.lbImage.complete && el.lbImage.naturalWidth > 0) {
      el.lbImage.classList.add("loaded");
      setLightboxLoading(false);
    }
    preload(state.lightboxIndex + 1);
    preload(state.lightboxIndex - 1);
  }

  el.lbFilename.textContent = file.name;
  el.lbCounter.textContent = `${state.lightboxIndex + 1} / ${state.previewable.length}`;
  el.lbLike.classList.toggle("liked", state.likedSet.has(file.path));
}

el.lbImage.addEventListener("load", () => {
  if (el.lightbox.classList.contains("hidden")) return;
  el.lbImage.classList.add("loaded");
  setLightboxLoading(false);
});

el.lbImage.addEventListener("error", () => {
  setLightboxLoading(false);
});

el.lbVideo.addEventListener("canplay", () => {
  if (el.lightbox.classList.contains("hidden")) return;
  setLightboxLoading(false);
});

el.lbVideo.addEventListener("error", () => {
  setLightboxLoading(false);
});

// ───── Custom video controls ─────
function formatTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function togglePlay() {
  if (el.lbVideo.paused) el.lbVideo.play();
  else el.lbVideo.pause();
}

el.vcPlay.addEventListener("click", togglePlay);
el.vcBigPlay.addEventListener("click", togglePlay);
el.lbVideo.addEventListener("click", togglePlay);

el.lbVideo.addEventListener("play", () => {
  el.lbVideoWrap.classList.add("playing");
  startIdleTimer();
});
el.lbVideo.addEventListener("pause", () => {
  el.lbVideoWrap.classList.remove("playing");
  el.lightbox.classList.remove("idle");
  stopIdleTimer();
});
el.lbVideo.addEventListener("ended", () => {
  el.lbVideoWrap.classList.remove("playing");
  el.lightbox.classList.remove("idle");
  stopIdleTimer();
});

el.lbVideo.addEventListener("loadedmetadata", () => {
  el.vcDuration.textContent = formatTime(el.lbVideo.duration);
  el.vcScrub.max = String(el.lbVideo.duration || 0);
});

el.lbVideo.addEventListener("timeupdate", () => {
  el.vcCurrent.textContent = formatTime(el.lbVideo.currentTime);
  const dur = el.lbVideo.duration || 0;
  const pct = dur > 0 ? (el.lbVideo.currentTime / dur) * 100 : 0;
  el.vcScrub.value = String(el.lbVideo.currentTime);
  el.vcScrub.style.backgroundSize = `${pct}% 100%`;
});

el.vcScrub.addEventListener("input", () => {
  el.lbVideo.currentTime = parseFloat(el.vcScrub.value) || 0;
});

el.vcMute.addEventListener("click", () => {
  el.lbVideo.muted = !el.lbVideo.muted;
});
el.lbVideo.addEventListener("volumechange", () => {
  el.lbVideoWrap.classList.toggle("muted", el.lbVideo.muted);
});

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else el.lightbox.requestFullscreen?.();
}
el.vcFs.addEventListener("click", toggleFullscreen);
el.lbFs.addEventListener("click", toggleFullscreen);

// Auto-hide controls while playing
let idleTimer = null;
let lastPointer = { x: 0, y: 0, t: 0 };

function startIdleTimer() {
  stopIdleTimer();
  idleTimer = setTimeout(() => {
    if (!el.lbVideo.paused) el.lightbox.classList.add("idle");
  }, 2500);
}
function stopIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}
function wakeControls() {
  el.lightbox.classList.remove("idle");
  if (!el.lbVideo.paused) startIdleTimer();
}

// Ignore sub-pixel jitter and events closer than 80ms apart so a stationary
// cursor doesn't keep resetting the hide timer.
el.lightbox.addEventListener("pointermove", (e) => {
  if (el.lbVideoWrap.classList.contains("hidden")) return;
  const now = performance.now();
  const dx = Math.abs(e.clientX - lastPointer.x);
  const dy = Math.abs(e.clientY - lastPointer.y);
  if (dx + dy < 3 || now - lastPointer.t < 80) return;
  lastPointer = { x: e.clientX, y: e.clientY, t: now };
  wakeControls();
});
el.lbVideoWrap.addEventListener("touchstart", wakeControls);

function resetVideoUi() {
  el.vcCurrent.textContent = "0:00";
  el.vcDuration.textContent = "0:00";
  el.vcScrub.max = "0";
  el.vcScrub.value = "0";
  el.vcScrub.style.backgroundSize = "0% 100%";
}

function preload(index) {
  const file = state.previewable[index];
  if (!file) return;
  const img = new Image();
  img.src = `/api/preview?path=${encodeURIComponent(file.path)}&size=full`;
}

function lightboxNext() {
  if (state.lightboxLoading) return;
  if (state.lightboxIndex < state.previewable.length - 1) {
    state.lightboxIndex += 1;
    showLightboxImage();
  }
}

function lightboxPrev() {
  if (state.lightboxLoading) return;
  if (state.lightboxIndex > 0) {
    state.lightboxIndex -= 1;
    showLightboxImage();
  }
}

async function toggleCurrentLike() {
  const file = state.previewable[state.lightboxIndex];
  if (!file) return;
  try {
    const liked = await toggleLike(file.path);
    el.lbLike.classList.toggle("liked", liked);
    el.lbLike.classList.remove("pop");
    void el.lbLike.offsetWidth;
    el.lbLike.classList.add("pop");
    updateTileLiked(file.path, liked);
  } catch (err) {
    if (err.message !== "unauthorized") alert(err.message);
  }
}

// ───── Select & Download ─────
function toggleSelectMode() {
  state.selectMode = !state.selectMode;
  if (!state.selectMode) state.selected.clear();
  document.body.classList.toggle("select-mode", state.selectMode);
  el.selectBtn.classList.toggle("active", state.selectMode);
  refreshSelectionClasses();
  updateDownloadButton();
  updateSelectAllButton();
}

function toggleSelected(path, tile) {
  if (state.selected.has(path)) {
    state.selected.delete(path);
    tile.classList.remove("selected");
  } else {
    state.selected.add(path);
    tile.classList.add("selected");
  }
  updateDownloadButton();
  updateSelectAllButton();
}

function visiblePaths() {
  const paths = [];
  for (const f of state.folders) paths.push(f.path);
  for (const f of state.files) paths.push(f.path);
  return paths;
}

function allVisibleSelected() {
  const paths = visiblePaths();
  if (paths.length === 0) return false;
  for (const p of paths) if (!state.selected.has(p)) return false;
  return true;
}

function toggleSelectAll() {
  const paths = visiblePaths();
  if (paths.length === 0) return;
  if (allVisibleSelected()) {
    for (const p of paths) state.selected.delete(p);
  } else {
    for (const p of paths) state.selected.add(p);
  }
  refreshSelectionClasses();
  updateDownloadButton();
  updateSelectAllButton();
}

function updateSelectAllButton() {
  el.selectAllBtn.classList.toggle("hidden", !state.selectMode);
  el.selectAllBtn.classList.toggle("active", state.selectMode && allVisibleSelected());
}

function refreshSelectionClasses() {
  el.grid.querySelectorAll(".item").forEach((tile) => {
    tile.classList.toggle("selected", state.selected.has(tile.dataset.path));
  });
}

function updateDownloadButton() {
  const count = state.selected.size;
  const show = state.selectMode && count > 0;
  el.downloadBtn.classList.toggle("hidden", !show);
  el.downloadLabel.textContent = count > 0 ? `Download (${count})` : "Download";
}

function downloadSelected() {
  if (!state.selected.size) return;
  const paths = Array.from(state.selected);

  // POST into a hidden iframe so the browser streams the response directly to
  // its download UI. The save dialog appears as soon as bytes start arriving,
  // without blocking or replacing the current page.
  let iframe = document.getElementById("__download-iframe");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.name = "__download";
    iframe.id = "__download-iframe";
    iframe.style.display = "none";
    document.body.appendChild(iframe);
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/api/download";
  form.target = "__download";
  form.style.display = "none";
  for (const p of paths) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "paths";
    input.value = p;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

// ───── Helpers ─────
function showLoading(on) {
  el.loading.classList.toggle("hidden", !on);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ───── Events ─────
el.logout.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
});

el.likesBtn.addEventListener("click", () => {
  if (state.likedView) navigate(state.path || "");
  else showLikedView();
});

el.selectBtn.addEventListener("click", toggleSelectMode);
el.selectAllBtn.addEventListener("click", toggleSelectAll);
el.downloadBtn.addEventListener("click", downloadSelected);

el.lbClose.addEventListener("click", closeLightbox);
el.lbPrev.addEventListener("click", lightboxPrev);
el.lbNext.addEventListener("click", lightboxNext);
el.lbLike.addEventListener("click", toggleCurrentLike);
el.lightbox.addEventListener("click", (e) => {
  if (e.target === el.lightbox || e.target.classList.contains("lightbox-stage")) {
    closeLightbox();
  }
});

document.addEventListener("keydown", (e) => {
  if (el.lightbox.classList.contains("hidden")) return;
  const videoActive = !el.lbVideoWrap.classList.contains("hidden");
  const onScrubber = document.activeElement === el.vcScrub;
  if (e.key === "Escape") closeLightbox();
  else if (e.key === " " && videoActive) { e.preventDefault(); togglePlay(); }
  else if (e.key === "ArrowLeft" && !onScrubber) lightboxPrev();
  else if (e.key === "ArrowRight" && !onScrubber) lightboxNext();
  else if (e.key.toLowerCase() === "h") toggleCurrentLike();
});

// ───── Init ─────
(async function init() {
  try {
    await loadLikes();
    await initTree();
    const initial = decodeURIComponent((window.location.hash || "").replace(/^#\/?/, ""));
    await navigate(initial);
  } catch (err) {
    if (err.message !== "unauthorized") alert(err.message);
  }
})();
