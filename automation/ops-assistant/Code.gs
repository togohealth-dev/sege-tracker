/**
 * TogoHealth Ops Assistant — a background Google Workspace assistant.
 * NO spreadsheet, NO UI. It watches your Google Tasks + Gmail and emails you a
 * daily digest that escalates the longer things sit (and CCs a manager past a threshold).
 *
 * Surfaces you actually touch:
 *   • Google Tasks  — add to-dos with DUE DATES (your "sticky note").
 *   • Gmail label   — put the "Follow-up" label on a thread you're awaiting a reply to.
 *   • Gmail inbox   — anything you haven't replied to gets nagged automatically.
 *
 * SETUP: in the Apps Script editor, run  setup()  once and approve the permissions.
 * That seeds config, creates the Gmail label, and installs the daily trigger.
 *
 * HIPAA: this reads subject lines + task titles for YOUR own digest only; it never
 * copies message bodies anywhere and never sends anything to third parties.
 */

// ---- Config keys (stored in Script Properties; edit via setConfig) ----------
const DEFAULTS = {
  OWNER_EMAIL: '',        // filled from the active user at setup
  MANAGER_EMAIL: '',      // escalation CC; defaults to owner
  FOLLOWUP_LABEL: 'Follow-up',
  WAITING_DAYS: '3',      // labeled thread w/ no reply for this long → chase it
  INBOX_REPLY_DAYS: '2',  // inbound email you haven't answered this long → nag
  ESCALATE_DAYS: '5',     // anything older than this → URGENT + CC manager
  DIGEST_HOUR: '7',       // hour of day the digest is emailed
  LOOKBACK_DAYS: '30',    // how far back to scan the inbox
};

function getConfig_() {
  const p = PropertiesService.getScriptProperties();
  const c = {};
  Object.keys(DEFAULTS).forEach(k => c[k] = p.getProperty(k) || DEFAULTS[k]);
  if (!c.OWNER_EMAIL) c.OWNER_EMAIL = Session.getActiveUser().getEmail();
  if (!c.MANAGER_EMAIL) c.MANAGER_EMAIL = c.OWNER_EMAIL;
  ['WAITING_DAYS', 'INBOX_REPLY_DAYS', 'ESCALATE_DAYS', 'DIGEST_HOUR', 'LOOKBACK_DAYS']
    .forEach(k => c[k] = parseInt(c[k], 10));
  return c;
}

// =========================== SETUP (run once) ===============================
function setup() {
  const p = PropertiesService.getScriptProperties();
  const email = Session.getActiveUser().getEmail();
  Object.keys(DEFAULTS).forEach(k => { if (!p.getProperty(k)) p.setProperty(k, DEFAULTS[k]); });
  if (!p.getProperty('OWNER_EMAIL')) p.setProperty('OWNER_EMAIL', email);
  if (!p.getProperty('MANAGER_EMAIL')) p.setProperty('MANAGER_EMAIL', email);

  const label = p.getProperty('FOLLOWUP_LABEL') || DEFAULTS.FOLLOWUP_LABEL;
  if (!GmailApp.getUserLabelByName(label)) GmailApp.createLabel(label);

  installDailyTrigger();
  Logger.log('✅ Setup complete for ' + email +
    '\n• Gmail label "' + label + '" ready — tag threads you are awaiting a reply on.' +
    '\n• Daily digest trigger installed.' +
    '\n• Change settings with setConfig("MANAGER_EMAIL","manager@example.com") etc.' +
    '\n• Test right now with sendDigestNow().');
}

/** Edit any config value from the editor, e.g. setConfig('WAITING_DAYS','4'). */
function setConfig(key, value) {
  if (!(key in DEFAULTS)) throw new Error('Unknown key: ' + key);
  PropertiesService.getScriptProperties().setProperty(key, String(value));
  if (key === 'DIGEST_HOUR') installDailyTrigger(); // reschedule
  Logger.log('Set ' + key + ' = ' + value);
}

function showConfig() { Logger.log(JSON.stringify(getConfig_(), null, 2)); }

// =========================== TRIGGERS =======================================
function installDailyTrigger() {
  removeDailyTrigger();
  const hour = getConfig_().DIGEST_HOUR;
  ScriptApp.newTrigger('dailyDigest').timeBased().atHour(hour).everyDays(1).create();
}
function removeDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyDigest')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

// =========================== ENTRY POINTS ===================================
/** The daily trigger fires this. */
function dailyDigest() { buildAndSend_(false); }

/** Run from the editor to email yourself the digest immediately (for testing). */
function sendDigestNow() { buildAndSend_(true); }

