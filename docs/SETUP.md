# Setup

Manual steps, in order. Values in `<angle brackets>` are yours; never commit them.

## 1. Telegram bot

1. In Telegram, open `@BotFather`, send `/newbot`, pick a name and a username. Copy the token (`<BOT_TOKEN>`).
2. Send any message to your new bot, then open `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates` in a browser. Copy `result[0].message.chat.id` (`<CHAT_ID>`). That message stays queued and lands in `Inbox` once polling starts in step 3.6; delete its row before section 5.

## 2. Google Sheet

1. Create an empty Google Sheet (any name).
2. Copy its id from the URL, the part between `/d/` and `/edit` (`<SHEET_ID>`).

## 3. Apps Script (capture, always on)

1. Open https://script.google.com, click **New project**.
2. Replace `Code.gs` with `apps-script/Code.gs`. Add a script file `Seed` and paste `apps-script/Seed.gs`.
3. **Project Settings** > tick **Show "appsscript.json" manifest file in editor**, then replace `appsscript.json` with `apps-script/appsscript.json`.
4. **Project Settings** > **Script Properties**, add:
   - `BOT_TOKEN` = `<BOT_TOKEN>`
   - `ALLOWED_CHAT_ID` = `<CHAT_ID>`
   - `SHEET_ID` = `<SHEET_ID>`
5. In the editor select `setup` and click **Run**; approve the permissions. The Sheet now has the tabs Inbox, Transactions, Accounts, Categories, Recurring, State. `setup` only adds what is missing, so it is safe to run again after an update (that is how an existing Sheet gets the `Recurring` tab: paste the new `Code.gs` and `Seed.gs`, run `setup`).
6. Select `installPolling` and click **Run**; approve the permissions. It removes any old webhook and adds a trigger that runs `pollUpdates` every minute (check **Triggers**, the clock icon). No web app deployment is needed: a web app answers Telegram with a 302 redirect, which Telegram counts as a failed delivery and then stops delivering newer messages.
7. Send `test` to the bot. Within about a minute you get `📥 Received` and a row with `status=new` in `Inbox`. (Delete that row before step 5 below, or it will be processed.)

Script Properties `TG_OFFSET` and `TG_TRIES` are written by `pollUpdates`; leave them alone. A message whose Sheet write fails is retried on the next two runs, then skipped with a `🔴` reply.

## 4. Sheet values

1. `State` tab: set `llm_model` to the OpenAI model id you chose (replace `SET_ME`). It must support image input and structured outputs (`response_format` with `json_schema`).
2. Opening balances. If a large monthly debit (a mortgage, for example) is about to land, set them after it has cleared, so it is already inside the bank balance.
   - `Accounts` tab: for each account set `opening_balance` (the balance shown in your bank app or old ledger, whole rupiah) and `opening_date` (cutover day, `YYYY-MM-DD`). Do not edit the `balance` column; it is a formula.
3. `Recurring` tab (one row per rule; `/recurring` shows what the bot understood and when each rule is next due):
   - `type` expense, income or transfer; `account` (and `to_account` for a transfer) as in `Accounts`; `category_id` as in `Categories`.
   - `cycle` weekly, monthly or yearly; `interval` 1 = every cycle, 2 = every second one; `day` is 1 to 31 for monthly (29 to 31 fall back to the last day of a short month), `mon` to `sun` for weekly, `MM-DD` for yearly.
   - `start_date` is the first day the rule may fire, `YYYY-MM-DD`. Set it to the next due date, or the bot logs the dates since then as well (more than 12 at once is refused). `end_date` empty = never ends.
   - `mode` `auto` writes the entry, dated on the due date; `reminder` only sends a message. `active` TRUE or FALSE. Leave `last_run` to the bot.
   - The rules run every day at 07:00 and when n8n starts; dates missed while the computer was off are caught up. The seed rule (a mortgage on the 5th) is an example: change or delete it.
4. Keep `Transactions` columns A to F (`id` to `txn_time`) as plain text: select the column headers > **Format** > **Number** > **Plain text**. When you fix a date in the Sheets app, type it as `2026-11-01`.

## 5. n8n

1. Start n8n: `npx n8n@2.45.5`, open http://localhost:5678, create the owner account.
2. Create three credentials (**Overview** > **Create** > **Credential**) with exactly these names:
   - `Google Sheets`: type **Google Sheets OAuth2 API**. Follow the n8n guide for a Google Cloud OAuth client (enable the Google Sheets API), then **Sign in with Google**.
   - `Telegram Bot`: type **Telegram API**, access token `<BOT_TOKEN>`.
   - `OpenAI`: type **OpenAI**, API key from the OpenAI dashboard.
3. Stop n8n (Ctrl+C), then from the project folder run:
   `npx n8n@2.45.5 import:workflow --separate --input=n8n/dist`
   The import keeps the workflow ids and links the credentials by name, which is why step 2 comes first. Start n8n again.
