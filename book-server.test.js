"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createServer } = require("./server");

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "stacks-books-"));
const server = createServer({ dataDirectory, adminToken: "test-admin-key" });
let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(dataDirectory, { recursive: true, force: true });
});

test("serves the app and built-in starter pages", async () => {
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Stacks — Your library, your next story/);
  assert.match(html, /id="admin-nav"[^>]*hidden/);
  assert.match(html, /id="admin-login-dialog"/);
  const response = await fetch(`${baseUrl}/api/books/stacks-starter/pages`);
  assert.equal(response.status, 200);
  const { pages } = await response.json();
  assert.equal(pages.length, 3);
  assert.match(pages[0].paragraphs[0], /Mira/);
  const source = await fetch(`${baseUrl}/server.js`);
  assert.equal(source.status, 404);
});

test("shares uploaded PDFs and rejects unauthorized or invalid uploads", async () => {
  let response = await fetch(`${baseUrl}/api/admin/session`, { method: "POST" });
  assert.equal(response.status, 401);
  response = await fetch(`${baseUrl}/api/admin/session`, {
    method: "POST",
    headers: { "X-Admin-Token": "test-admin-key" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true });
  response = await fetch(`${baseUrl}/api/admin/session`);
  assert.equal(response.status, 405);

  const pdf = Buffer.from("%PDF-1.7\nshared library test\n%%EOF");
  response = await fetch(`${baseUrl}/api/books/quiet/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf", "X-File-Name": "shared.pdf" },
    body: pdf,
  });
  assert.equal(response.status, 401);

  response = await fetch(`${baseUrl}/api/books/quiet/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf", "X-Admin-Token": "test-admin-key" },
    body: Buffer.from("not a PDF"),
  });
  assert.equal(response.status, 400);

  response = await fetch(`${baseUrl}/api/books/quiet/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf", "X-Admin-Token": "test-admin-key", "X-File-Name": "shared.pdf" },
    body: pdf,
  });
  assert.equal(response.status, 201);

  const catalog = await fetch(`${baseUrl}/api/books`);
  assert.equal(catalog.status, 200);
  assert.equal((await catalog.json()).pdfs.quiet.filename, "shared.pdf");

  response = await fetch(`${baseUrl}/api/books/quiet/pdf`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
});
