# Fraggell Footage Panel — Premiere Pro Extension

Browse and import footage from FootageStore directly into your Premiere Pro project. Files are imported **by reference only** — nothing is copied or moved.

---

## Installation

### Windows

1. Close Adobe Premiere Pro if it's open
2. Double-click **`install-windows.bat`**
3. Open Premiere Pro → **Window → Extensions → Fraggell Footage**

### Mac

1. Close Adobe Premiere Pro if it's open
2. Open Terminal, navigate to this folder and run:
   ```bash
   chmod +x install-mac.sh && ./install-mac.sh
   ```
   Or right-click `install-mac.sh` → Open With → Terminal
3. Open Premiere Pro → **Window → Extensions → Fraggell Footage**

### Updating

Same steps as above. Run the installer again with Premiere closed — it overwrites the previous version automatically. No need to uninstall first.

---

## Prerequisites

- **Google Drive Desktop** must be installed, signed in, and showing as connected
- You must have access to the **Fraggell Shared Drive** in your Google account
- Premiere Pro CC 2020 (v14) or later

---

## Signing in

Sign in with your **FootageStore account** (the same credentials you use at footagestore.fraggell.com).

Tick **Remember me** to stay signed in between sessions.

---

## Drive detection

After signing in, the panel scans for a Google Drive mount containing a `Footage Storage` folder. This happens automatically.

**If auto-detection works:** The panel opens straight to the client browser. Done.

**If you have multiple Shared Drives:** A picker appears — select the Fraggell footage library.

**If Google Drive isn't running:** An error screen explains what to do. Fix it, then click **Retry**.

---

## Usage

| Action | How |
|--------|-----|
| Browse footage | Click a client name in the left sidebar |
| Search | Type in the search bar |
| Filter by shot type | Click **Shot Type** dropdown |
| Filter by tags | Click **Tags** dropdown |
| Filter by SKU | Click **SKU** dropdown |
| Select a clip | Single click |
| Select multiple | Ctrl+click or Shift+click (Cmd+click on Mac) |
| Select all visible | Click **Select all** in the bottom bar |
| Import to project | Click **↓ Import to project** |
| Preview a clip | Single-click to open detail modal |
| Open in Google Drive | Click **Open in Google Drive** in the clip modal |
| Change detected drive | Click the folder icon in the header |
| Refresh clip list | Click the ↺ button in the header |
| Sign out | Click the ↩ button in the header |

---

## How import works

The panel finds the clip on the locally mounted Google Drive and calls Premiere's `importFiles()` with that path. The file stays in Google Drive — nothing is copied or moved. Import is instant, exactly like dragging the file from Finder/Explorer into Premiere manually.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Panel not visible in Window menu | Run the installer script again. Restart Premiere. |
| "Google Drive Desktop doesn't appear to be running" | Open Google Drive Desktop, sign in, wait for connected status, then click **Retry**. |
| "No Shared Drives are visible" | You may not have been added to the Fraggell Shared Drive. Contact Nick or Fraser. |
| "Session expired" banner | Click **Sign in again**. |
| Clip not found on Shared Drive | Check Google Drive Desktop is connected and synced. |
| Import fails | Make sure a Premiere project is open (not just the welcome screen). |
| No video preview in modal | Previews generate on demand — wait 30–60 seconds and reopen the clip. |

---

## Log file

If something goes wrong, the panel writes a log to:

**Windows:** `C:\Users\[you]\AppData\Roaming\FraggellFootagePanel\panel.log`

**Mac:** `~/Library/Logs/FraggellFootagePanel/panel.log`

Share this file with Nick when reporting an issue.

---

## Running tests

```bash
node test/run.js
```
