const STORAGE_KEY = "stacks-member-portal-v1";
const books = [
  { id: "stacks-starter", title: "The Door Between the Stacks", author: "Stacks Library", category: "Starter story", note: "An original three-page story included with the library.", cover: "cover-sage", mark: "THE DOOR<br>BETWEEN THE<br>STACKS", starter: true },
  { id: "midnight-library", title: "The Midnight Library", author: "Matt Haig", category: "Fiction", note: "A story about all the lives we could have lived.", cover: "cover-sage", mark: "THE<br>MIDNIGHT<br>LIBRARY" },
  { id: "braiding-sweetgrass", title: "Braiding Sweetgrass", author: "Robin Wall Kimmerer", category: "Nature", note: "Wisdom, wonder, and our relationship with the living world.", cover: "cover-rust", mark: "BRAIDING<br>SWEETGRASS" },
  { id: "creative-act", title: "The Creative Act", author: "Rick Rubin", category: "Creativity", note: "A way of being, making, and paying attention.", cover: "cover-blue", mark: "THE<br>CREATIVE<br>ACT" },
  { id: "tomorrow", title: "Tomorrow, and Tomorrow, and Tomorrow", author: "Gabrielle Zevin", category: "Fiction", note: "A moving story about friendship and making things together.", cover: "cover-peach", mark: "TOMORROW<br>AND<br>TOMORROW" },
  { id: "brief-history", title: "A Brief History of Time", author: "Stephen Hawking", category: "Science", note: "Big questions about the universe, made wonderfully curious.", cover: "cover-night", mark: "A BRIEF<br>HISTORY<br>OF TIME" },
  { id: "everyday-things", title: "The Design of Everyday Things", author: "Don Norman", category: "Design", note: "A fresh look at the objects and systems around us.", cover: "cover-yellow", mark: "THE DESIGN<br>OF EVERYDAY<br>THINGS" },
  { id: "the-alchemist", title: "The Alchemist", author: "Paulo Coelho", category: "Fiction", note: "A journey about listening to your heart and following a dream.", cover: "cover-olive", mark: "THE<br>ALCHEMIST" },
  { id: "quiet", title: "Quiet", author: "Susan Cain", category: "Psychology", note: "The power of the thoughtful, observant, and quietly brave.", cover: "cover-lilac", mark: "QUIET<br>THE POWER<br>OF INTROVERTS" },
];
const fallbackPages = [
  { title: "The First Page", paragraphs: ["On a rainy morning, Mira found a small brass key tucked between the pages of a book. It was warm, as if someone had just held it.", "The book had no title on its cover. Inside, every page was blank except for one sentence: A door appears when you are ready to begin."] },
  { title: "A Door in the Stacks", paragraphs: ["Mira looked up from the page. At the end of the library aisle, where there had always been a tall window, stood a green door with a brass lock.", "She tried the key. It turned easily. Beyond the door was a garden full of little lanterns, each one glowing with a different color."] },
  { title: "A Story to Keep", paragraphs: ["A gardener welcomed her and offered a packet of seeds. Plant one whenever you discover something worth sharing, the gardener said.", "When Mira returned to the library, the rain had stopped. She placed the seeds beside the blank book and wrote down what she had seen.", "The next reader found the story there, along with a note: The door is waiting for you, too."] },
];

let appState = { applications: [], savedBookIds: [] };
let storageMessage = "";
let showSavedOnly = false;
let bookPdfs = {};
let readerPages = [];
let currentPageIndex = 0;
let currentPdfUrl = "";
let adminToken = "";

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );

function loadState() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (!parsed || !Array.isArray(parsed.applications) || !Array.isArray(parsed.savedBookIds)) {
      throw new Error("Saved data has an invalid format.");
    }
    appState = parsed;
  } catch (error) {
    console.error("Could not load saved library data:", error);
    storageMessage = "Browser storage is unavailable or your saved data could not be read.";
  }
}

function saveState() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    storageMessage = "";
    return true;
  } catch (error) {
    console.error("Could not save library data:", error);
    storageMessage = "Your browser could not save this change. Check its storage settings and try again.";
    return false;
  }
}

