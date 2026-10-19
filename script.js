"use strict";

/* =========================================
   NEXUS AI — FRONTEND CONTROLLER
   ========================================= */

// তোমার Render backend-এর সঠিক URL বসানো আছে।
const API_BASE = "https://nexus-ai-4-irgz.onrender.com";

const CONFIG = {
  chatEndpoint: "/chat",
  uploadEndpoint: "/upload",
  maxFiles: 5,
  maxFileSize: 10 * 1024 * 1024
};


/* =========================================
   DOM HELPERS
   ========================================= */

const $ = (selector, root = document) =>
  root.querySelector(selector);

const $$ = (selector, root = document) =>
  [...root.querySelectorAll(selector)];

function createElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }

  if (text !== undefined) {
    element.textContent = text;
  }

  return element;
}

function showToast(message, type = "info") {
  let container = $("#toastContainer");

  if (!container) {
    container = createElement("div", "toast-container");
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }

  const toast = createElement("div", `toast ${type}`, message);

  container.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3500);
}


/* =========================================
   APP STATE
   ========================================= */

const state = {
  conversations: [],
  currentConversationId: null,

  selectedFiles: [],
  uploadedFiles: [],

  isLoading: false,
  searchEnabled: false,

  currentModel: "NEXUS Intelligence",
  theme: localStorage.getItem("nexus-theme") || "dark",

  user: null
};


/* =========================================
   CONVERSATION MANAGEMENT
   ========================================= */

function createConversation() {
  const conversation = {
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,

    title: "New chat",
    messages: [],
    createdAt: new Date().toISOString()
  };

  state.conversations.unshift(conversation);
  state.currentConversationId = conversation.id;

  renderHistory();
  renderMessages();

  return conversation;
}

function getCurrentConversation() {
  return state.conversations.find(
    conversation =>
      conversation.id === state.currentConversationId
  );
}

function saveConversations() {
  try {
    const data = JSON.stringify(state.conversations);

    if (data.length < 2_000_000) {
      localStorage.setItem("nexus-history", data);
    }
  } catch (error) {
    console.warn("Could not save chat history.", error);
  }
}

function loadConversations() {
  try {
    const saved = localStorage.getItem("nexus-history");

    if (saved) {
      const parsed = JSON.parse(saved);

      if (Array.isArray(parsed)) {
        state.conversations = parsed;
      }
    }
  } catch (error) {
    console.warn("Could not load chat history.", error);
  }

  if (state.conversations.length > 0) {
    state.currentConversationId =
      state.conversations[0].id;
  } else {
    createConversation();
  }

  renderHistory();
  renderMessages();
}

function updateConversationTitle(conversation) {
  const firstUserMessage = conversation.messages.find(
    message => message.role === "user"
  );

  if (!firstUserMessage) return;

  conversation.title =
    firstUserMessage.content.slice(0, 42) ||
    "New chat";

  renderHistory();
}

