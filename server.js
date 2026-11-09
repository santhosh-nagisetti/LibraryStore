"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { randomUUID, timingSafeEqual } = require("node:crypto");

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_STATE_BYTES = 1024 * 1024;
const STATIC_FILES = new Set(["index.html", "styles.css", "app.js"]);
const BOOK_IDS = new Set([
  "midnight-library",
  "braiding-sweetgrass",
  "creative-act",
  "tomorrow",
  "brief-history",
  "everyday-things",
  "the-alchemist",
  "quiet",
  "stacks-starter",
]);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
const STARTER_PAGES = [
  {
    title: "The First Page",
    paragraphs: [
      "On a rainy morning, Mira found a small brass key tucked between the pages of a book. It was warm, as if someone had just held it.",
      "The book had no title on its cover. Inside, every page was blank except for one sentence: A door appears when you are ready to begin.",
    ],
  },
  {
    title: "A Door in the Stacks",
    paragraphs: [
      "Mira looked up from the page. At the end of the library aisle, where there had always been a tall window, stood a green door with a brass lock.",
      "She tried the key. It turned easily. Beyond the door was a garden full of little lanterns, each one glowing with a different color.",
    ],
  },
  {
    title: "A Story to Keep",
    paragraphs: [
      "A gardener welcomed her and offered a packet of seeds. Plant one whenever you discover something worth sharing, the gardener said.",
      "When Mira returned to the library, the rain had stopped. She placed the seeds beside the blank book and wrote down what she had seen.",
      "The next reader found the story there, along with a note: The door is waiting for you, too.",
    ],
  },
];

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function isAuthorized(request, adminToken) {
  const provided = request.headers["x-admin-token"];
  if (!adminToken || typeof provided !== "string") return false;
  const expectedBuffer = Buffer.from(adminToken);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer);
}