async function loadSharedBooks() {
  try {
    const response = await fetch("/api/books");
    if (!response.ok) throw new Error(`Library server returned ${response.status}.`);
    const result = await response.json();
    bookPdfs = result.pdfs || {};
    byId("server-status").textContent = "Shared library connected.";
    byId("server-status").classList.remove("error");
  } catch (error) {
    console.error("Could not connect to the shared library:", error);
    byId("server-status").textContent = "Shared library is offline. Start the project server to share PDF uploads with all users.";
    byId("server-status").classList.add("error");
  }
  renderCatalog();
  renderAdminBookOptions();
}

function renderBook(book) {
  const saved = appState.savedBookIds.includes(book.id);
  const accessLabel = book.starter ? "Read starter story" : bookPdfs[book.id] ? "PDF available" : "Details";
  return `<article class="book-card">
    <div class="book-cover ${book.cover}">
      <button class="book-open" data-action="open-book" data-id="${book.id}" aria-label="Open details for ${escapeHtml(book.title)}">
        <span class="cover-kicker">${escapeHtml(book.category)}</span>
        <span class="cover-title">${book.mark}</span>
        <span class="cover-author">${escapeHtml(book.author)}</span>
      </button>
      <button class="save-book ${saved ? "is-saved" : ""}" data-action="save-book" data-id="${book.id}" aria-label="${saved ? "Remove from" : "Save to"} your reading list" aria-pressed="${saved}">${saved ? "♥" : "♡"}</button>
    </div>
    <div class="book-info"><span class="book-category">${escapeHtml(book.category)}</span><h3><button class="book-title-button" data-action="open-book" data-id="${book.id}">${escapeHtml(book.title)}</button></h3><p class="book-author">${escapeHtml(book.author)}</p><p class="book-note">${escapeHtml(book.note)}</p><span class="book-access">${escapeHtml(accessLabel)}</span></div>
  </article>`;
}

