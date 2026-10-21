"use strict";

/* =========================================================
   NEXUS AI — PREMIUM APPLICATION CONTROLLER
   Compatible with the supplied index.html and style.css
   ========================================================= */

/* =========================
   01. CONFIGURATION
   ========================= */

const NEXUS_CONFIG = window.NEXUS_CONFIG || {};

const API_BASE = "https://nexus-ai-11-irgz.onrender.com";

const ENDPOINTS = {
    chat: NEXUS_CONFIG.endpoints?.chat || "/chat",
    upload: NEXUS_CONFIG.endpoints?.upload || "/upload",
    health: NEXUS_CONFIG.endpoints?.health || "/health",
    image: NEXUS_CONFIG.endpoints?.image || "/generate-image",
    login: NEXUS_CONFIG.endpoints?.login || "/api/login",
    signup: NEXUS_CONFIG.endpoints?.signup || "/api/signup",
    logout: NEXUS_CONFIG.endpoints?.logout || "/api/logout",
    me: NEXUS_CONFIG.endpoints?.me || "/api/me"
};

const LIMITS = {
    maxMessageLength: 12000,
    maxFiles: 5,
    maxFileSize: 10 * 1024 * 1024,
    requestTimeout: 120000,
    historyLimit: 50
};

const STORAGE = {
    history: "nexus-history",
    theme: "nexus-theme",
    activeChat: "nexus-active-chat",
    selectedModel: "nexus-selected-model",
    user: "nexus-user"
};

const MODEL_CONFIG = {
    standard: {
        label: "NEXUS Standard",
        model: "Qwen/Qwen2.5-0.5B-Instruct"
    },

    creative: {
        label: "NEXUS Creative",
        model: "Qwen/Qwen2.5-0.5B-Instruct"
    },

    coding: {
        label: "NEXUS Coding",
        model: "Qwen/Qwen2.5-0.5B-Instruct"
    }
};

const state = {
    conversations: [],
    activeChatId: null,
    selectedModel: "standard",
    attachments: [],
    isSending: false,
    isUploading: false,
    isRecording: false,
    authMode: "login",
    user: null,
    abortController: null
};


/* =========================
   02. DOM UTILITIES
   ========================= */

const $ = (selector, root = document) =>
    root.querySelector(selector);

const $$ = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

function getElement(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const element = getElement(id);

    if (element) {
        element.textContent = String(value ?? "");
    }
}

function showElement(element) {
    if (!element) return;

    element.hidden = false;
    element.classList.remove("hidden", "is-hidden");
}

function hideElement(element) {
    if (!element) return;

    element.hidden = true;
}

function safeJSON(value, fallback) {
    try {
        return JSON.parse(value) ?? fallback;
    } catch {
        return fallback;
    }
}

function makeId() {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }

    return (
        Date.now().toString(36) +
        Math.random().toString(36).slice(2)
    );
}

function escapeHTML(value) {
    return String(value ?? "").replace(
        /[&<>"']/g,
        character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]
    );
}

function formatTime(timestamp = Date.now()) {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getEndpoint(path) {
    return new URL(path, API_BASE).toString();
}


/* =========================
   03. STORAGE
   ========================= */

function loadHistory() {
    const saved = safeJSON(
        localStorage.getItem(STORAGE.history),
        []
    );

    state.conversations = Array.isArray(saved)
        ? saved
        : [];

    state.conversations = state.conversations
        .filter(chat =>
            chat &&
            typeof chat.id === "string" &&
            Array.isArray(chat.messages)
        )
        .slice(0, LIMITS.historyLimit);
}

function saveHistory() {
    try {
        localStorage.setItem(
            STORAGE.history,
            JSON.stringify(
                state.conversations.slice(
                    0,
                    LIMITS.historyLimit
                )
            )
        );
    } catch (error) {
        console.warn("Could not save chat history:", error);

        showToast(
            "Storage full",
            "পুরোনো chat মুছে কিছু জায়গা খালি করো।",
            "warning"
        );
    }
}

function loadPreferences() {
    const theme = localStorage.getItem(STORAGE.theme);

    applyTheme(theme === "light" ? "light" : "dark");

    const model = localStorage.getItem(
        STORAGE.selectedModel
    );

    if (MODEL_CONFIG[model]) {
        state.selectedModel = model;
    }

    updateSelectedModel();
}

function savePreferences() {
    try {
        localStorage.setItem(
            STORAGE.selectedModel,
            state.selectedModel
        );
    } catch (error) {
        console.warn("Preference save failed:", error);
    }
}


/* =========================
   04. NOTIFICATIONS
   ========================= */

function showToast(
    title,
    message = "",
    type = "info",
    duration = 3500
) {
    const container = getElement("toastContainer");

    if (!container) {
        console.log(`[NEXUS] ${title}: ${message}`);
        return;
    }

    const toast = document.createElement("div");

    toast.className = `toast toast-${type}`;

    const heading = document.createElement("strong");
    heading.textContent = title;

    const description = document.createElement("p");
    description.textContent = message;

    toast.append(heading);

    if (message) {
        toast.append(description);
    }

    container.append(toast);

    window.setTimeout(() => {
        toast.classList.add("toast-removing");

        window.setTimeout(() => toast.remove(), 250);
    }, duration);
}


/* =========================
   05. LOADING INDICATOR
   ========================= */

function setLoading(
    active,
    title = "NEXUS is working...",
    description = "Please wait a moment."
) {
    const overlay = getElement("loadingOverlay");

    if (!overlay) return;

    if (active) {
        setText("loadingTitle", title);
        setText("loadingDescription", description);

        showElement(overlay);
    } else {
        hideElement(overlay);
    }
}


/* =========================
   06. BACKEND REQUESTS
   ========================= */

async function apiRequest(
    path,
    options = {},
    timeout = LIMITS.requestTimeout
) {
    const controller = new AbortController();

    const timer = window.setTimeout(
        () => controller.abort(),
        timeout
    );

    try {
        const response = await fetch(getEndpoint(path), {
            ...options,
            signal: controller.signal,
            credentials: "include",
            headers: {
                Accept: "application/json",
                ...(options.body instanceof FormData
                    ? {}
                    : { "Content-Type": "application/json" }),
                ...options.headers
            }
        });

        const contentType =
            response.headers.get("content-type") || "";

        let data;

        if (contentType.includes("application/json")) {
            data = await response.json();
        } else {
            data = await response.text();
        }

        if (!response.ok) {
            const message =
                typeof data === "object"
                    ? data.error || data.message
                    : data;

            throw new Error(
                message || `HTTP error ${response.status}`
            );
        }

        return data;
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error(
                "Request timed out. আবার চেষ্টা করো।"
            );
        }

        throw error;
    } finally {
        clearTimeout(timer);
    }
}


