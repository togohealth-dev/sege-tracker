# Facility Welcome Email â€” Auto-Draft (Mac mini)

Creates a Gmail **draft** (never auto-sends) for a new building's welcome email.
Step 1 of the 8-week facility onboarding sequence. Runs on the Mac mini (192.168.1.190) under `~/claude-agent/`.

- **Auth scope:** `gmail.compose` only â€” the script *cannot* send email or read the inbox, only create drafts.
- **PHI:** none (facility name + business emails only) â€” within BAA scope.
- **Confirmation rule:** draft only; Riley reviews and sends manually.

---

## One-time setup (on the Mac mini)

1. **Enable the Gmail API**
   - console.cloud.google.com â†’ select the `grabmd` project (or create `togo-automation`)
   - APIs & Services â†’ Library â†’ search **Gmail API** â†’ **Enable**

2. **Create OAuth credentials**
   - APIs & Services â†’ Credentials â†’ Create Credentials â†’ **OAuth client ID**
   - Application type: **Desktop app**, name "Togo Welcome Draft"
   - Download the JSON â†’ save as `~/claude-agent/credentials.json`

3. **OAuth consent screen**
   - Add `riley@togohealth.com` as a test user (or publish internally under the Workspace org)
   - Scope: `.../auth/gmail.compose`

4. **Install dependencies**
   ```
   pip3 install google-api-python-client google-auth-httplib2 google-auth-oauthlib
   ```

5. **First run** â€” authorizes once (opens a browser), saves `token.json`:
   ```
   python3 welcome_draft.py --facility "Test Building" --to "riley@togohealth.com"
   ```

---

## Usage â€” every new building

```
python3 welcome_draft.py --facility "Sunrise Senior Living" --to "admin@sunrise.com,don@sunrise.com"
```

â†’ Draft appears in riley@togohealth.com Drafts. Review, confirm recipients, send.

---

## Files

| File | Purpose | Commit to git? |
|------|---------|----------------|
| `welcome_draft.py` | The script | âœ… yes |
| `credentials.json` | OAuth client secret from Google Cloud | âŒ NO â€” secret, keep on mini only |
| `token.json` | Saved auth token (created on first run) | âŒ NO â€” secret, keep on mini only |

**Both `credentials.json` and `token.json` are secrets â€” never commit them.** Add them to `.gitignore`.

---

## Next / tie-ins
- [ ] Log each draft to the onboarding timeline tracker (Issue #2 â€” 8-Week Onboarding Framework)
- [ ] Pull recipient emails from the Stakeholder Contact Map (Issue #4) instead of the `--to` flag
- [ ] Trigger on contract-signed event once the timeline framework (Issue #2) exists

**Template source of truth:** the approved welcome email in tracker Issue #26.