function addMessage(role, content, extra = {}) {
  const conversation =
    getCurrentConversation() || createConversation();

  const message = {
    id: `${Date.now()}-${Math.random()}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...extra
  };

  conversation.messages.push(message);

  if (
    role === "user" &&
    conversation.title === "New chat"
  ) {
    updateConversationTitle(conversation);
  }

  saveConversations();
  renderMessages();

  return message;
}


/* =========================================
   SAFE MESSAGE RENDERING
   ========================================= */

function renderFormattedText(container, text) {
  const lines = String(text || "").split("\n");

  let currentList = null;
  let currentListType = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      currentList = null;
      currentListType = null;
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);

    if (heading) {
      currentList = null;
      currentListType = null;

      const level = heading[1].length;
      const element = createElement(
        `h${level}`,
        "",
        heading[2]
      );

      container.appendChild(element);
      continue;
    }

    if (unordered || ordered) {
      const type = unordered ? "ul" : "ol";
      const match = unordered || ordered;

      if (currentListType !== type) {
        currentList = createElement(type);
        container.appendChild(currentList);
        currentListType = type;
      }

      const item = createElement("li");
      appendInlineText(item, match[1]);

      currentList.appendChild(item);
      continue;
    }

    currentList = null;
    currentListType = null;

    const paragraph = createElement("p");
    appendInlineText(paragraph, trimmed);

    container.appendChild(paragraph);
  }
}

function appendInlineText(container, text) {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;

  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    container.appendChild(
      document.createTextNode(
        text.slice(lastIndex, match.index)
      )
    );

    const token = match[0];

    if (token.startsWith("**")) {
      container.appendChild(
        createElement("strong", "", token.slice(2, -2))
      );
    } else {
      container.appendChild(
        createElement("code", "", token.slice(1, -1))
      );
    }

    lastIndex = pattern.lastIndex;
  }

  container.appendChild(
    document.createTextNode(text.slice(lastIndex))
  );
}


/* =========================================
   MESSAGE UI
   ========================================= */

function renderMessages() {
  const welcome = $("#welcomeScreen");
  const messagesContainer = $("#messagesContainer");

  if (!welcome || !messagesContainer) return;

  const conversation = getCurrentConversation();
  const messages = conversation?.messages || [];

  const hasMessages = messages.length > 0;

  welcome.classList.toggle("hidden", hasMessages);
  messagesContainer.classList.toggle("hidden", !hasMessages);

  messagesContainer.replaceChildren();

  for (const message of messages) {
    messagesContainer.appendChild(
      buildMessageElement(message)
    );
  }

  if (state.isLoading) {
    messagesContainer.appendChild(
      buildTypingIndicator()
    );
  }

  messagesContainer.scrollTop =
    messagesContainer.scrollHeight;
}

function buildMessageElement(message) {
  const wrapper = createElement(
    "article",
    `message ${message.role}`
  );

  const avatar = createElement(
    "div",
    "message-avatar",
    message.role === "user" ? "Y" : "N"
  );

  const body = createElement("div", "message-body");

  const header = createElement("div", "message-header");

  header.appendChild(
    createElement(
      "span",
      "message-author",
      message.role === "user"
        ? (state.user?.name || "You")
        : "NEXUS AI"
    )
  );

  header.appendChild(
    createElement(
      "span",
      "message-time",
      formatTime(message.createdAt)
    )
  );

  const content = createElement("div", "message-content");

  renderFormattedText(content, message.content);

  body.appendChild(header);
  body.appendChild(content);

  if (message.role === "assistant") {
    const actions = createElement("div", "message-actions");

    const copyButton = createElement(
      "button",
      "message-action",
      "▢"
    );

    copyButton.type = "button";
    copyButton.title = "Copy message";
    copyButton.setAttribute("aria-label", "Copy message");

    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(
          message.content
        );

        showToast("Message copied.", "success");
      } catch {
        showToast("Clipboard access unavailable.", "error");
      }
    });

    actions.appendChild(copyButton);
    body.appendChild(actions);
  }

  wrapper.appendChild(avatar);
  wrapper.appendChild(body);

  return wrapper;
}

function buildTypingIndicator() {
  const wrapper = createElement(
    "article",
    "message assistant"
  );

  wrapper.appendChild(
    createElement("div", "message-avatar", "N")
  );

  const body = createElement("div", "message-body");

  body.appendChild(
    createElement("div", "message-header", "NEXUS AI")
  );

  const indicator = createElement(
    "div",
    "typing-indicator"
  );

  for (let i = 0; i < 3; i++) {
    indicator.appendChild(
      document.createElement("span")
    );
  }

  body.appendChild(indicator);
  wrapper.appendChild(body);

  return wrapper;
}

function formatTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}


/* =========================================
   CHAT HISTORY UI
   ========================================= */

function renderHistory() {
  const container = $("#chatHistory");

  if (!container) return;

  container.replaceChildren();

  if (state.conversations.length === 0) {
    container.appendChild(
      createElement(
        "div",
        "history-empty",
        "Your conversations will appear here."
      )
    );

    return;
  }

  for (const conversation of state.conversations) {
    const button = createElement(
      "button",
      "history-item"
    );

    button.type = "button";

    if (
      conversation.id === state.currentConversationId
    ) {
      button.classList.add("active");
    }

    button.appendChild(
      createElement("span", "history-item-icon", "◷")
    );

    button.appendChild(
      createElement(
        "span",
        "history-item-label",
        conversation.title || "New chat"
      )
    );

    button.addEventListener("click", () => {
      state.currentConversationId = conversation.id;

      renderHistory();
      renderMessages();
      closeMobileSidebar();
    });

    container.appendChild(button);
  }
}


/* =========================================
   BACKEND API
   ========================================= */

async function apiRequest(path, options = {}) {
  const response = await fetch(
    `${API_BASE}${path}`,
    {
      ...options,
      headers: {
        ...(options.headers || {})
      },
      credentials: "include"
    }
  );

  const contentType =
    response.headers.get("content-type") || "";

  let data;

  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const errorMessage =
      typeof data === "object"
        ? data.error || data.message
        : data;

    throw new Error(
      errorMessage ||
      `Request failed (${response.status})`
    );
  }

  return data;
}


/* =========================================
   SEND CHAT MESSAGE
   ========================================= */

async function sendMessage() {
  if (state.isLoading) return;

  const input = $("#messageInput");

  if (!input) return;

  const text = input.value.trim();

  if (!text && state.selectedFiles.length === 0) {
    return;
  }

  const conversation =
    getCurrentConversation() || createConversation();

  const conversationId = conversation.id;

  const selectedFiles = [...state.selectedFiles];

  input.value = "";
  resizeTextarea(input);

  state.isLoading = true;

  const userMessage = addMessage(
    "user",
    text || "Please examine the attached file.",
    {
      attachments: selectedFiles.map(file => ({
        name: file.name,
        type: file.type
      }))
    }
  );

  renderMessages();

  try {
    let uploadedFiles = [];

    if (selectedFiles.length > 0) {
      uploadedFiles = await uploadAttachments(
        selectedFiles
      );
    }

    state.uploadedFiles = uploadedFiles;

    const current = getCurrentConversation();

    const history = (current?.messages || [])
      .filter(message => message.id !== userMessage.id)
      .slice(-12)
      .map(message => ({
        role: message.role,
        content: message.content
      }));

    const payload = {
      message: text || "Please examine the attached file.",
      conversation_id: conversationId,
      history,
      files: uploadedFiles,
      model: state.currentModel,
      search: state.searchEnabled
    };

    const result = await apiRequest(
      CONFIG.chatEndpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const reply =
      result.reply ||
      result.response ||
      result.answer ||
      result.message;

    if (typeof reply !== "string" || !reply.trim()) {
      throw new Error(
        "Backend returned no AI reply. Check your app.py."
      );
    }

    addMessage("assistant", reply.trim());
  } catch (error) {
    console.error("NEXUS chat error:", error);

    addMessage(
      "assistant",
      "দুঃখিত, AI-এর সঙ্গে সংযোগ করা যায়নি।\n\n" +
      "সমস্যা: " + error.message +
      "\n\nBackend চালু আছে কি না এবং /chat endpoint ঠিক আছে কি না পরীক্ষা করো।"
    );

    showToast("AI connection failed.", "error");
  } finally {
    state.isLoading = false;
    state.selectedFiles = [];
    state.uploadedFiles = [];

    renderAttachmentPreview();
    renderMessages();
    saveConversations();

    const sendButton = $("#sendBtn");

    if (sendButton) {
      sendButton.classList.remove("loading");
      sendButton.disabled = false;
    }
  }
}


/* =========================================
   FILE UPLOAD
   ========================================= */

function getFileInput() {
  return $("#fileInput");
}

async function uploadAttachments(files) {
  if (!files.length) return [];

  const formData = new FormData();

  for (const file of files) {
    formData.append("files", file);
  }

  const result = await apiRequest(
    CONFIG.uploadEndpoint,
    {
      method: "POST",
      body: formData
    }
  );

  if (Array.isArray(result)) {
    return result;
  }

  if (Array.isArray(result.files)) {
    return result.files;
  }

  throw new Error(
    "Unexpected upload response from backend."
  );
}

function handleFileSelection(event) {
  const files = [...(event.target.files || [])];

  for (const file of files) {
    if (state.selectedFiles.length >= CONFIG.maxFiles) {
      showToast("You can attach up to 5 files.", "error");
      break;
    }

    if (file.size > CONFIG.maxFileSize) {
      showToast(
        `${file.name}: maximum file size is 10 MB.`,
        "error"
      );

      continue;
    }

    const duplicate = state.selectedFiles.some(
      existing =>
        existing.name === file.name &&
        existing.size === file.size
    );

    if (!duplicate) {
      state.selectedFiles.push(file);
    }
  }

  event.target.value = "";

  renderAttachmentPreview();
}

function renderAttachmentPreview() {
  const preview = $("#attachmentPreview");

  if (!preview) return;

  preview.replaceChildren();

  for (const file of state.selectedFiles) {
    const item = createElement(
      "div",
      "attachment-item"
    );

    if (file.type.startsWith("image/")) {
      const image = document.createElement("img");

      image.alt = file.name;
      image.src = URL.createObjectURL(file);

      item.appendChild(image);
    } else {
      item.appendChild(
        createElement("div", "attachment-icon", "▤")
      );
    }

    const info = createElement("div", "attachment-info");

    info.appendChild(
      createElement("strong", "", file.name)
    );

    info.appendChild(
      createElement("small", "", formatFileSize(file.size))
    );

    const removeButton = createElement(
      "button",
      "attachment-remove",
      "×"
    );

    removeButton.type = "button";
    removeButton.setAttribute(
      "aria-label",
      `Remove ${file.name}`
    );

    removeButton.addEventListener("click", () => {
      state.selectedFiles = state.selectedFiles.filter(
        selected => selected !== file
      );

      renderAttachmentPreview();
    });

    item.appendChild(info);
    item.appendChild(removeButton);

    preview.appendChild(item);
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


/* =========================================
   TEXTAREA
   ========================================= */

function resizeTextarea(textarea) {
  textarea.style.height = "auto";

  textarea.style.height =
    Math.min(textarea.scrollHeight, 180) + "px";
}


/* =========================================
   MOBILE SIDEBAR
   ========================================= */

function openMobileSidebar() {
  const sidebar = $("#sidebar");

  if (!sidebar) return;

  sidebar.classList.add("open");

  let overlay = $("#sidebarOverlay");

  if (overlay) {
    overlay.classList.remove("hidden");
  }
}

function closeMobileSidebar() {
  $("#sidebar")?.classList.remove("open");
  $("#sidebarOverlay")?.classList.add("hidden");
}


/* =========================================
   THEME
   ========================================= */

function applyTheme() {
  document.body.classList.toggle(
    "light-theme",
    state.theme === "light"
  );

  localStorage.setItem("nexus-theme", state.theme);
}

function toggleTheme() {
  state.theme =
    state.theme === "dark" ? "light" : "dark";

  applyTheme();

  showToast(
    `${state.theme === "dark" ? "Dark" : "Light"} theme enabled.`,
    "success"
  );
}


/* =========================================
   MODEL SELECTOR
   ========================================= */

function setModel(model) {
  state.currentModel = model;

  const label = $("#selectedModel");    if (label) { label.textContent = model; }    $$(".model-option").forEach(option => {
    const selected =
      option.dataset.model === model;

    option.classList.toggle("selected", selected);
    option.setAttribute(
      "aria-pressed",
      String(selected)
    );
  });

  $("#modelDropdown")?.classList.add("hidden");
}


/* =========================================
   AUTH MODAL UI
   ========================================= */

function openAuthModal(tab = "login") {
  const modal = $("#authModal");

  if (!modal) {
    showToast("Authentication modal not found in HTML.", "error");
    return;
  }

  modal.classList.remove("hidden");
  setAuthTab(tab);
}

function closeAuthModal() {
  $("#authModal")?.classList.add("hidden"); }  function setAuthTab(tab) { const signup = tab === "signup";    $$(".auth-tab").forEach(button => {
    const active =
      button.id === (signup ? "signupTab" : "loginTab");

    button.classList.toggle("active", active);
    button.setAttribute(
      "aria-selected",
      String(active)
    );
  });

  const heading = $("#authTitle");
  const submit = $("#authSubmitBtn");
  const nameField = $("#nameField");

  if (heading) {
    heading.innerHTML = signup
      ? "Create your <span>account.</span>"
      : "Your ideas, <span>unlimited.</span>";
  }

  if (submit) {
    submit.innerHTML = signup
      ? "Create account <span>→</span>"
      : "Continue <span>→</span>";
  }

  nameField?.classList.toggle("hidden", !signup);
}


/* =========================================
   AUTH API & LOGIN HANDLERS
   ========================================= */

async function submitAuth(event) {
  event.preventDefault();

  const isSignup = !$("#nameField")?.classList.contains("hidden");
  const email = $("#authEmail")?.value.trim();
  const password = $("#authPassword")?.value;
  const name = $("#authName")?.value.trim();

  const endpoint = isSignup ? "/auth/signup" : "/auth/login";
  const payload = isSignup ? { email, password, name } : { email, password };

  try {
    const result = await apiRequest(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    state.user = result.user;
    updateUserUI();
    closeAuthModal();
    showToast(result.message || "Authentication successful.", "success");
  } catch (error) {
    const errorEl = $("#authError");
    if (errorEl) errorEl.textContent = error.message;
    showToast(error.message, "error");
  }
}

function handleGoogleLogin() {
  window.location.href = `${API_BASE}/auth/google`;
}

async function checkAuthSession() {
  try {
    const result = await apiRequest("/auth/me", { method: "GET" });
    if (result && result.user) {
      state.user = result.user;
      updateUserUI();
    }
  } catch (error) {
    console.warn("Not logged in.", error);
  }
}

function updateUserUI() {
  const profileName = $("#profileName");
  const profileStatus = $("#profileStatus");
  const profileAvatar = $("#profileAvatar");
  const loginBtn = $("#loginOpenBtn");
  const signupBtn = $("#signupOpenBtn");

  if (state.user) {
    if (profileName) profileName.textContent = state.user.name;
    if (profileStatus) profileStatus.textContent = state.user.email;
    if (profileAvatar) profileAvatar.textContent = state.user.name.charAt(0).toUpperCase();
    if (loginBtn) loginBtn.classList.add("hidden");
    if (signupBtn) {
      signupBtn.textContent = "Log out";
      signupBtn.onclick = async () => {
        try {
          await apiRequest("/auth/logout", { method: "POST" });
          state.user = null;
          updateUserUI();
          showToast("Logged out successfully.", "success");
          window.location.reload();
        } catch (e) {
          showToast("Logout failed.", "error");
        }
      };
    }
  }
}


/* =========================================
   CONNECTION STATUS
   ========================================= */

async function checkBackend() {
  const dot = $("#connectionDot");
  const text = $("#connectionText");

  if (!dot) return;

  try {
    const response = await fetch(
      `${API_BASE}/health`,
      { method: "GET" }
    );

    const ok = response.ok;
    dot.classList.toggle("online", ok);
    dot.classList.toggle("offline", !ok);
    if (text) text.textContent = ok ? "Online" : "Offline";
  } catch {
    dot.classList.remove("online");
    dot.classList.add("offline");
    if (text) text.textContent = "Offline";
  }
}


/* =========================================
   WORKSPACE TAB NAVIGATION
   ========================================= */

function switchWorkspace(target) {
  const chatWs = $("#chatWorkspace");
  const filesWs = $("#filesWorkspace");
  const exploreWs = $("#exploreWorkspace");

  const chatNav = $("#chatNavBtn");
  const filesNav = $("#filesNavBtn");
  const exploreNav = $("#exploreNavBtn");

  [chatWs, filesWs, exploreWs].forEach(el => el?.classList.add("hidden"));
  [chatNav, filesNav, exploreNav].forEach(el => el?.classList.remove("active"));

  if (target === "chat") {
    chatWs?.classList.remove("hidden");
    chatNav?.classList.add("active");
  } else if (target === "files") {
    filesWs?.classList.remove("hidden");
    filesNav?.classList.add("active");
  } else if (target === "explore") {
    exploreWs?.classList.remove("hidden");
    exploreNav?.classList.add("active");
  }
  closeMobileSidebar();
}


/* =========================================
   EVENT LISTENERS
   ========================================= */

function bindEvents() {
  $("#sendBtn")?.addEventListener("click", sendMessage);

  $("#messageInput")?.addEventListener(
    "input",
    event => resizeTextarea(event.target)
  );

  $("#messageInput")?.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        sendMessage();
      }
    }
  );

  $("#newChatBtn")?.addEventListener("click", () => {
    createConversation();
    switchWorkspace("chat");
    closeMobileSidebar();
    $("#messageInput")?.focus();
  });

  $("#openSidebar")?.addEventListener(
    "click",
    openMobileSidebar
  );

  $("#closeSidebar")?.addEventListener(
    "click",
    closeMobileSidebar
  );

  $("#sidebarOverlay")?.addEventListener(
    "click",
    closeMobileSidebar
  );

  $("#attachBtn")?.addEventListener("click", () => {
    getFileInput()?.click();
  });

  getFileInput()?.addEventListener(
    "change",
    handleFileSelection
  );

  $("#webSearchBtn")?.addEventListener("click", event => {
    state.searchEnabled = !state.searchEnabled;

    event.currentTarget.setAttribute(
      "aria-pressed",
      String(state.searchEnabled)
    );

    showToast(
      state.searchEnabled
        ? "Search mode selected."
        : "Search mode disabled."
    );
  });

  $("#themeToggleBtn")?.addEventListener("click", toggleTheme);

  $("#loginOpenBtn")?.addEventListener(
    "click",
    () => openAuthModal("login")
  );

  $("#signupOpenBtn")?.addEventListener(
    "click",
    () => {
      if (!state.user) {
        openAuthModal("signup");
      }
    }
  );

  $("#authCloseBtn")?.addEventListener(
    "click",
    closeAuthModal
  );

  $("#authModal")?.addEventListener(
    "click",
    event => {
      if (event.target === event.currentTarget) {
        closeAuthModal();
      }
    }
  );

  $("#loginTab")?.addEventListener("click", () => setAuthTab("login"));
  $("#signupTab")?.addEventListener("click", () => setAuthTab("signup"));

  $("#authForm")?.addEventListener(
    "submit",
    submitAuth
  );

  $("#googleLoginBtn")?.addEventListener(
    "click",
    handleGoogleLogin
  );

  $("#modelSelector")?.addEventListener(
    "click",
    () => {
      $("#modelDropdown")?.classList.toggle("hidden"); } );    $$(".model-option").forEach(option => {
    option.addEventListener("click", () => {
      if (option.dataset.model) {
        setModel(option.dataset.model);
      }
    });
  });

  // Navigation views
  $("#chatNavBtn")?.addEventListener("click", () => switchWorkspace("chat"));
  $("#filesNavBtn")?.addEventListener("click", () => switchWorkspace("files"));
  $("#exploreNavBtn")?.addEventListener("click", () => switchWorkspace("explore"));

  document.addEventListener("click", event => {
    const dropdown = $("#modelDropdown");
    const selector = $("#modelSelector");

    if (
      dropdown &&
      selector &&
      !dropdown.contains(event.target) &&
      !selector.contains(event.target)
    ) {
      dropdown.classList.add("hidden");
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeAuthModal();
      closeMobileSidebar();
      $("#modelDropdown")?.classList.add("hidden"); } });    $$(".suggestion-card, .explore-card").forEach(card => {
    card.addEventListener("click", () => {
      const prompt = card.dataset.prompt;

      if (!prompt) return;

      const input = $("#messageInput");

      if (input) {
        input.value = prompt;
        resizeTextarea(input);
        input.focus();
      }

      switchWorkspace("chat");
    });
  });
}


/* =========================================
   STARTUP
   ========================================= */

function initNexus() {
  applyTheme();
  loadConversations();
  bindEvents();
  setModel(state.currentModel);
  checkBackend();
  checkAuthSession();

  window.setInterval(checkBackend, 60000);
}

document.addEventListener("DOMContentLoaded", initNexus);