/* =========================
   07. CONNECTION STATUS
   ========================= */

async function checkConnection() {
    const dot = getElement("connectionDot");
    const label = getElement("connectionText");

    if (label) {
        label.textContent = "Connecting...";
    }

    if (dot) {
        dot.className = "connection-dot";
    }

    try {
        await apiRequest(
            ENDPOINTS.health,
            { method: "GET" },
            15000
        );

        if (dot) {
            dot.className = "connection-dot online";
        }

        if (label) {
            label.textContent = "Connected";
        }

        return true;
    } catch (error) {
        console.warn("Backend unavailable:", error.message);

        if (dot) {
            dot.className = "connection-dot offline";
        }

        if (label) {
            label.textContent = "Offline";
        }

        return false;
    }
}


/* =========================
   08. CONVERSATION MANAGEMENT
   ========================= */

function createConversation() {
    const chat = {
        id: makeId(),
        title: "New chat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: []
    };

    state.conversations.unshift(chat);

    state.activeChatId = chat.id;

    saveHistory();
    renderConversationList();
    renderMessages();

    return chat;
}

function getActiveConversation() {
    return state.conversations.find(
        chat => chat.id === state.activeChatId
    ) || null;
}

function ensureConversation() {
    return getActiveConversation() ||
        createConversation();
}

function setActiveConversation(id) {
    const chat = state.conversations.find(
        item => item.id === id
    );

    if (!chat) return;

    state.activeChatId = id;

    try {
        localStorage.setItem(
            STORAGE.activeChat,
            id
        );
    } catch {}

    renderConversationList();
    renderMessages();

    showChatPage();
}

function updateConversationTitle(chat, text) {
    if (!chat || chat.title !== "New chat") return;

    const title = text
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 48);

    chat.title = title || "New chat";
}

function deleteConversation(id) {
    const chat = state.conversations.find(
        item => item.id === id
    );

    if (!chat) return;

    if (!window.confirm("এই conversation মুছে ফেলবে?")) {
        return;
    }

    state.conversations =
        state.conversations.filter(
            item => item.id !== id
        );

    if (state.activeChatId === id) {
        state.activeChatId = null;
    }

    saveHistory();
    renderConversationList();
    renderMessages();

    showToast(
        "Conversation deleted",
        "Chat history থেকে conversation মুছে গেছে।",
        "success"
    );
}

function clearAllHistory() {
    if (!state.conversations.length) {
        showToast("No history", "মোছার মতো chat নেই।");
        return;
    }

    if (!window.confirm(
        "সব local conversation মুছে ফেলবে?"
    )) {
        return;
    }

    state.conversations = [];
    state.activeChatId = null;

    saveHistory();

    try {
        localStorage.removeItem(STORAGE.activeChat);
    } catch {}

    renderConversationList();
    renderMessages();

    showToast(
        "History cleared",
        "Local chat history মুছে গেছে।",
        "success"
    );
}


/* =========================
   09. CONVERSATION SIDEBAR
   ========================= */

function renderConversationList(filter = "") {
    const container = getElement("conversationList");

    if (!container) return;

    container.replaceChildren();

    const query = filter.trim().toLowerCase();

    const chats = state.conversations.filter(chat => {
        if (!query) return true;

        return (
            chat.title.toLowerCase().includes(query) ||
            chat.messages.some(message =>
                String(message.content || "")
                    .toLowerCase()
                    .includes(query)
            )
        );
    });

    if (!chats.length) {
        const empty = document.createElement("div");

        empty.className = "empty-history";

        empty.textContent = query
            ? "কোনো matching conversation পাওয়া যায়নি।"
            : "Your conversations appear here.";

        container.append(empty);

        return;
    }

    chats.forEach(chat => {
        const row = document.createElement("div");

        row.className = "conversation-item";

        if (chat.id === state.activeChatId) {
            row.classList.add("active");
        }

        const title = document.createElement("span");

        title.className = "conversation-title";
        title.textContent = chat.title;

        const openButton = document.createElement("button");

        openButton.type = "button";
        openButton.className = "conversation-open";
        openButton.setAttribute(
            "aria-label",
            `Open ${chat.title}`
        );

        openButton.style.cssText =
            "display:flex;align-items:center;gap:8px;" +
            "min-width:0;flex:1;text-align:left;";

        openButton.textContent = "◷";
        openButton.append(title);

        openButton.addEventListener("click", () => {
            setActiveConversation(chat.id);
        });

        const deleteButton = document.createElement("button");

        deleteButton.type = "button";
        deleteButton.className = "conversation-delete";
        deleteButton.textContent = "×";
        deleteButton.setAttribute(
            "aria-label",
            "Delete conversation"
        );

        deleteButton.addEventListener("click", event => {
            event.stopPropagation();
            deleteConversation(chat.id);
        });

        row.append(openButton, deleteButton);

        container.append(row);
    });
}


