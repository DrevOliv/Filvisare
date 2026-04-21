const FOLDER_SVG = `
  <svg class="folder-icon" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
    <path d="M6 14c0-2.2 1.8-4 4-4h14l6 6h24c2.2 0 4 1.8 4 4v30c0 2.2-1.8 4-4 4H10c-2.2 0-4-1.8-4-4V14z"/>
  </svg>`;

const state = {
  path: "",
  folders: [],
  files: [],
  previewable: [],   // files array filtered to items we can preview
  likedSet: new Set(),
  lightboxIndex: -1,
  likedView: false,
};

const el = {
  grid: document.getElementById("grid"),
  empty: document.getElementById("empty"),
  loading: document.getElementById("loading"),
  back: document.getElementById("back-btn"),
  crumbs: document.getElementById("breadcrumbs"),
  logout: document.getElementById("logout-btn"),
  likesBtn: document.getElementById("likes-btn"),
  lightbox: document.getElementById("lightbox"),
  lbImage: document.getElementById("lb-image"),
  lbVideo: document.getElementById("lb-video"),
  lbPrev: document.getElementById("lb-prev"),
  lbNext: document.getElementById("lb-next"),
  lbClose: document.getElementById("lb-close"),
  lbLike: document.getElementById("lb-like"),
  lbFilename: document.getElementById("lb-filename"),
  lbCounter: document.getElementById("lb-counter"),
};

const PLAY_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

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
    const VIDEO_EXTS = new Set(["mp4", "mov", "mkv", "webm", "m4v", "avi"]);
    state.files = liked.map((p) => {
      const ext = (p.split(".").pop() || "").toLowerCase();
      return {
        name: p.split("/").pop(),
        path: p,
        type: "file",
        previewable: true,
        extension: ext,
        media_kind: VIDEO_EXTS.has(ext) ? "video" : "image",
      };
    });
    state.previewable = state.files;
    renderLiked();
  } catch (err) {
    if (err.message !== "unauthorized") alert(err.message);
  } finally {
    showLoading(false);
  }
}

// ───── Render ─────
function render() {
  renderBreadcrumbs();
  el.back.disabled = !state.path;
  renderGrid();
}

function renderLiked() {
  el.crumbs.innerHTML = `<span class="breadcrumb current">Liked Images</span>`;
  el.back.disabled = false;
  renderGrid();
}

function renderBreadcrumbs() {
  el.crumbs.innerHTML = "";
  const root = document.createElement("a");
  root.className = "breadcrumb" + (state.path ? "" : " current");
  root.textContent = "Home";
  root.href = "#/";
  root.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("");
  });
  el.crumbs.appendChild(root);

  if (state.path) {
    const parts = state.path.split("/");
    let acc = "";
    parts.forEach((part, i) => {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = "/";
      el.crumbs.appendChild(sep);

      acc = acc ? `${acc}/${part}` : part;
      const node = document.createElement("a");
      node.className = "breadcrumb" + (i === parts.length - 1 ? " current" : "");
      node.textContent = part;
      node.href = `#/${acc}`;
      const target = acc;
      node.addEventListener("click", (e) => {
        e.preventDefault();
        navigate(target);
      });
      el.crumbs.appendChild(node);
    });
  }
}

function renderGrid() {
  el.grid.innerHTML = "";
  const items = [...state.folders, ...state.files];
  el.empty.classList.toggle("hidden", items.length > 0);

  for (const folder of state.folders) el.grid.appendChild(folderTile(folder));
  for (const file of state.files) el.grid.appendChild(fileTile(file));

  lazyLoadThumbnails();
}

function folderTile(folder) {
  const node = document.createElement("div");
  node.className = "item";
  node.innerHTML = `
    <div class="item-thumb">${FOLDER_SVG}</div>
    <div class="item-name">${escapeHtml(folder.name)}</div>
  `;
  node.addEventListener("dblclick", () => navigate(folder.path));
  let lastTap = 0;
  node.addEventListener("click", () => {
    const now = Date.now();
    if (now - lastTap < 300) navigate(folder.path);
    lastTap = now;
  });
  return node;
}