4. Fill the **Config** node (one edit per workflow):
   - **Process Inbox**: `sheetId` = `<SHEET_ID>`, `chatId` = `<CHAT_ID>`. Leave `parseWorkflowId` and `commandsWorkflowId` as they are; they are the ids the import kept. (Only if you imported through the n8n UI instead: copy the ids from the URLs of Parse Entry and Commands.)
   - **Nudge**: `sheetId` = `<SHEET_ID>`, `chatId` = `<CHAT_ID>`.
   - **Monthly summary**: `sheetId` = `<SHEET_ID>`, `chatId` = `<CHAT_ID>`.
   - **Recurring**: `sheetId` = `<SHEET_ID>`, `chatId` = `<CHAT_ID>`.
   Parse Entry and Commands have no Config node; they get the Sheet id from Process Inbox.
5. Publish (activate) **Parse Entry** and **Commands** first, then **Process Inbox**, **Nudge**, **Monthly summary** and **Recurring**. A sub-workflow runs its published version, so publish it again after every change.

After a change to `n8n/workflows/*.json` or `n8n/code/*.js`: `npm run build`, then repeat steps 5.3, 5.4 and 5.5. The import overwrites the Config nodes with the `YOUR_SHEET_ID` and `YOUR_CHAT_ID` placeholders, so skipping 5.4 makes Process Inbox fail every minute without any Telegram message. (Shortcut: import a copy of `n8n/dist` kept outside the repo with the two ids already filled, then publish with `npx n8n@2.45.5 publish:workflow --id=<id>` for `ExpParseEntry001`, `ExpCommands00001`, `ExpProcessInbox1`, `ExpNudge00000001`, `ExpMonthlySum001`, `ExpRecurring0001` while n8n is stopped.)

## 6. Keep n8n running (Windows)

1. Autostart at login (one line, in a Command Prompt opened with **Run as administrator**; not PowerShell, which breaks the nested quotes):
   `schtasks /Create /TN "n8n" /TR "cmd /c \"<repo path>\start-n8n.cmd\"" /SC ONLOGON /F`
   Use `start-n8n.cmd`, not a bare `npx n8n`. The script sets `NODE_USE_SYSTEM_CA=1`. An antivirus that scans HTTPS (Kaspersky does this to `api.openai.com`) re-signs the connection with its own certificate, and Node rejects it unless it reads the Windows certificate store. Without the variable every text and photo entry fails with `🔴 … SSL Issue`, while commands (`/balance`, `/undo`) still work, so the fault is easy to miss. Do not turn on the node's "Ignore SSL issues" option.
   If the task already exists with a bare `npx n8n` command, `setx NODE_USE_SYSTEM_CA 1` (no admin needed, applies to every Node process of this Windows user) has the same effect. Undo with `reg delete HKCU\Environment /v NODE_USE_SYSTEM_CA /f`.
2. Let the task run on battery and without a time limit (PowerShell opened with **Run as administrator**). By default Windows does not start the task on battery and stops n8n when the laptop is unplugged:
   `Set-ScheduledTask -TaskName n8n -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero))`
3. No sleep on AC power:
   `powercfg /change standby-timeout-ac 0`
   `powercfg /change hibernate-timeout-ac 0`

## 7. Security check (before real data)

1. From a second Telegram account, send `makan 10rb` to the bot. Within two minutes `Inbox` is unchanged and the bot stays silent.
2. **Deploy** > **Manage deployments**: no active web app deployment. (Archive any left from an earlier setup.)

Then check the exports: `npm test` fails if `n8n/dist` contains anything that looks like a key, a token, a Sheet id or a chat id.

## 8. Tests

- Unit and workflow tests (no network): `npm test`
- Fixtures against the real LLM without handling the key: `fixtures/n8n-runner.js` builds a workflow that runs them through the `OpenAI` credential in n8n. The four commands are in the header of that file; n8n must be stopped while `n8n execute` runs (messages sent meanwhile are processed after the restart).
- The same fixtures from a terminal: `node fixtures/run.js` with `OPENAI_API_KEY` and `LLM_MODEL` set (PowerShell: `$env:OPENAI_API_KEY="<key>"; $env:LLM_MODEL="<model id>"; node fixtures/run.js`). Rerun after any prompt change. If it fails with `self-signed certificate in certificate chain`, set `$env:NODE_USE_SYSTEM_CA="1"` first (same antivirus cause as in section 6).

## 9. First live run: what to watch

- `makan padang 25rb`: one Transactions row, `Inbox.status=done`, a `✅` reply. Then `/balance` shows BCA 25.000 lower, and `/undo` voids it. Check the voided row in the Sheet: only `status` changed to `void`; every other cell is still filled, and `id`, `txn_date`, `txn_time` are still text.
- A receipt photo: a `✅` or `⚠️` reply with the printed total.
- Stop n8n, send three messages, start n8n: one `📥 Processing 3 pending messages`, then three replies in order.
- A failing message (for example set `State.llm_model` to a wrong id): `Inbox.status=error`, a `🔴` reply, and the next message still goes through.
- In the n8n **Executions** list, no execution of Process Inbox ends with an error.