/* =========================
   10. CHAT MESSAGE RENDERING
   ========================= */

function renderMessages() {
    const list = getElement("messagesList");
    const welcome = getElement("welcomeScreen");
    const container = getElement("messagesContainer");

    if (!list) return;

    list.replaceChildren();

    const chat = getActiveConversation();

    if (!chat || !chat.messages.length) {
        if (welcome) showElement(welcome);

        if (container) hideElement(container);

        updateSendButton();

        return;
    }

    if (welcome) hideElement(welcome);

    if (container) showElement(container);

    chat.messages.forEach(message => {
        list.append(
            createMessageElement(message)
        );
    });

    scrollMessagesToBottom();
    updateSendButton();
}

function createMessageElement(message) {
    const article = document.createElement("article");

    article.className =
        `message message-${message.role}`;

    const avatar = document.createElement("div");

    avatar.className = "message-avatar";

    avatar.textContent =
        message.role === "user" ? "E" : "N";

    const content = document.createElement("div");

    content.className = "message-content";

    const header = document.createElement("div");

    header.className = "message-header";

    const author = document.createElement("strong");

    author.textContent =
        message.role === "user"
            ? (state.user?.name || "You")
            : "NEXUS AI";

    const time = document.createElement("time");

    time.textContent = formatTime(
        message.timestamp || Date.now()
    );

    header.append(author, time);

    const body = document.createElement("div");

    body.className = "message-body";

    // Plain text rendering prevents injected HTML from executing.
    body.textContent = message.content || "";

    content.append(header, body);

    if (message.files?.length) {
        const fileList = document.createElement("div");

        fileList.className = "message-file-list";

        message.files.forEach(file => {
            const chip = document.createElement("span");

            chip.className = "message-file-chip";

            chip.textContent =
                `📎 ${file.name || "Attached file"}`;

            fileList.append(chip);
        });

        content.append(fileList);
    }

    const actions = document.createElement("div");

    actions.className = "message-actions";

    if (message.role === "assistant") {
        const copy = document.createElement("button");

        copy.type = "button";
        copy.className = "message-action-button";
        copy.textContent = "Copy";

        copy.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(
                    message.content || ""
                );

                showToast(
                    "Copied",
                    "উত্তর clipboard-এ কপি হয়েছে।",
                    "success"
                );
            } catch {
                showToast(
                    "Copy unavailable",
                    "এই browser-এ clipboard permission নেই।",
                    "warning"
                );
            }
        });

        actions.append(copy);
    }

    content.append(actions);

    article.append(avatar, content);

    return article;
}

function scrollMessagesToBottom() {
    const container = getElement("messagesContainer");

    if (!container) return;

    requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
    });
}

function addMessage(role, content, files = []) {
    const chat = ensureConversation();

    const message = {
        id: makeId(),
        role,
        content: String(content || ""),
        timestamp: Date.now(),
        files: files.map(file => ({
            name: file.name,
            size: file.size,
            type: file.type
        }))
    };

    chat.messages.push(message);

    chat.updatedAt = Date.now();

    if (role === "user") {
        updateConversationTitle(chat, content);
    }

    saveHistory();
    renderConversationList();

    const list = getElement("messagesList");
    const welcome = getElement("welcomeScreen");
    const container = getElement("messagesContainer");

    if (welcome) hideElement(welcome);

    if (container) showElement(container);

    if (list) {
        list.append(
            createMessageElement(message)
        );
    }

    scrollMessagesToBottom();

    return message;
}


/* =========================
   11. TYPING INDICATOR
   ========================= */

function showTypingIndicator() {
    removeTypingIndicator();

    const list = getElement("messagesList");

    if (!list) return;

    const element = document.createElement("div");

    element.id = "nexusTypingIndicator";
    element.className = "message message-assistant";

    element.innerHTML = `
        <div class="message-avatar">N</div>
        <div class="message-content">
            <div class="message-header">
                <strong>NEXUS AI</strong>
            </div>
            <div class="message-body">
                <span class="typing-dots"
                      aria-label="NEXUS is responding">
                    <span>●</span>
                    <span>●</span>
                    <span>●</span>
                </span>
            </div>
        </div>
    `;

    list.append(element);

    scrollMessagesToBottom();
}

function removeTypingIndicator() {
    getElement("nexusTypingIndicator")?.remove();
}


/* =========================
   12. CHAT API
   ========================= */

function extractAssistantText(data) {
    if (typeof data === "string") {
        return data;
    }

    if (!data || typeof data !== "object") {
        return "";
    }

    const candidates = [
        data.reply,
        data.response,
        data.answer,
        data.message,
        data.output,
        data.content,
        data.result
    ];

    for (const value of candidates) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }

    if (Array.isArray(data.choices)) {
        const choice = data.choices[0];

        const content =
            choice?.message?.content ??
            choice?.text;

        if (typeof content === "string") {
            return content.trim();
        }
    }

    return "";
}

