# PORTAL SKR HTPN e-RUJUKAN

A web form where each HTPN department enters its **estimated monthly referral cases** to the public university teaching hospitals (PPUM, HSAAS UPM, HTABTAR UKM) for the **31 DRGs** of the Sinergi Kesihatan Rakyat (SKR) 2027 initiative. The request comes from BPP KKM, ref. KKM.600-1/4/20 JLD 8 (27), dated 6 Nov 2026, and the deadline is **20 Nov 2026**.

- **Front end:** `index.html` (one vanilla HTML file, in the same printed-poster UI as PPTUK e-CLINICAL), hosted on GitHub Pages.
- **Back end:** `apps-script/Code.gs`, a Google Apps Script bound to a Google Sheet.

## How the data flows

1. **01 / Pilih Jabatan:** the head of department picks their department or specialty from a dropdown. The list matches the "Kepakaran Terlibat" column of the KKM table.
2. **03 / Anggaran Kes:** only the DRGs for that specialty are shown (for example, 13 for Perubatan Am and 5 for O&G). They enter raw numbers (cases per month), review them, and submit. Numbers are kept separately for each department, and only the chosen department's DRGs are sent.
3. Apps Script appends one row per DRG to **`Respons`**, the audit log.
4. It then rebuilds **`Format KKM`**, an exact copy of the KKM template. Column L (*Hospital Tengku Permaisuri Norashikin, Kajang.*) holds the sum of all active submissions. This has been checked cell by cell against `Bil. Kes SKR Hospital KKM - Sheet1.csv` with zero differences.
5. **`Pecahan Jabatan`** shows the DRG × department breakdown and the list of active submissions.

**Resubmission rule.** A new submission from the same department replaces that department's previous one: the old rows are marked `DIGANTI` and only `AKTIF` rows are counted.

## Setup (about 10 minutes)

### 1. Google Sheet + Apps Script
1. Create a new Google Sheet, e.g. *SKR HTPN 2027 — Anggaran Kes Rujukan*.
2. Go to **Extensions → Apps Script**. Delete the sample code and paste in all of `apps-script/Code.gs`. Save.
3. Choose **`setupSheets`** in the function dropdown and click **Run**. Authorise it with the HIO Google account. This creates `Format KKM`, `Pecahan Jabatan` and `Respons`.
4. Optional: open **Project Settings (⚙) → Script Properties** and add `NOTIFY_EMAIL`, an address that gets an email on every submission.

   There's no login or access code, because the link is shared directly with heads of department. Leave `ACCESS_CODE` **unset**: the form no longer sends a code, so setting it would block every submission.
5. Go to **Deploy → New deployment → Web app**. Set *Execute as*: **Me**, and *Who has access*: **Anyone**. Deploy, then copy the **Web app URL** (`https://script.google.com/macros/s/…/exec`).

### 2. Connect the front end
In `index.html`, replace:
```js
const API_URL = "PASTE_APPS_SCRIPT_WEB_APP_URL_HERE";
```
with the Web app URL from step 1.5.

### 3. Publish on GitHub Pages
Push `index.html`, `images/`, `apps-script/`, `README.md` and `.gitignore` to a repo under the `udppkhtpn-hue` account. Then go to **Settings → Pages → Deploy from branch → `main` / root**. The site is live in about 2 minutes at `https://udppkhtpn-hue.github.io/<repo-name>/`.

The `.gitignore` keeps the official KKM letter (PDF) and template (CSV) out of the public repo.

### Updating the script later
After editing `Code.gs`, go to **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. This keeps the same URL, so `index.html` doesn't need to change.

## Sending to KKM
Open the **`Format KKM`** sheet. Its layout matches the KKM template, so the HTPN column can be copied directly into KKM's form at https://bit.ly/kesSKR, which needs MyGovUC email access. To refresh it by hand, use the **Portal SKR → Kemas kini Format KKM** menu.

## Local preview
```bash
python3 -m http.server 4321
```
Until `API_URL` is set, submitting shows a "not connected" message. Drafts are saved in the browser's localStorage.

Technical support: ferwahn@moh.gov.my · Healthcare Intelligence Office (HIO) HTPN Kajang