function fileTile(file) {
  const node = document.createElement("div");
  node.className = "item";
  const liked = state.likedSet.has(file.path);

  const thumb = document.createElement("div");
  thumb.className = "item-thumb";
  if (file.previewable) {
    const img = document.createElement("img");
    img.alt = file.name;
    img.loading = "lazy";
    img.dataset.src = `/api/preview?path=${encodeURIComponent(file.path)}&size=thumbnail`;
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

  if (liked) {
    const badge = document.createElement("div");
    badge.className = "heart-badge";
    badge.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 21s-7.5-4.58-10-9.13C.49 8.36 2.42 5 5.5 5c1.74 0 3.41.81 4.5 2.09C11.09 5.81 12.76 5 14.5 5 17.58 5 19.51 8.36 18 11.87 19.5 16.42 12 21 12 21z"/></svg>`;
    node.appendChild(badge);
  }

  if (file.media_kind === "video") {
    const play = document.createElement("div");
    play.className = "video-badge";
    play.innerHTML = PLAY_SVG;
    node.appendChild(play);
  }

  if (file.previewable) {
    node.addEventListener("click", () => {
      const idx = state.previewable.findIndex((f) => f.path === file.path);
      if (idx >= 0) openLightbox(idx);
    });
  }
  return node;
}

function lazyLoadThumbnails() {
  const images = el.grid.querySelectorAll("img[data-src]");
  if (!("IntersectionObserver" in window)) {
    images.forEach((img) => {
      img.src = img.dataset.src;
      img.removeAttribute("data-src");
    });
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        img.removeAttribute("data-src");
        observer.unobserve(img);
      }
    });
  }, { rootMargin: "200px" });
  images.forEach((img) => observer.observe(img));
}

// ───── Lightbox ─────
function openLightbox(index) {
  state.lightboxIndex = index;
  el.lightbox.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  showLightboxImage();
}

function closeLightbox() {
  el.lightbox.classList.add("hidden");
  document.body.style.overflow = "";
  el.lbImage.src = "";
  el.lbVideo.pause();
  el.lbVideo.removeAttribute("src");
  el.lbVideo.load();
  state.lightboxIndex = -1;
  renderGrid();
}

function showLightboxImage() {
  const file = state.previewable[state.lightboxIndex];
  if (!file) return;

  const isVideo = file.media_kind === "video";
  el.lbImage.classList.toggle("hidden", isVideo);
  el.lbVideo.classList.toggle("hidden", !isVideo);

  if (isVideo) {
    el.lbImage.src = "";
    el.lbVideo.src = `/api/video?path=${encodeURIComponent(file.path)}`;
    el.lbVideo.load();
    el.lbVideo.play().catch(() => {});
  } else {
    el.lbVideo.pause();
    el.lbVideo.removeAttribute("src");
    el.lbVideo.load();
    el.lbImage.src = `/api/preview?path=${encodeURIComponent(file.path)}&size=full`;
  }

  el.lbFilename.textContent = file.name;
  el.lbCounter.textContent = `${state.lightboxIndex + 1} / ${state.previewable.length}`;
  el.lbPrev.disabled = state.lightboxIndex === 0;
  el.lbNext.disabled = state.lightboxIndex === state.previewable.length - 1;
  el.lbLike.classList.toggle("liked", state.likedSet.has(file.path));

  preload(state.lightboxIndex + 1);
  preload(state.lightboxIndex - 1);
}

function preload(index) {
  const file = state.previewable[index];
  // Skip preloading video — it's large and streams on demand.
  if (!file || file.media_kind === "video") return;
  const img = new Image();
  img.src = `/api/preview?path=${encodeURIComponent(file.path)}&size=full`;
}

function lightboxNext() {
  if (state.lightboxIndex < state.previewable.length - 1) {
    state.lightboxIndex += 1;
    showLightboxImage();
  }
}

function lightboxPrev() {
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
  } catch (err) {
    if (err.message !== "unauthorized") alert(err.message);
  }
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
el.back.addEventListener("click", () => {
  if (state.likedView) return navigate(state.path || "");
  if (!state.path) return;
  const parent = state.path.includes("/")
    ? state.path.substring(0, state.path.lastIndexOf("/"))
    : "";
  navigate(parent);
});

el.logout.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
});

el.likesBtn.addEventListener("click", () => {
  if (state.likedView) navigate(state.path || "");
  else showLikedView();
});

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
  // When the video is focused, let arrow keys seek inside it.
  const videoFocused = document.activeElement === el.lbVideo;
  if (e.key === "Escape") closeLightbox();
  else if (e.key === "ArrowLeft" && !videoFocused) lightboxPrev();
  else if (e.key === "ArrowRight" && !videoFocused) lightboxNext();
  else if (e.key.toLowerCase() === "l") toggleCurrentLike();
});

// ───── Init ─────
(async function init() {
  try {
    await loadLikes();
    const initial = decodeURIComponent((window.location.hash || "").replace(/^#\/?/, ""));
    await navigate(initial);
  } catch (err) {
    if (err.message !== "unauthorized") alert(err.message);
  }
})();