async function sendChatMessage(text = null) {
    if (state.isSending) return;

    const input = getElement("messageInput");

    const message = String(
        text ?? input?.value ?? ""
    ).trim();

    if (!message && !state.attachments.length) {
        return;
    }

    if (message.length > LIMITS.maxMessageLength) {
        showToast(
            "Message too long",
            "Message-এর দৈর্ঘ্য সীমার মধ্যে রাখো।",
            "warning"
        );

        return;
    }

    const files = [...state.attachments];

    state.isSending = true;

    state.abortController = new AbortController();

    if (input) {
        input.value = "";
        input.style.height = "auto";
    }

    updateCharacterCounter();
    updateSendButton();

    addMessage(
        "user",
        message || "ফাইলটি বিশ্লেষণ করো।",
        files
    );

    clearAttachments();

    showTypingIndicator();

    const sendButton = getElement("sendButton");

    if (sendButton) {
        sendButton.disabled = true;
    }

    try {
        /*
         * File upload is a separate API request.
         * The backend must return a response compatible
         * with the chat endpoint if uploaded files are
         * expected to affect the model's answer.
         */

        let uploadedFiles = [];

        if (files.length) {
            uploadedFiles = await uploadFiles(files, false);
        }

        const payload = {
            message:
                message || "সংযুক্ত ফাইল বিশ্লেষণ করো।",

            model: MODEL_CONFIG[state.selectedModel].model,

            mode: state.selectedModel,

            files: uploadedFiles
        };

        const controller = state.abortController;

        const timeout = window.setTimeout(
            () => controller?.abort(),
            LIMITS.requestTimeout
        );

        let data;

        try {
            const response = await fetch(
                getEndpoint(ENDPOINTS.chat),
                {
                    method: "POST",
                    credentials: "include",
                    signal: controller.signal,
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json"
                    },
                    body: JSON.stringify(payload)
                }
            );

            const contentType =
                response.headers.get("content-type") || "";

            data = contentType.includes("application/json")
                ? await response.json()
                : await response.text();

            if (!response.ok) {
                const errorMessage =
                    typeof data === "object"
                        ? data.error || data.message
                        : data;

                throw new Error(
                    errorMessage ||
                    `Server returned ${response.status}`
                );
            }
        } finally {
            clearTimeout(timeout);
        }

        const answer = extractAssistantText(data);

        if (!answer) {
            throw new Error(
                "Backend থেকে উত্তর পাওয়া যায়নি। " +
                "Flask /chat endpoint-এর response format পরীক্ষা করো।"
            );
        }

        removeTypingIndicator();

        addMessage("assistant", answer);

    } catch (error) {
        removeTypingIndicator();

        let message = error.message;

        if (
            error.name === "AbortError"
        ) {
            message = "Request বাতিল হয়েছে বা সময় শেষ হয়েছে।";
        } else if (
            error instanceof TypeError
        ) {
            message =
                "Backend-এর সঙ্গে সংযোগ হয়নি। " +
                "Render service, CORS এবং backend URL পরীক্ষা করো।";
        }

        addMessage(
            "assistant",
            `দুঃখিত, উত্তর পাওয়া যায়নি।\n\n${message}`
        );

        console.error("Chat request failed:", error);

    } finally {
        state.isSending = false;
        state.abortController = null;

        removeTypingIndicator();

        updateSendButton();
        updateCharacterCounter();
    }
}


/* =========================
   13. FILE ATTACHMENTS
   ========================= */

function validateFile(file) {
    if (file.size > LIMITS.maxFileSize) {
        return "প্রতিটি ফাইল সর্বোচ্চ 10 MB হতে পারবে।";
    }

    const allowedExtensions = [
        "pdf", "txt", "md", "csv", "json",
        "png", "jpg", "jpeg", "webp"
    ];

    const extension =
        file.name.split(".").pop().toLowerCase();

    if (!allowedExtensions.includes(extension)) {
        return "এই file format support করা হচ্ছে না।";
    }

    return null;
}

function addAttachments(fileList) {
    const files = [...fileList];

    for (const file of files) {
        const error = validateFile(file);

        if (error) {
            showToast("Invalid file", error, "warning");
            continue;
        }

        if (state.attachments.length >= LIMITS.maxFiles) {
            showToast(
                "File limit reached",
                "একসঙ্গে সর্বোচ্চ 5টি ফাইল নির্বাচন করো।",
                "warning"
            );

            break;
        }

        const duplicate = state.attachments.some(
            item =>
                item.name === file.name &&
                item.size === file.size &&
                item.lastModified === file.lastModified
        );

        if (!duplicate) {
            state.attachments.push(file);
        }
    }

    renderAttachmentPreview();
}

function renderAttachmentPreview() {
    const container = getElement("attachmentPreview");

    if (!container) return;

    container.replaceChildren();

    if (!state.attachments.length) {
        hideElement(container);
        return;
    }

    showElement(container);

    state.attachments.forEach((file, index) => {
        const card = document.createElement("div");

        card.className = "attachment-item";

        const info = document.createElement("div");

        info.className = "attachment-information";

        const name = document.createElement("strong");

        name.textContent = file.name;

        const size = document.createElement("small");

        size.textContent = formatBytes(file.size);

        info.append(name, size);

        const remove = document.createElement("button");

        remove.type = "button";
        remove.textContent = "×";
        remove.className = "attachment-remove";

        remove.setAttribute(
            "aria-label",
            `Remove ${file.name}`
        );

        remove.addEventListener("click", () => {
            state.attachments.splice(index, 1);
            renderAttachmentPreview();
            updateSendButton();
        });

        card.append(info, remove);

        container.append(card);
    });

    updateSendButton();
}

function clearAttachments() {
    state.attachments = [];

    const input = getElement("fileInput");

    if (input) input.value = "";

    renderAttachmentPreview();
}

