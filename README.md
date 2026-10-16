# Applier Keep Going

A small Chrome extension that watches the configured Applier Dot conversation for text such as:

```text
Active 14m ago
Active 20 minutes ago
Active 2h ago
```

When that time exceeds your inactivity setting, it sends a continuation message. A cooldown prevents repeated messages too quickly.

There is no server, build process, database, Google Sheets integration, or credential manager.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `browser-extension` folder in this project.
5. Open your Applier Dot conversation in ChatGPT.
6. Open the extension and click **Use current tab**.
7. Enable monitoring, adjust the times/message if wanted, and click **Save**.
8. You can switch to any other tab. If the Applier tab is closed, the extension opens it again in the background.

The defaults are:

- Consider Applier inactive after 12 minutes.
- Send at most once every 15 minutes.
- Send: `Continue the existing job application pipeline from where you stopped. Do not restart completed applications or create duplicates.`

The popup shows the detected `Active … ago` text, the last check, and when a message was last sent. Checks run from the extension background worker, so the Applier tab does not need to be selected. If ChatGPT freezes the visible activity label in an inactive tab, the extension keeps counting from the last observed activity time.

## Limitations

- Chrome must remain open.
- This relies on the visible ChatGPT page. If ChatGPT changes its HTML, the popup reports that the activity text or message controls could not be found instead of clicking blindly.
- It only watches the exact conversation selected with **Use current tab**.
