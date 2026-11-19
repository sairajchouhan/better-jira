# Offline edits

A user who loses the connection can keep editing. The app says each change is waiting, sends it once the connection is back, and Jira receives each change exactly once, even after a reload.

## Sub-features

- `offline-queue`: an edit made offline shows as waiting and is not sent.
- `offline-send`: on reconnect the edit reaches Jira and the status reads `Saved to Jira`.
- `offline-once`: the edit lands once, with no duplicate after a reload.
- `offline-early`: an edit made offline before the app finished loading. Fake Jira only, see Gotchas.

## How to get to it (user POV)

- Lose the connection with an issue open, then edit its title or a property.
- Lose the connection, then edit a property from a board card (`Priority on <KEY>`, `Status on <KEY>`).

## Driving it with browse (real Jira)

Preconditions:

- `verify.sh doctor` passes, the tab is on the instance, and the app has been loaded for a few seconds (`page.waitForLoadState("networkidle")`).
- SAM1-9 is titled `Optimize Performance of the Application`.

- **Record Jira.** `verify.sh jira '/rest/api/3/issue/SAM1-9?fields=summary,updated' > $D/jira-before.json`.
- **Open the issue.** `page.getByText("Optimize Performance of the Application", { exact: true }).first().click()`. The textbox `Issue title` holds that title, and the URL ends `?issue=SAM1-9`.
- **Go offline.** `await browse.emulate({ offline: true })`. `navigator.onLine` is `false`.
- **Edit.** Fill `Issue title` with `Optimize Performance of the Application (offline edit)` and press Tab. `Jira save status` reads `Still sending 1 to Jira: SAM1-9: Can't reach the better-jira server. Retrying…`. Screenshot it.
- **Jira unchanged.** `verify.sh jira …` still shows the old summary and `updated`.
- **Reconnect.** `await browse.emulate({ offline: false })`. Within 15 s the status reads `Saved to Jira`.
- **Reload.** After `page.reload()`, `Issue title` holds the new title and the card reads `Drag SAM1-9 Optimize Performance of the Application (offline edit)`.
- **Once.** `verify.sh jira '/rest/api/3/issue/SAM1-9/changelog'` has exactly one new `summary` entry, old → new.
- **Put back.** Fill `Issue title` with the original title, Tab, wait for `Saved to Jira`, and confirm with `verify.sh jira`.

On fake Jira: `bunx playwright test sync-data-integrity -g "57"` runs both sub-flows, including the drop before load.

## Gotchas

- `offline-early` can't be made on demand on real Jira. The connection has to drop while the app is still fetching the code a write needs. The e2e test does it with `page.route`. It is a known bug: the edit is lost. Its e2e test is marked `test.fail()`.
- Retries wait 5 s after a failure, so give `Saved to Jira` 15 s.
- Offline emulation covers the whole tab, including the app's event stream. Other tabs keep their connection.