async function uploadFiles(files, showNotifications = true) {
    if (!files.length) return [];

    if (state.isUploading) {
        throw new Error("একটি upload ইতিমধ্যেই চলছে।");
    }

    state.isUploading = true;

    const results = [];

    try {
        for (const file of files) {
            const error = validateFile(file);

            if (error) {
                throw new Error(error);
            }

            const formData = new FormData();

            /*
             * The backend must expect the field name "file".
             * If app.py uses a different key, update it here.
             */

            formData.append("file", file);

            const result = await apiRequest(
                ENDPOINTS.upload,
                {
                    method: "POST",
                    body: formData
                }
            );

            results.push({
                name: file.name,
                size: file.size,
                type: file.type,
                result
            });
        }

        if (showNotifications) {
            showToast(
                "Upload complete",
                `${results.length}টি ফাইল upload হয়েছে।`,
                "success"
            );
        }

        return results;

    } catch (error) {
        if (showNotifications) {
            showToast(
                "Upload failed",
                error.message,
                "error"
            );
        }

        throw error;

    } finally {
        state.isUploading = false;
    }
}


/* =========================
   14. MY FILES PAGE
   ========================= */

function renderFileLibrary() {
    const container = getElement("fileLibrary");

    if (!container) return;

    container.replaceChildren();

    if (!state.attachments.length) {
        const empty = document.createElement("div");

        empty.className = "file-library-empty";

        const icon = document.createElement("span");
        icon.textContent = "▤";

        const heading = document.createElement("strong");
        heading.textContent = "No files selected";

        const paragraph = document.createElement("p");

        paragraph.textContent =
            "Chat থেকে PDF, text অথবা supported file attach করো।";

        const button = document.createElement("button");

        button.type = "button";
        button.className = "primary-button";
        button.textContent = "Go to chat";

        button.addEventListener("click", showChatPage);

        empty.append(icon, heading, paragraph, button);

        container.append(empty);

        return;
    }

    state.attachments.forEach(file => {
        const item = document.createElement("div");

        item.className = "file-library-item";

        const name = document.createElement("strong");
        name.textContent = file.name;

        const size = document.createElement("p");
        size.textContent = formatBytes(file.size);

        item.append(name, size);

        container.append(item);
    });
}


/* =========================
   15. CHAT INPUT CONTROLS
   ========================= */

function updateSendButton() {
    const input = getElement("messageInput");
    const button = getElement("sendButton");

    if (!button) return;

    const hasText = Boolean(input?.value.trim());

    const hasFiles = state.attachments.length > 0;

    button.disabled =
        state.isSending ||
        (!hasText && !hasFiles);
}

function updateCharacterCounter() {
    const input = getElement("messageInput");

    const counter = getElement("characterCounter");

    if (!input || !counter) return;

    counter.textContent =
        `${input.value.length} / ${LIMITS.maxMessageLength}`;
}

function autoResizeTextarea() {
    const input = getElement("messageInput");

    if (!input) return;

    input.style.height = "auto";

    input.style.height =
        `${Math.min(input.scrollHeight, 200)}px`;
}

function bindChatInput() {
    const input = getElement("messageInput");

    const form = getElement("chatForm");

    if (input) {
        input.addEventListener("input", () => {
            autoResizeTextarea();
            updateCharacterCounter();
            updateSendButton();
        });

        input.addEventListener("keydown", event => {
            if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.isComposing
            ) {
                event.preventDefault();

                if (!state.isSending) {
                    form?.requestSubmit();
                }
            }
        });
    }

    if (form) {
        form.addEventListener("submit", event => {
            event.preventDefault();

            sendChatMessage();
        });
    }
}


/* =========================
   16. VOICE INPUT
   ========================= */

let recognition = null;

function setupVoiceInput() {
    const button = getElement("voiceButton");

    if (!button) return;

    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        button.addEventListener("click", () => {
            showToast(
                "Voice input unavailable",
                "এই browser-এ speech recognition support নেই।",
                "warning"
            );
        });

        return;
    }

    recognition = new SpeechRecognition();

    recognition.lang = "bn-IN";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
        state.isRecording = true;

        button.classList.add("recording");

        button.setAttribute(
            "aria-pressed",
            "true"
        );

        showToast(
            "Listening",
            "এখন কথা বলো।",
            "info",
            1800
        );
    };

    recognition.onresult = event => {
        const input = getElement("messageInput");

        if (!input) return;

        let transcript = "";

        for (
            let index = event.resultIndex;
            index < event.results.length;
            index++
        ) {
            transcript +=
                event.results[index][0].transcript;
        }

        input.value = transcript;

        autoResizeTextarea();
        updateCharacterCounter();
        updateSendButton();
    };

    recognition.onerror = event => {
        console.warn("Speech recognition:", event.error);

        showToast(
            "Voice input error",
            "Microphone permission এবং internet connection পরীক্ষা করো।",
            "warning"
        );
    };

    recognition.onend = () => {
        state.isRecording = false;

        button.classList.remove("recording");

        button.setAttribute(
            "aria-pressed",
            "false"
        );
    };

    button.addEventListener("click", () => {
        try {
            if (state.isRecording) {
                recognition.stop();
            } else {
                recognition.start();
            }
        } catch (error) {
            console.warn(error);
        }
    });
}


/* =========================
   17. THEME MANAGEMENT
   ========================= */

function applyTheme(theme) {
    const selected =
        theme === "light" ? "light" : "dark";

    document.documentElement.dataset.theme = selected;

    document.body.dataset.theme = selected;

    document.body.classList.toggle(
        "light",
        selected === "light"
    );

    document.body.classList.toggle(
        "light-theme",
        selected === "light"
    );

    try {
        localStorage.setItem(
            STORAGE.theme,
            selected
        );
    } catch {}

    const darkMode = selected === "dark";

    const toggle = getElement("settingsThemeToggle");

    if (toggle) {
        toggle.setAttribute(
            "aria-checked",
            String(darkMode)
        );
    }

    const button = getElement("themeButton");

    if (button) {
        button.textContent = darkMode ? "☼" : "☾";
    }
}

function toggleTheme() {
    const current =
        document.documentElement.dataset.theme ||
        "dark";

    applyTheme(
        current === "dark" ? "light" : "dark"
    );
}


