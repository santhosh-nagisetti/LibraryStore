# Stacks Library

A small shared library app with a browser client and a built-in Node.js server. Admins can upload PDFs for catalog books; all visitors can browse and read those shared files. The original three-page starter story is included.

## Run

Install Node.js 18 or newer, then from the project directory:

```powershell
$env:STACKS_ADMIN_TOKEN = "replace-this-with-a-long-random-secret"
npm start
```

Open `http://127.0.0.1:3000`. Keep the admin key private. To allow other devices on a trusted local network to connect, set `HOST` to the server's private network address before starting it, for example `$env:HOST = "192.168.1.20"` in PowerShell, then open `http://192.168.1.20:3000` on those devices. Do not expose this demo over an untrusted network; use HTTPS and a hardened deployment for public access.

The server stores uploaded PDFs and their catalog metadata in the `data` directory. Uploads are limited to 25 MB per file and are shared by all clients using this server. Configure `STACKS_ADMIN_TOKEN` before starting the server; admin sign-in and uploads are disabled without it. Clients only see the public catalog and reader. Admins use **Admin sign-in** in the footer and enter the key; the upload page appears only after the server confirms the key. Admin access expires when the page is reloaded or signed out. The server independently checks the key for every upload. No user sign-in is required. Reading-list and membership demo data remains local to each browser.

## Tests

```powershell
npm test
```

## Included features

- Responsive catalog with search, category filters, and a browser-local reading list.
- Shared PDF upload protected by a server-configured admin key.
- In-project PDF reader for uploaded books and an original three-page starter story.
- Demo membership form saved only in the current browser.

The catalog's commercial book entries are descriptions only. Add legally obtained PDFs before they can be read in the project. Membership applications are not sent to a library; do not enter sensitive personal information.