function safeFilename(filename) {
  return path.basename(filename).replace(/[\r\n"]/g, "_").slice(0, 180) || "book.pdf";
}

function createServer(options = {}) {
  const root = path.resolve(options.root || __dirname);
  const dataDirectory = path.resolve(options.dataDirectory || path.join(root, "data"));
  const filesDirectory = path.join(dataDirectory, "books");
  const metadataFile = path.join(dataDirectory, "book-files.json");
  const stateFile = path.resolve(options.dataFile || path.join(dataDirectory, "library.json"));
  const adminToken = options.adminToken ?? process.env.STACKS_ADMIN_TOKEN ?? "";
  const maxUploadBytes = options.maxUploadBytes || MAX_UPLOAD_BYTES;
  let stateRevision = 0;

  function readLibraryState() {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      if (!state || !Array.isArray(state.books) || !Array.isArray(state.users) || !Array.isArray(state.loans)) {
        throw new Error("The stored library data has an invalid format.");
      }
      return state;
    } catch (error) {
      if (error.code === "ENOENT") return { books: [], users: [], loans: [] };
      throw error;
    }
  }

  function writeLibraryState(state) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const temporaryFile = `${stateFile}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryFile, JSON.stringify(state, null, 2), { flag: "wx" });
      fs.renameSync(temporaryFile, stateFile);
    } finally {
      try {
        fs.unlinkSync(temporaryFile);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }

  function validateLibraryState(next, previous) {
    if (!next || typeof next !== "object" || !Array.isArray(next.books) || !Array.isArray(next.users) || !Array.isArray(next.loans)) {
      return "Library state must include books, users, and loans arrays.";
    }
    for (const name of ["books", "users", "loans"]) {
      const records = next[name];
      const ids = new Set();
      for (const record of records) {
        if (!record || typeof record !== "object" || typeof record.id !== "string" || !record.id.trim()) {
          return `Every ${name.slice(0, -1)} must have an ID.`;
        }
        if (ids.has(record.id)) return `Duplicate ${name.slice(0, -1)} ID.`;
        ids.add(record.id);
      }
    }
    const bookIds = new Set(next.books.map((book) => book.id));
    const userIds = new Set(next.users.map((user) => user.id));
    const previousLoanIds = new Set(previous.loans.map((loan) => loan.id));
    const nextLoanIds = new Set(next.loans.map((loan) => loan.id));
    if ([...previousLoanIds].some((id) => !nextLoanIds.has(id))) {
      return "Existing loans cannot be deleted.";
    }

    const activeBooks = new Set();
    const activeByUser = new Map();
    for (const loan of next.loans) {
      if (!bookIds.has(loan.bookId) || !userIds.has(loan.userId)) {
        return "Every loan must refer to an existing book and user.";
      }
      if (loan.returnedAt !== null) continue;
      if (activeBooks.has(loan.bookId)) return "A book can have only one active borrowing.";
      activeBooks.add(loan.bookId);
      activeByUser.set(loan.userId, (activeByUser.get(loan.userId) || 0) + 1);
    }
    const previousActiveByUser = new Map();
    for (const loan of previous.loans) {
      if (loan.returnedAt === null) {
        previousActiveByUser.set(loan.userId, (previousActiveByUser.get(loan.userId) || 0) + 1);
      }
    }
    for (const [userId, count] of activeByUser) {
      if (count > 3 && count > (previousActiveByUser.get(userId) || 0)) {
        return "A user already has 3 active borrowings.";
      }
    }
    return "";
  }

  async function handleStateRequest(request, response) {
    if (request.method === "GET") {
      try {
        sendJson(response, 200, { state: readLibraryState(), revision: stateRevision });
      } catch (error) {
        console.error("Could not read library state:", error);
        sendJson(response, 500, { error: "The library state could not be read." });
      }
      return;
    }
    if (request.method !== "PUT") {
      response.setHeader("Allow", "GET, PUT");
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }
    const contentLength = Number(request.headers["content-length"] || 0);
    if (contentLength > MAX_STATE_BYTES) {
      request.resume();
      sendJson(response, 413, { error: "Library state is too large." });
      return;
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_STATE_BYTES) {
          sendJson(response, 413, { error: "Library state is too large." });
          return;
        }
        chunks.push(chunk);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!payload || typeof payload !== "object") {
        sendJson(response, 400, { error: "Request body must include library state and revision." });
        return;
      }
      const previous = readLibraryState();
      if (!Number.isInteger(payload.revision) || payload.revision !== stateRevision) {
        sendJson(response, 409, { error: "Library state changed. Reload before saving again." });
        return;
      }
      const validationError = validateLibraryState(payload.state, previous);
      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }
      writeLibraryState(payload.state);
      stateRevision += 1;
      sendJson(response, 200, { state: payload.state, revision: stateRevision });
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: "Request body must contain valid JSON." });
        return;
      }
      console.error("Could not save library state:", error);
      sendJson(response, 500, { error: "The library state could not be saved." });
    }
  }

  function readMetadata() {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
      return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }

  function saveMetadata(metadata) {
    fs.mkdirSync(dataDirectory, { recursive: true });
    const temporaryFile = `${metadataFile}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryFile, JSON.stringify(metadata, null, 2), { flag: "wx" });
      fs.renameSync(temporaryFile, metadataFile);
    } finally {
      try {
        fs.unlinkSync(temporaryFile);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }

  async function handleUpload(request, response, bookId) {
    if (!isAuthorized(request, adminToken)) {
      sendJson(response, adminToken ? 401 : 503, {
        error: adminToken ? "A valid admin key is required to upload books." : "PDF uploads are disabled until STACKS_ADMIN_TOKEN is configured.",
      });
      request.resume();
      return;
    }
    if (request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/pdf") {
      sendJson(response, 415, { error: "Upload a PDF file using application/pdf." });
      request.resume();
      return;
    }
    const declaredLength = Number(request.headers["content-length"] || 0);
    if (declaredLength > maxUploadBytes) {
      sendJson(response, 413, { error: `PDF files must be ${Math.floor(maxUploadBytes / (1024 * 1024))} MB or smaller.` });
      request.resume();
      return;
    }

    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > maxUploadBytes) {
          sendJson(response, 413, { error: `PDF files must be ${Math.floor(maxUploadBytes / (1024 * 1024))} MB or smaller.` });
          return;
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (!response.destroyed) sendJson(response, 400, { error: "The upload request ended before the PDF was received." });
      return;
    }
    const pdf = Buffer.concat(chunks);
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      sendJson(response, 400, { error: "The uploaded file is not a valid PDF." });
      return;
    }

    try {
      fs.mkdirSync(filesDirectory, { recursive: true });
      const storedFilename = `${bookId}-${randomUUID()}.pdf`;
      const destination = path.join(filesDirectory, storedFilename);
      fs.writeFileSync(destination, pdf, { flag: "wx", mode: 0o600 });
      const metadata = readMetadata();
      const previousFilename = metadata[bookId]?.storedFilename;
      metadata[bookId] = {
        storedFilename,
        filename: safeFilename(request.headers["x-file-name"] || `${bookId}.pdf`),
        size: pdf.length,
        uploadedAt: new Date().toISOString(),
      };
      try {
        saveMetadata(metadata);
      } catch (error) {
        try {
          fs.unlinkSync(destination);
        } catch (cleanupError) {
          if (cleanupError.code !== "ENOENT") console.error("Could not remove incomplete PDF upload:", cleanupError);
        }
        throw error;
      }
      if (previousFilename && previousFilename !== storedFilename) {
        try {
          fs.unlinkSync(path.join(filesDirectory, previousFilename));
        } catch (error) {
          if (error.code !== "ENOENT") console.error("Could not remove replaced PDF:", error);
        }
      }
      sendJson(response, 201, { bookId, filename: metadata[bookId].filename, size: pdf.length });
    } catch (error) {
      console.error("Could not save uploaded PDF:", error);
      sendJson(response, 500, { error: "The PDF could not be saved to the library." });
    }
  }

  const server = http.createServer(async (request, response) => {
    let pathname;
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
      sendJson(response, 400, { error: "Invalid request URL." });
      return;
    }
    const pdfMatch = pathname.match(/^\/api\/books\/([a-z0-9-]+)\/pdf$/);
    if (pathname === "/api/admin/session" && request.method === "POST") {
      if (!adminToken) {
        request.resume();
        sendJson(response, 503, { error: "Admin access is disabled until STACKS_ADMIN_TOKEN is configured." });
        return;
      }
      if (pathname === "/api/state") {
        await handleStateRequest(request, response);
        return;
      }
      if (!isAuthorized(request, adminToken)) {
        request.resume();
        sendJson(response, 401, { error: "The admin key is incorrect." });
        return;
      }
      request.resume();
      sendJson(response, 200, { authenticated: true });
      return;
    }
    if (pathname === "/api/admin/session") {
      response.setHeader("Allow", "POST");
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }
    if (pdfMatch && !BOOK_IDS.has(pdfMatch[1])) {
      sendJson(response, 404, { error: "Book not found." });
      return;
    }
    if (pdfMatch && request.method === "POST") {
      await handleUpload(request, response, pdfMatch[1]);
      return;
    }
    if (pdfMatch && request.method === "GET") {
      try {
        const metadata = readMetadata()[pdfMatch[1]];
        if (!metadata) {
          sendJson(response, 404, { error: "No PDF has been added for this book yet." });
          return;
        }
        const filePath = path.join(filesDirectory, metadata.storedFilename);
        const stat = fs.statSync(filePath);
        response.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Length": stat.size,
          "Content-Disposition": `inline; filename="${safeFilename(metadata.filename)}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
        });
        const stream = fs.createReadStream(filePath);
        stream.on("error", (error) => {
          console.error("Could not stream uploaded PDF:", error);
          if (!response.headersSent) sendJson(response, 500, { error: "The PDF could not be read from the library." });
          else response.destroy(error);
        });
        stream.pipe(response);
      } catch (error) {
        if (error.code === "ENOENT") {
          sendJson(response, 404, { error: "The stored PDF is missing from the library." });
        } else {
          console.error("Could not read uploaded PDF:", error);
          sendJson(response, 500, { error: "The PDF could not be read from the library." });
        }
      }
      return;
    }
    if (pdfMatch) {
      response.setHeader("Allow", "GET, POST");
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }
    if (pathname === "/api/books/stacks-starter/pages" && request.method === "GET") {
      sendJson(response, 200, { pages: STARTER_PAGES });
      return;
    }
    if (pathname === "/api/books" && request.method === "GET") {
      try {
        const metadata = readMetadata();
        const pdfs = Object.fromEntries(
          Object.entries(metadata).map(([bookId, record]) => [
            bookId,
            { filename: record.filename, size: record.size, uploadedAt: record.uploadedAt },
          ]),
        );
        sendJson(response, 200, { pdfs });
      } catch (error) {
        console.error("Could not read library PDF metadata:", error);
        sendJson(response, 500, { error: "The library catalog could not be loaded." });
      }
      return;
    }
    if (pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "API route not found." });
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    let relativePath;
    try {
      relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
    } catch {
      sendJson(response, 400, { error: "Invalid file path." });
      return;
    }
    if (!STATIC_FILES.has(relativePath)) {
      sendJson(response, 404, { error: "File not found." });
      return;
    }
    const filePath = path.resolve(root, relativePath);
    if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== root) {
      sendJson(response, 403, { error: "Access denied." });
      return;
    }
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        sendJson(response, 404, { error: "File not found." });
        return;
      }
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Content-Length": stat.size,
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") response.end();
      else {
        const stream = fs.createReadStream(filePath);
        stream.on("error", (error) => {
          console.error("Could not stream project file:", error);
          if (!response.headersSent) sendJson(response, 500, { error: "The project file could not be served." });
          else response.destroy(error);
        });
        stream.pipe(response);
      }
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") {
        console.error("Could not serve project file:", error);
        sendJson(response, 500, { error: "The project file could not be served." });
        return;
      }
      sendJson(response, 404, { error: "File not found." });
    }
  });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`Stacks Library is running at http://${host}:${port}`);
    if (!process.env.STACKS_ADMIN_TOKEN) {
      console.warn("PDF uploads are disabled. Set STACKS_ADMIN_TOKEN to enable admin uploads.");
    }
  });
}

module.exports = { createServer, MAX_UPLOAD_BYTES };