/* =========================
   18. MODEL SELECTOR
   ========================= */

function updateSelectedModel() {
    const model = MODEL_CONFIG[state.selectedModel];

    if (!model) return;

    setText("selectedModelName", model.label);

    $$(".model-option").forEach(button => {
        const selected =
            button.dataset.model === state.selectedModel;

        button.classList.toggle("selected", selected);
    });

    savePreferences();
}

function bindModelSelector() {
    const selector = getElement("modelSelector");

    const dropdown = getElement("modelDropdown");

    if (!selector || !dropdown) return;

    selector.addEventListener("click", () => {
        const open =
            selector.getAttribute("aria-expanded") === "true";

        selector.setAttribute(
            "aria-expanded",
            String(!open)
        );

        if (open) {
            hideElement(dropdown);
        } else {
            showElement(dropdown);
        }
    });

    $$(".model-option").forEach(button => {
        button.addEventListener("click", () => {
            const model = button.dataset.model;

            if (!MODEL_CONFIG[model]) return;

            state.selectedModel = model;

            updateSelectedModel();

            selector.setAttribute(
                "aria-expanded",
                "false"
            );

            hideElement(dropdown);

            showToast(
                "Model selected",
                MODEL_CONFIG[model].label,
                "success"
            );
        });
    });
}


/* =========================
   19. NAVIGATION
   ========================= */

function closeSidebar() {
    const sidebar = getElement("sidebar");

    const overlay = getElement("mobileOverlay");

    sidebar?.classList.remove("open", "active");

    overlay?.classList.remove("open", "active", "show");

    document.body.classList.remove("sidebar-open");
}

function openSidebar() {
    const sidebar = getElement("sidebar");

    const overlay = getElement("mobileOverlay");

    sidebar?.classList.add("open");

    overlay?.classList.add("active");

    document.body.classList.add("sidebar-open");
}

function showChatPage() {
    const chat = getElement("chatPage");

    const pages = [
        getElement("imageStudioPage"),
        getElement("explorePage"),
        getElement("filesPage")
    ];

    showElement(chat);

    pages.forEach(hideElement);

    $$(".navigation-item").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.view === "chat"
        );
    });

    closeSidebar();

    renderMessages();
}

function showPage(name) {
    if (name === "chat") {
        showChatPage();
        return;
    }

    const chat = getElement("chatPage");

    const imagePage = getElement("imageStudioPage");

    const explorePage = getElement("explorePage");

    const filesPage = getElement("filesPage");

    hideElement(chat);
    hideElement(imagePage);
    hideElement(explorePage);
    hideElement(filesPage);

    const pageMap = {
        images: imagePage,
        explore: explorePage,
        files: filesPage
    };

    const selectedPage = pageMap[name];

    if (selectedPage) {
        showElement(selectedPage);
    }

    $$(".navigation-item").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.view === name
        );
    });

    if (name === "files") {
        renderFileLibrary();
    }

    closeSidebar();
}

function bindNavigation() {
    getElement("newChatButton")?.addEventListener(
        "click",
        () => {
            state.activeChatId = null;

            try {
                localStorage.removeItem(
                    STORAGE.activeChat
                );
            } catch {}

            createConversation();

            showChatPage();
        }
    );

    $$(".navigation-item").forEach(button => {
        button.addEventListener("click", () => {
            showPage(button.dataset.view);
        });
    });

    getElement("exploreButton")?.addEventListener(
        "click",
        () => showPage("explore")
    );

    getElement("goToChatButton")?.addEventListener(
        "click",
        showChatPage
    );

    getElement("menuButton")?.addEventListener(
        "click",
        openSidebar
    );

    getElement("sidebarClose")?.addEventListener(
        "click",
        closeSidebar
    );

    getElement("mobileOverlay")?.addEventListener(
        "click",
        closeSidebar
    );

    getElement("themeButton")?.addEventListener(
        "click",
        toggleTheme
    );

    getElement("settingsThemeToggle")?.addEventListener(
        "click",
        toggleTheme
    );

    getElement("clearHistoryButton")?.addEventListener(
        "click",
        clearAllHistory
    );

    getElement("settingsClearHistory")?.addEventListener(
        "click",
        clearAllHistory
    );

    getElement("conversationSearch")?.addEventListener(
        "input",
        event => {
            renderConversationList(event.target.value);
        }
    );

    $$(".suggestion-card, .explore-card").forEach(button => {
        button.addEventListener("click", () => {
            const prompt = button.dataset.prompt;

            if (!prompt) return;

            showChatPage();

            const input = getElement("messageInput");

            if (input) {
                input.value = prompt;

                autoResizeTextarea();
                updateCharacterCounter();
                updateSendButton();

                input.focus();
            }
        });
    });

    getElement("uploadButton")?.addEventListener(
        "click",
        () => getElement("fileInput")?.click()
    );

    getElement("fileInput")?.addEventListener(
        "change",
        event => {
            addAttachments(event.target.files);

            event.target.value = "";
        }
    );

    getElement("imageButton")?.addEventListener(
        "click",
        () => {
            showPage("images");

            getElement("imagePrompt")?.focus();
        }
    );

    getElement("shareButton")?.addEventListener(
        "click",
        shareConversation
    );

    document.addEventListener("click", event => {
        const modelDropdown = getElement("modelDropdown");

        const modelSelector = getElement("modelSelector");

        if (
            modelDropdown &&
            modelSelector &&
            !modelDropdown.contains(event.target) &&
            !modelSelector.contains(event.target)
        ) {
            hideElement(modelDropdown);

            modelSelector.setAttribute(
                "aria-expanded",
                "false"
            );
        }

        const profile = getElement("userProfile");

        const dropdown = getElement("profileDropdown");

        const profileButton = getElement("profileButton");

        if (
            profile &&
            dropdown &&
            !profile.contains(event.target)
        ) {
            hideElement(dropdown);

            profileButton?.setAttribute(
                "aria-expanded",
                "false"
            );
        }
    });

    getElement("profileButton")?.addEventListener(
        "click",
        () => {
            const dropdown = getElement("profileDropdown");

            if (!dropdown) return;

            const open = !dropdown.hidden;

            if (open) {
                hideElement(dropdown);
            } else {
                showElement(dropdown);
            }

            getElement("profileButton")?.setAttribute(
                "aria-expanded",
                String(!open)
            );
        }
    );

    $$(".profile-dropdown [data-action]").forEach(button => {
        button.addEventListener("click", () => {
            const action = button.dataset.action;

            hideElement(getElement("profileDropdown"));

            if (action === "login") {
                openAuthModal("login");
            }

            if (action === "settings") {
                openModal("settingsModal");
            }

            if (action === "help") {
                showToast(
                    "NEXUS Help",
                    "সমস্যা হলে backend log এবং browser console পরীক্ষা করো।"
                );
            }
        });
    });

    document.addEventListener("keydown", event => {
        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "k"
        ) {
            event.preventDefault();

            getElement("newChatButton")?.click();
        }

        if (
            event.key === "/" &&
            !["INPUT", "TEXTAREA"].includes(
                document.activeElement?.tagName
            )
        ) {
            event.preventDefault();

            getElement("conversationSearch")?.focus();
        }

        if (event.key === "Escape") {
            closeSidebar();

            $$(".modal-backdrop").forEach(modal => {
                hideElement(modal);
            });
        }
    });
}


