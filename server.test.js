const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createServer } = require("./server");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "stacks-test-"));
const server = createServer({ dataFile: path.join(temporaryDirectory, "library.json") });
let baseUrl;
before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});
async function getState() {
  const response = await fetch(`${baseUrl}/api/state`);
  assert.equal(response.status, 200);
  return response.json();
}
async function saveState(state, revision) {
  return fetch(`${baseUrl}/api/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, revision })
  });
}
test("serves the app and persists validated records", async () => {
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Stacks — Your library, your next story/);
  const initial = await getState();
  const state = {
    books: [{ id: "book-1", title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", category: "Fiction" }],
    users: [{ id: "user-1", name: "Rae Reader", email: "rae@example.edu", createdAt: new Date().toISOString() }],
    loans: []
  };
  const saved = await saveState(state, initial.revision);
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).state, state);
  assert.deepEqual((await getState()).state, state);
});
test("enforces borrowing limits and prevents borrowing an unavailable book", async () => {
  let current = await getState();
  const books = [1, 2, 3, 4].map((number) => ({ id: `book-${number}`, title: `Title ${number}`, author: "Author", category: "Fiction" }));
  const users = [{ id: "user-1", name: "Reader", email: "", createdAt: new Date().toISOString() }];
  let state = { books, users, loans: [] };
  let response = await saveState(state, current.revision);
  assert.equal(response.status, 200);
  current = await response.json();
  const borrowedAt = new Date().toISOString();
  state = { ...state, loans: [1, 2, 3].map((number) => ({
    id: `loan-${number}`, bookId: `book-${number}`, userId: "user-1",
    bookTitle: `Title ${number}`, bookAuthor: "Author", userName: "Reader", borrowedAt, returnedAt: null
  })) };
  response = await saveState(state, current.revision);
  assert.equal(response.status, 200);
  current = await response.json();
  const fourthLoan = { id: "loan-4", bookId: "book-4", userId: "user-1", bookTitle: "Title 4", bookAuthor: "Author", userName: "Reader", borrowedAt, returnedAt: null };
  response = await saveState({ ...state, loans: [...state.loans, fourthLoan] }, current.revision);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /already has 3 active borrowings/)
  const duplicateBookLoan = { ...fourthLoan, id: "loan-5", bookId: "book-1" };
  response = await saveState({ ...state, loans: [...state.loans, duplicateBookLoan] }, current.revision);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /one active borrowing/);
});
test("keeps existing over-limit records, permits returns, and detects stale writes", async () => {
  const legacyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "stacks-legacy-test-"));
  const fiveBooks = [1, 2, 3, 4, 5].map((number) => ({ id: `legacy-book-${number}`, title: `Legacy ${number}`, author: "Author", category: "History" }));
  const user = { id: "legacy-user", name: "Legacy Reader", email: "", createdAt: new Date().toISOString() };
  const borrowedAt = new Date().toISOString();
  const loans = [1, 2, 3, 4].map((number) => ({
    id: `legacy-loan-${number}`, bookId: `legacy-book-${number}`, userId: user.id,
    bookTitle: `Legacy ${number}`, bookAuthor: "Author", userName: user.name, borrowedAt, returnedAt: null
  }));
  const dataFile = path.join(legacyDirectory, "library.json");
  fs.writeFileSync(dataFile, JSON.stringify({ books: fiveBooks, users: [user], loans }));
  const legacyServer = createServer({ dataFile });
  try {
    await new Promise((resolve) => legacyServer.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${legacyServer.address().port}/api/state`;
    let response = await fetch(url);
    let current = await response.json();
    const updated = { ...current.state, loans: current.state.loans.map((loan, index) => index === 0 ? { ...loan, returnedAt: new Date().toISOString() } : loan) };
    response = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: updated, revision: current.revision }) });
    assert.equal(response.status, 200);
    current = await response.json();
    response = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: updated, revision: current.revision - 1 }) });
    assert.equal(response.status, 409);
    response = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: { ...updated, loans: updated.loans.slice(1) }, revision: current.revision }) });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /cannot be deleted/);
  } finally {
    await new Promise((resolve, reject) => legacyServer.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(legacyDirectory, { recursive: true, force: true });
  }
});