// =========================== GATHER =========================================
/** Overdue / due-today / due-soon Google Tasks, across all task lists. */
function getTasks_() {
  const out = { overdue: [], today: [], soon: [], unavailable: false };
  // Google Tasks needs the "Tasks" advanced service enabled. Degrade gracefully if it isn't.
  if (typeof Tasks === 'undefined') { out.unavailable = true; return out; }
  let lists;
  try { lists = (Tasks.Tasklists.list().items) || []; }
  catch (e) { out.unavailable = true; return out; }
  const today = startOfToday_();
  const soonEnd = addDays_(today, 3);
  lists.forEach(l => {
    let pageToken = null;
    do {
      const res = Tasks.Tasks.list(l.id, { showCompleted: false, showHidden: false, maxResults: 100, pageToken: pageToken });
      (res.items || []).forEach(t => {
        if (t.status === 'completed' || !t.due) return;
        const dd = parseTaskDate_(t.due);           // date-only, TZ-safe
        const item = { list: l.title, title: t.title || '(untitled)', due: dd, notes: t.notes || '',
                       daysOver: Math.round((today - dd) / 86400000) };
        if (dd < today) out.overdue.push(item);
        else if (dd.getTime() === today.getTime()) out.today.push(item);
        else if (dd <= soonEnd) out.soon.push(item);
      });
      pageToken = res.nextPageToken;
    } while (pageToken);
  });
  out.overdue.sort((a, b) => b.daysOver - a.daysOver);
  return out;
}

/** Threads you labeled "Follow-up" where YOU sent last and no reply has come. */
function getFollowups_(cfg) {
  const out = [];
  const threads = GmailApp.search('label:"' + cfg.FOLLOWUP_LABEL + '"', 0, 50);
  const now = new Date();
  threads.forEach(th => {
    const msgs = th.getMessages();
    const last = msgs[msgs.length - 1];
    const iSentLast = ownsAddress_(last.getFrom(), cfg.OWNER_EMAIL);
    const ageDays = Math.floor((now - last.getDate()) / 86400000);
    if (iSentLast && ageDays >= cfg.WAITING_DAYS) {
      out.push({ subject: th.getFirstMessageSubject() || '(no subject)', who: last.getTo(),
                 ageDays: ageDays, url: th.getPermalink() });
    }
  });
  out.sort((a, b) => b.ageDays - a.ageDays);
  return out;
}

/** Inbox threads where someone else sent last and you haven't replied. */
function getUnanswered_(cfg) {
  const out = [];
  const q = 'in:inbox -label:"' + cfg.FOLLOWUP_LABEL + '" newer_than:' + cfg.LOOKBACK_DAYS + 'd';
  const threads = GmailApp.search(q, 0, 60);
  const now = new Date();
  threads.forEach(th => {
    const msgs = th.getMessages();
    const last = msgs[msgs.length - 1];
    const iSentLast = ownsAddress_(last.getFrom(), cfg.OWNER_EMAIL);
    const ageDays = Math.floor((now - last.getDate()) / 86400000);
    if (!iSentLast && ageDays >= cfg.INBOX_REPLY_DAYS) {
      out.push({ subject: th.getFirstMessageSubject() || '(no subject)', who: last.getFrom(),
                 ageDays: ageDays, url: th.getPermalink() });
    }
  });
  out.sort((a, b) => b.ageDays - a.ageDays);
  return out;
}

// =========================== BUILD & SEND ===================================
function buildAndSend_(isTest) {
  const cfg = getConfig_();
  const tasks = getTasks_();
  const followups = getFollowups_(cfg);
  const unanswered = getUnanswered_(cfg);

  const esc = cfg.ESCALATE_DAYS;
  const urgentCount =
    tasks.overdue.filter(t => t.daysOver >= esc).length +
    followups.filter(f => f.ageDays >= esc).length +
    unanswered.filter(u => u.ageDays >= esc).length;

  const total = tasks.overdue.length + tasks.today.length + tasks.soon.length
    + followups.length + unanswered.length;

  // Nothing to nag about — stay quiet on the scheduled run; still confirm on a manual test.
  if (total === 0 && !isTest) return;

  const html = renderDigest_(cfg, tasks, followups, unanswered, urgentCount, isTest);
  const subject = (urgentCount > 0 ? '🚨 ' : '📋 ') +
    'Ops digest — ' + tasks.overdue.length + ' overdue task(s), ' +
    followups.length + ' to chase, ' + unanswered.length + ' unanswered' +
    (isTest ? ' [TEST]' : '');

  const opts = { htmlBody: html, name: 'TogoHealth Ops Assistant' };
  if (urgentCount > 0 && cfg.MANAGER_EMAIL && cfg.MANAGER_EMAIL !== cfg.OWNER_EMAIL) {
    opts.cc = cfg.MANAGER_EMAIL; // escalate
  }
  GmailApp.sendEmail(cfg.OWNER_EMAIL, subject, htmlToText_(html), opts);

  // Phase 2 hook — SMS the urgent items via an optional SMS provider (Phase 2 add-on).
  // if (urgentCount > 0) sendSmsPhase2_(cfg, urgentCount);
}