/* =========================
   20. MODAL MANAGEMENT
   ========================= */

function openModal(id) {
    const modal = getElement(id);

    if (!modal) return;

    showElement(modal);

    document.body.classList.add("modal-open");
}

function closeModal(id) {
    const modal = getElement(id);

    if (!modal) return;

    hideElement(modal);

    if (!$(".modal-backdrop:not([hidden])")) {
        document.body.classList.remove("modal-open");
    }
}

function bindModals() {
    $$("[data-close-modal]").forEach(button => {
        button.addEventListener("click", () => {
            closeModal(button.dataset.closeModal);
        });
    });

    $$(".modal-backdrop").forEach(modal => {
        modal.addEventListener("click", event => {
            if (event.target === modal) {
                closeModal(modal.id);
            }
        });
    });

    getElement("loginButton")?.addEventListener(
        "click",
        () => openAuthModal("login")
    );

    $$(".auth-tab").forEach(button => {
        button.addEventListener("click", () => {
            setAuthMode(button.dataset.authMode);
        });
    });
}


/* =========================
   21. LOGIN / SIGNUP
   ========================= */

function openAuthModal(mode = "login") {
    setAuthMode(mode);

    openModal("authModal");
}

function setAuthMode(mode) {
    state.authMode =
        mode === "signup" ? "signup" : "login";

    $$(".auth-tab").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.authMode === state.authMode
        );
    });

    const signup = state.authMode === "signup";

    const nameField = getElement("authNameField");

    const nameInput = getElement("authName");

    if (nameField) {
        if (signup) {
            showElement(nameField);
        } else {
            hideElement(nameField);
        }
    }

    if (nameInput) {
        nameInput.required = signup;
    }

    setText(
        "authTitle",
        signup ? "Create your NEXUS account" : "Welcome to NEXUS"
    );

    setText(
        "authDescription",
        signup
            ? "Create an account to get started."
            : "Sign in to access your account."
    );

    setText(
        "authSubmitButton",
        signup ? "Create account" : "Continue"
    );

    const password = getElement("authPassword");

    if (password) {
        password.autocomplete = signup
            ? "new-password"
            : "current-password";
    }

    hideElement(getElement("authError"));
}

function showAuthError(message) {
    const error = getElement("authError");

    if (!error) {
        showToast("Authentication error", message, "error");
        return;
    }

    error.textContent = message;

    showElement(error);
}

async function submitAuth(event) {
    event.preventDefault();

    const email =
        getElement("authEmail")?.value.trim();

    const password =
        getElement("authPassword")?.value;

    const name =
        getElement("authName")?.value.trim();

    if (!email || !password) {
        showAuthError("Email ও password পূরণ করো।");
        return;
    }

    if (password.length < 8) {
        showAuthError(
            "Password অন্তত 8 অক্ষরের হতে হবে।"
        );

        return;
    }

    const endpoint =
        state.authMode === "signup"
            ? ENDPOINTS.signup
            : ENDPOINTS.login;

    const button = getElement("authSubmitButton");

    if (button) {
        button.disabled = true;
        button.textContent = "Please wait...";
    }

    hideElement(getElement("authError"));

    try {
        const payload = {
            email,
            password
        };

        if (state.authMode === "signup") {
            payload.name = name;
        }

        const result = await apiRequest(endpoint, {
            method: "POST",
            body: JSON.stringify(payload)
        });

        /*
         * Do not pretend that authentication succeeded
         * unless the server returns a successful response.
         */

        if (
            !result ||
            typeof result !== "object" ||
            result.success === false ||
            result.error
        ) {
            throw new Error(
                result?.error ||
                result?.message ||
                "Server did not confirm authentication."
            );
        }

        state.user = result.user || {
            name: name || email.split("@")[0],
            email
        };

        updateUserProfile();

        closeModal("authModal");

        showToast(
            "Success",
            state.authMode === "signup"
                ? "Account তৈরি হয়েছে।"
                : "Login সফল হয়েছে।",
            "success"
        );

    } catch (error) {
        console.error("Authentication failed:", error);

        showAuthError(
            "Login/Signup করা যায়নি। " +
            "Backend-এর authentication endpoint পরীক্ষা করো। " +
            error.message
        );

    } finally {
        if (button) {
            button.disabled = false;

            button.textContent =
                state.authMode === "signup"
                    ? "Create account"
                    : "Continue";
        }
    }
}

