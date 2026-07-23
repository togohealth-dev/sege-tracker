# Ops Assistant — Google Workspace task & email nagger

A background Google Apps Script that watches **your own Google Tasks + Gmail** and emails
you an **escalating daily digest**:

- **Overdue Google Tasks** (your to-dos with due dates)
- **Emails awaiting a reply** — threads you tag with the `Follow-up` label
- **Unanswered inbox mail** — messages you haven't replied to

Items escalate the longer they sit, and the digest can CC a manager once something
crosses a threshold. **No spreadsheet, no app to open** — it just runs in the background.

Each person runs **their own copy** under their own Google account. The script only ever
reads *your* inbox and tasks and only emails *you* (and your chosen manager on escalations).
Nothing is centralized and no message bodies are copied anywhere.

---

## Install — option A: copy/paste (no tools, ~5 min)

1. Go to **[script.google.com](https://script.google.com)** → **New project**.
2. Replace the default `Code.gs` with the contents of [`Code.gs`](./Code.gs).
3. Click the ⚙️ **Project Settings** → check **"Show appsscript.json manifest file"**.
   Open the `appsscript.json` tab and paste in [`appsscript.json`](./appsscript.json).
4. In the left sidebar click **Services (＋)** and add **Google Tasks API**.
5. Select the **`setup`** function in the toolbar dropdown → **Run** → approve the
   permissions (Gmail, Tasks, send-email, triggers). If it warns "unverified," choose
   **Advanced ▸ Go to project**.
6. Select **`sendDigestNow`** → **Run** → check your inbox for a test digest. Done.

## Install — option B: command line (for developers)

```bash
npm install -g @google/clasp
clasp login
clasp create --type standalone --title "Ops Assistant" --rootDir .
clasp push -f
```
Then open the project (`clasp open-script`) and run `setup`, then `sendDigestNow`.

---

## Using it

- **Tasks:** add to-dos in **Google Tasks** (Gmail/Calendar sidebar, or the Google Tasks
  phone app) **with a due date**. They sync to your account, so anything you add on your
  phone shows up in the digest.
- **Chase a reply:** put the **`Follow-up`** label on any thread you're waiting to hear back
  on. It's nagged until a reply arrives, then drops off automatically.
- **Inbox:** anything you haven't answered after a couple of days is surfaced for you.

## Settings (run from the editor)

```
setConfig('MANAGER_EMAIL', 'manager@example.com')  // who gets CC'd on urgent items
setConfig('WAITING_DAYS', '3')       // days before an awaiting-reply thread is chased
setConfig('INBOX_REPLY_DAYS', '2')   // days an unanswered inbox email can sit
setConfig('ESCALATE_DAYS', '5')      // older than this = URGENT + CC manager
setConfig('DIGEST_HOUR', '7')        // hour the daily digest sends
showConfig()                          // print current settings
```

## Notes

- Runs entirely inside your Google account. Free (within normal Apps Script quotas).
- An optional **SMS-on-urgent-items** add-on is planned (Phase 2); the hook is stubbed.
- Keep sensitive data out of task titles and this tool — it is not a record system.
