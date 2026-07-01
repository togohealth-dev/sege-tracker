#!/usr/bin/env python3
"""
TogoHealth â€” Facility Welcome Email Draft Generator
Runs on the Mac mini (192.168.1.190) under ~/claude-agent/

Creates a Gmail DRAFT (never auto-sends) for a new building's welcome email.
Step 1 of the 8-week facility onboarding sequence.

Usage:
    python3 welcome_draft.py --facility "Sunrise Senior Living" --to "admin@sunrise.com,don@sunrise.com"

The draft lands in riley@togohealth.com Drafts for review + manual send.
No PHI involved (facility name + business email only), so BAA scope is satisfied.
"""

import argparse
import base64
import os
from email.mime.text import MIMEText

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# Draft scope only â€” cannot send, cannot read inbox. Least-privilege.
SCOPES = ["https://www.googleapis.com/auth/gmail.compose"]

# Files live alongside the script in ~/claude-agent/
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CREDENTIALS_FILE = os.path.join(BASE_DIR, "credentials.json")   # from Google Cloud Console
TOKEN_FILE = os.path.join(BASE_DIR, "token.json")               # created on first run

SENDER = "riley@togohealth.com"
SUBJECT = "Welcome to TogoHealth"

BODY_TEMPLATE = """{facility} Team,

We are so glad to have you with us. Welcome to TogoHealth â€” we are excited to get started and looking forward to building a great partnership with your team.

Over the next 8 weeks we will be working closely with you to get everything set up and running smoothly. You will hear from me regularly as we work through onboarding, and I am always just a call or email away if you need anything along the way.

Again, welcome. We are glad you are here.

Riley
Operations Lead, TogoHealth
385-207-9919
riley@togohealth.com
"""


def get_service():
    """Authenticate to Gmail. First run opens a browser for one-time consent."""
    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "w") as token:
            token.write(creds.to_json())
    return build("gmail", "v1", credentials=creds)


def create_draft(service, facility, to_addr):
    body = BODY_TEMPLATE.format(facility=facility)
    message = MIMEText(body)
    message["to"] = to_addr
    message["from"] = SENDER
    message["subject"] = SUBJECT
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    draft = service.users().drafts().create(
        userId="me", body={"message": {"raw": raw}}
    ).execute()
    return draft


def main():
    parser = argparse.ArgumentParser(description="Create a TogoHealth facility welcome email draft.")
    parser.add_argument("--facility", required=True, help="Facility / building name")
    parser.add_argument("--to", default="", help="Comma-separated recipient emails (Admin, DON)")
    args = parser.parse_args()

    service = get_service()
    draft = create_draft(service, args.facility, args.to)
    print(f"âœ… Draft created for '{args.facility}' (id: {draft['id']}).")
    print(f"   Open Gmail â†’ Drafts to review and send.")
    # TODO: log this to the onboarding timeline tracker (ties to tracker Issue #2)


if __name__ == "__main__":
    main()