function updateUserProfile() {
    if (!state.user) return;

    const name =
        state.user.name ||
        state.user.email ||
        "User";

    setText("profileName", name);

    setText(
        "userAvatar",
        name.charAt(0).toUpperCase()
    );

    setText("loginButton", "Account");
}

function bindAuthentication() {
    getElement("authForm")?.addEventListener(
        "submit",
        submitAuth
    );

    getElement("googleLoginButton")?.addEventListener(
        "click",
        () => {
            showToast(
                "Google sign-in unavailable",
                "Google OAuth-এর জন্য backend callback এবং Google Client ID configure করতে হবে।",
                "warning",
                5000
            );
        }
    );
}


/* =========================
   22. IMAGE GENERATION
   ========================= */

async function generateImage(event) {
    event.preventDefault();

    const prompt =
        getElement("imagePrompt")?.value.trim();

    const style =
        getElement("imageStyle")?.value || "realistic";

    const button = getElement("generateImageButton");

    const result = getElement("imageGenerationResult");

    if (!prompt) {
        showToast(
            "Prompt required",
            "ছবির বর্ণনা লিখো।",
            "warning"
        );

        return;
    }

    if (result) {
        result.replaceChildren();

        const status = document.createElement("p");

        status.textContent =
            "Image generation request পাঠানো হচ্ছে...";

        result.append(status);
    }

    if (button) {
        button.disabled = true;
        button.textContent = "Generating...";
    }

    try {
        const data = await apiRequest(
            ENDPOINTS.image,
            {
                method: "POST",
                body: JSON.stringify({
                    prompt,
                    style
                })
            }
        );

        const imageUrl =
            data?.image_url ||
            data?.url ||
            data?.image;

        if (!imageUrl || typeof imageUrl !== "string") {
            throw new Error(
                "Backend image URL দেয়নি। Image API configure করা আছে কি না পরীক্ষা করো।"
            );
        }

        /*
         * Only display HTTP(S) URLs or base64 image data.
         * Do not inject backend HTML into the page.
         */

        const isHttp =
            /^https?:\/\//i.test(imageUrl);

        const isDataImage =
            /^data:image\/(png|jpeg|webp|gif);base64,/i
                .test(imageUrl);

        if (!isHttp && !isDataImage) {
            throw new Error("Image URL format invalid.");
        }

        if (result) {
            result.replaceChildren();

            const image = document.createElement("img");

            image.src = imageUrl;

            image.alt = prompt;

            image.loading = "lazy";

            image.referrerPolicy = "no-referrer";

            result.append(image);

            const download = document.createElement("a");

            download.href = imageUrl;

            download.download = "nexus-ai-image.png";

            download.textContent = "Download image";

            download.className = "secondary-button";

            result.append(download);
        }

        showToast(
            "Image generated",
            "ছবি তৈরি হয়েছে।",
            "success"
        );

    } catch (error) {
        console.error("Image generation failed:", error);

        if (result) {
            result.replaceChildren();

            const message = document.createElement("p");

            message.textContent =
                "ছবি তৈরি করা যায়নি: " + error.message;

            result.append(message);
        }

        showToast(
            "Generation failed",
            error.message,
            "error"
        );

    } finally {
        if (button) {
            button.disabled = false;

            button.innerHTML =
                "<span>✦</span> Generate image";
        }
    }
}

function bindImageGeneration() {
    getElement("imageGenerationForm")?.addEventListener(
        "submit",
        generateImage
    );
}


/* =========================
   23. SHARE CONVERSATION
   ========================= */

async function shareConversation() {
    const chat = getActiveConversation();

    if (!chat || !chat.messages.length) {
        showToast(
            "Nothing to share",
            "আগে একটি conversation শুরু করো।",
            "warning"
        );

        return;
    }

    const transcript = chat.messages
        .map(message => {
            const author =
                message.role === "user"
                    ? "You"
                    : "NEXUS AI";

            return `${author}:\n${message.content}`;
        })
        .join("\n\n");

    try {
        if (navigator.share) {
            await navigator.share({
                title: chat.title,
                text: transcript
            });
        } else {
            await navigator.clipboard.writeText(transcript);

            showToast(
                "Copied",
                "Conversation clipboard-এ কপি হয়েছে।",
                "success"
            );
        }
    } catch (error) {
        if (error.name !== "AbortError") {
            showToast(
                "Share unavailable",
                "এই browser-এ share permission পাওয়া যায়নি।",
                "warning"
            );
        }
    }
}


/* =========================
   24. INITIALIZATION
   ========================= */

function restoreActiveConversation() {
    const savedId = localStorage.getItem(
        STORAGE.activeChat
    );

    if (
        savedId &&
        state.conversations.some(chat => chat.id === savedId)
    ) {
        state.activeChatId = savedId;
    }
}

function initializeNexus() {
    loadHistory();

    restoreActiveConversation();

    loadPreferences();

    renderConversationList();

    renderMessages();

    bindChatInput();

    bindNavigation();

    bindModals();

    bindModelSelector();

    bindAuthentication();

    bindImageGeneration();

    setupVoiceInput();

    updateCharacterCounter();

    updateSendButton();

    checkConnection();

    console.log(
        "NEXUS AI initialized successfully."
    );
}

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        initializeNexus,
        { once: true }
    );
} else {
    initializeNexus();
}