function renderDigest_(cfg, tasks, followups, unanswered, urgentCount, isTest) {
  const esc = cfg.ESCALATE_DAYS;
  const tz = Session.getScriptTimeZone();
  const badge = d => d >= esc ? '<span style="background:#c5221f;color:#fff;padding:1px 6px;border-radius:8px;font-size:11px">URGENT</span> ' : '';

  let h = '<div style="font-family:Arial,sans-serif;max-width:640px;color:#202124">';
  h += '<h2 style="margin:0 0 4px">TogoHealth Ops digest</h2>';
  h += '<div style="color:#5f6368;font-size:12px;margin-bottom:12px">' +
       Utilities.formatDate(new Date(), tz, 'EEEE, MMM d, yyyy') +
       (urgentCount > 0 ? ' · <b style="color:#c5221f">' + urgentCount + ' urgent</b>' : '') + '</div>';

  h += section_('🔴 Overdue tasks', tasks.overdue.map(t =>
    badge(t.daysOver) + esc_(t.title) + ' <span style="color:#c5221f">— ' + t.daysOver + 'd overdue</span>' +
    grey_(' · ' + t.list)));
  h += section_('⏳ Emails to chase (awaiting reply)', followups.map(f =>
    badge(f.ageDays) + link_(f.url, esc_(f.subject)) + grey_(' — to ' + shortAddr_(f.who) + ' · ' + f.ageDays + 'd')));
  h += section_('📨 Unanswered in your inbox', unanswered.map(u =>
    badge(u.ageDays) + link_(u.url, esc_(u.subject)) + grey_(' — from ' + shortAddr_(u.who) + ' · ' + u.ageDays + 'd')));
  h += section_('📅 Due today', tasks.today.map(t => esc_(t.title) + grey_(' · ' + t.list)));
  h += section_('🗓️ Due in the next 3 days', tasks.soon.map(t =>
    esc_(t.title) + grey_(' · ' + Utilities.formatDate(t.due, tz, 'EEE MMM d') + ' · ' + t.list)));

  if (tasks.unavailable) {
    h += '<p style="background:#fce8e6;color:#c5221f;padding:8px;border-radius:4px">' +
         '⚠️ Google Tasks isn\'t connected yet, so task nagging is off. Enable it once: in the Apps Script ' +
         'editor, click <b>Services (＋)</b> in the left sidebar and add <b>Google Tasks API</b>.</p>';
  } else if (!followups.length && !unanswered.length && !tasks.overdue.length && !tasks.today.length && !tasks.soon.length) {
    h += '<p style="color:#137333">All clear — nothing overdue, due, or waiting. 🎉</p>';
  }
  h += '<hr style="border:0;border-top:1px solid #eee;margin:16px 0">';
  h += '<div style="color:#9aa0a6;font-size:11px">Tag a thread with the "' + esc_(cfg.FOLLOWUP_LABEL) +
       '" label to have it chased. Add to-dos in Google Tasks with a due date. ' +
       (isTest ? 'This was a manual test run.' : 'Daily at ' + cfg.DIGEST_HOUR + ':00.') + '</div></div>';
  return h;
}

function section_(title, items) {
  if (!items || !items.length) return '';
  return '<h3 style="margin:14px 0 6px;font-size:14px">' + title + ' (' + items.length + ')</h3>' +
    '<ul style="margin:0;padding-left:18px;line-height:1.6">' +
    items.map(i => '<li>' + i + '</li>').join('') + '</ul>';
}

// Phase 2 stub — no-op until an SMS provider is configured (Phase 2).
function sendSmsPhase2_(cfg, urgentCount) { /* no-op in Phase 1 */ }

// =========================== HELPERS ========================================
function startOfToday_() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function addDays_(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function parseTaskDate_(due) { const p = due.substring(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function ownsAddress_(fromHeader, owner) { return String(fromHeader).toLowerCase().indexOf(String(owner).toLowerCase()) !== -1; }
function shortAddr_(s) { const m = String(s).match(/<([^>]+)>/); return m ? m[1] : String(s); }
function esc_(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function grey_(s) { return '<span style="color:#9aa0a6">' + s + '</span>'; }
function link_(url, text) { return url ? '<a href="' + url + '" style="color:#1a73e8;text-decoration:none">' + text + '</a>' : text; }
function htmlToText_(h) { return h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