function renderCatalog() {
  const filter = byId("category-filter");
  const selected = filter.value;
  const categories = [...new Set(books.map((book) => book.category))].sort();
  filter.innerHTML = `<option value="">All shelves</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  if (categories.includes(selected)) filter.value = selected;

  const query = byId("book-search").value.trim().toLocaleLowerCase();
  const matches = books.filter((book) =>
    (!filter.value || book.category === filter.value) &&
    (!showSavedOnly || appState.savedBookIds.includes(book.id)) &&
    (!query || `${book.title} ${book.author} ${book.note}`.toLocaleLowerCase().includes(query)),
  );
  byId("book-result-count").textContent = `${matches.length} ${matches.length === 1 ? "book" : "books"}`;
  byId("saved-filter").setAttribute("aria-pressed", String(showSavedOnly));
  byId("saved-filter").classList.toggle("active", showSavedOnly);
  byId("saved-count").textContent = appState.savedBookIds.length;
  byId("catalog-books").innerHTML = matches.length
    ? matches.map(renderBook).join("")
    : `<div class="empty-state"><span aria-hidden="true">⌕</span><strong>${showSavedOnly ? "Your reading list is empty" : "No books on this shelf"}</strong><p>${showSavedOnly ? "Save a book with the heart button and it will be waiting here." : "Try a different search or category."}</p></div>`;
  byId("featured-books").innerHTML = books.slice(0, 4).map(renderBook).join("");
}

function renderAdminBookOptions() {
  const select = byId("upload-book");
  const selected = select.value;
  select.innerHTML = books.filter((book) => !book.starter)
    .map((book) => `<option value="${book.id}">${escapeHtml(book.title)}</option>`).join("");
  if (books.some((book) => book.id === selected)) select.value = selected;
}

function showApplicationStatus() {
  const status = byId("application-status");
  const form = byId("application-form");
  const savedApplication = appState.applications[0];
  if (savedApplication) {
    form.elements.name.value = savedApplication.name;
    form.elements.email.value = savedApplication.email;
    form.elements.interests.value = savedApplication.interests || "";
    status.innerHTML = `<div class="status-message"><span aria-hidden="true">✓</span><div><strong>Application saved on this device</strong><p>Thanks, ${escapeHtml(savedApplication.name)}. This demo does not send your details to a library.</p></div></div>`;
  } else if (storageMessage) {
    status.innerHTML = `<p class="storage-message" role="alert">${escapeHtml(storageMessage)}</p>`;
  } else {
    status.innerHTML = "";
  }
}

function switchView(view) {
  if (view === "admin" && !adminToken) {
    byId("admin-login-status").textContent = "Sign in with an admin key to access this page.";
    byId("admin-login-dialog").showModal();
    return;
  }
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });
  document.querySelectorAll(".site-nav [data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelector(".site-header").classList.remove("menu-open");
  byId("menu-toggle").setAttribute("aria-expanded", "false");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderReaderPage() {
  const content = byId("book-reader-content");
  content.replaceChildren();
  const page = readerPages[currentPageIndex];
  if (page) {
    const heading = document.createElement("h3");
    heading.textContent = page.title || `Page ${currentPageIndex + 1}`;
    content.append(heading);
    page.paragraphs.forEach((text) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      content.append(paragraph);
    });
  }
  byId("reader-page-count").textContent = `Page ${currentPageIndex + 1} of ${readerPages.length}`;
  byId("reader-previous").disabled = currentPageIndex === 0;
  byId("reader-next").disabled = currentPageIndex >= readerPages.length - 1;
}

function clearReader() {
  if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl);
  currentPdfUrl = "";
  byId("book-reader-pdf").removeAttribute("src");
  byId("book-reader-pdf").hidden = true;
  byId("book-reader-content").hidden = true;
  byId("reader-navigation").hidden = true;
  byId("book-reader-error").textContent = "";
  readerPages = [];
  currentPageIndex = 0;
}

async function openBook(book) {
  clearReader();
  byId("book-reader-title").textContent = book.title;
  byId("book-reader-filename").textContent = book.starter ? "Included with the library" : bookPdfs[book.id]?.filename || "";
  byId("book-reader-dialog").showModal();
  if (book.starter) {
    byId("book-reader-content").hidden = false;
    try {
      const response = await fetch("/api/books/stacks-starter/pages");
      if (response.ok) {
        const result = await response.json();
        readerPages = Array.isArray(result.pages) ? result.pages : fallbackPages;
      } else {
        readerPages = fallbackPages;
      }
    } catch (error) {
      console.error("Could not load starter story from the server:", error);
      readerPages = fallbackPages;
    }
    byId("reader-navigation").hidden = false;
    renderReaderPage();
    return;
  }
  byId("book-reader-error").textContent = "Loading shared PDF…";
  try {
    const response = await fetch(`/api/books/${encodeURIComponent(book.id)}/pdf`);
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "This book does not have a shared PDF yet.");
    }
    const pdf = await response.blob();
    currentPdfUrl = URL.createObjectURL(pdf);
    byId("book-reader-pdf").src = currentPdfUrl;
    byId("book-reader-pdf").title = book.title;
    byId("book-reader-pdf").hidden = false;
    byId("book-reader-error").textContent = "";
  } catch (error) {
    console.error("Could not open shared PDF:", error);
    byId("book-reader-error").textContent = error.message || "The shared PDF could not be opened.";
  }
}

function openBookDetails(book) {
  byId("book-dialog-title").textContent = book.title;
  byId("book-dialog-author").textContent = `by ${book.author}`;
  byId("book-dialog-category").textContent = book.category;
  byId("book-dialog-note").textContent = book.note;
  byId("book-read-button").disabled = !book.starter && !bookPdfs[book.id];
  byId("book-read-button").textContent = book.starter ? "Read starter pages" : bookPdfs[book.id] ? "Read shared PDF" : "No shared PDF yet";
  byId("book-access-note").textContent = book.starter
    ? "This original three-page story is included with the project."
    : bookPdfs[book.id]
      ? `A shared PDF is available: ${bookPdfs[book.id].filename}`
      : "An admin can add a PDF in the Admin upload section. Everyone can read shared PDFs.";
  byId("book-read-button").dataset.bookId = book.id;
  byId("book-dialog").showModal();
}

document.addEventListener("click", (event) => {
  if (event.target.closest("#admin-access-button")) {
    if (adminToken) {
      adminToken = "";
      byId("admin-nav").hidden = true;
      byId("admin-access-button").textContent = "Admin sign-in";
      if (byId("view-admin").classList.contains("active")) switchView("home");
    } else {
      byId("admin-login-status").textContent = "";
      byId("admin-login-key").value = "";
      byId("admin-login-dialog").showModal();
    }
    return;
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    event.preventDefault();
    switchView(viewButton.dataset.view);
    return;
  }
  const openButton = event.target.closest("[data-action='open-book']");
  if (openButton) {
    const book = books.find(({ id }) => id === openButton.dataset.id);
    if (book) openBookDetails(book);
    return;
  }
  if (event.target.closest("#book-read-button")) {
    const book = books.find(({ id }) => id === byId("book-read-button").dataset.bookId);
    if (!book) return;
    byId("book-dialog").close();
    openBook(book);
    return;
  }
  if (event.target.closest("#reader-previous")) {
    currentPageIndex -= 1;
    renderReaderPage();
    return;
  }
  if (event.target.closest("#reader-next")) {
    currentPageIndex += 1;
    renderReaderPage();
    return;
  }
  const actionButton = event.target.closest("[data-action='save-book']");
  if (actionButton) {
    const { id } = actionButton.dataset;
    const previousIds = appState.savedBookIds;
    appState.savedBookIds = previousIds.includes(id)
      ? previousIds.filter((savedId) => savedId !== id)
      : [...previousIds, id];
    if (!saveState()) appState.savedBookIds = previousIds;
    renderCatalog();
  }
});

byId("book-search").addEventListener("input", renderCatalog);
byId("category-filter").addEventListener("change", renderCatalog);
byId("saved-filter").addEventListener("click", () => {
  showSavedOnly = !showSavedOnly;
  renderCatalog();
});
byId("menu-toggle").addEventListener("click", () => {
  const header = document.querySelector(".site-header");
  const open = header.classList.toggle("menu-open");
  byId("menu-toggle").setAttribute("aria-expanded", String(open));
});
byId("book-dialog-close").addEventListener("click", () => byId("book-dialog").close());
byId("book-reader-close").addEventListener("click", () => byId("book-reader-dialog").close());
byId("book-reader-dialog").addEventListener("close", clearReader);
byId("admin-login-close").addEventListener("click", () => byId("admin-login-dialog").close());
byId("admin-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = byId("admin-login-key").value.trim();
  const status = byId("admin-login-status");
  if (!key) {
    status.textContent = "Enter the admin key.";
    return;
  }
  status.textContent = "Checking admin access…";
  try {
    const response = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "X-Admin-Token": key },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Admin sign-in failed.");
    adminToken = key;
    byId("admin-nav").hidden = false;
    byId("admin-access-button").textContent = "Admin sign-out";
    byId("admin-login-key").value = "";
    byId("admin-login-dialog").close();
    switchView("admin");
  } catch (error) {
    console.error("Admin sign-in failed:", error);
    status.textContent = error.message || "Admin sign-in failed.";
  }
});
byId("admin-upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.elements.pdf.files[0];
  const bookId = form.elements.bookId.value;
  const status = byId("admin-upload-status");
  if (!adminToken) {
    status.textContent = "Sign in as an admin to upload PDFs.";
    switchView("home");
    return;
  }
  if (!file || !bookId) {
    status.textContent = "Choose a catalog book and PDF file.";
    return;
  }
  if (file.type !== "application/pdf" && !file.name.toLocaleLowerCase().endsWith(".pdf")) {
    status.textContent = "Choose a PDF file.";
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    status.textContent = "PDF files must be 25 MB or smaller.";
    return;
  }
  status.textContent = "Uploading PDF to the shared library…";
  try {
    const filename = file.name.replace(/[^\x20-\x7E]/g, "_");
    const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "X-Admin-Token": adminToken,
        "X-File-Name": filename,
      },
      body: file,
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        adminToken = "";
        byId("admin-nav").hidden = true;
        byId("admin-access-button").textContent = "Admin sign-in";
        switchView("home");
      }
      throw new Error(result.error || "The PDF could not be uploaded.");
    }
    status.textContent = `${result.filename} was added to the shared library.`;
    form.elements.pdf.value = "";
    await loadSharedBooks();
  } catch (error) {
    console.error("Could not upload shared PDF:", error);
    status.textContent = error.message || "The PDF could not be uploaded.";
  }
});
byId("application-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const application = {
    name: String(formData.get("name")).trim(),
    email: String(formData.get("email")).trim().toLocaleLowerCase(),
    interests: String(formData.get("interests")).trim(),
    submittedAt: new Date().toISOString(),
  };
  if (!application.name || !application.email) return;
  const previous = appState.applications;
  appState.applications = [application, ...previous.filter((item) => item.email !== application.email)];
  if (saveState()) showApplicationStatus();
  else {
    appState.applications = previous;
    showApplicationStatus();
  }
});

byId("current-year").textContent = new Date().getFullYear();
loadState();
renderCatalog();
renderAdminBookOptions();
showApplicationStatus();
loadSharedBooks();
