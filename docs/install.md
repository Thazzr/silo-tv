# Install silo-tv on your LG TV

silo-tv is not in the LG Content Store yet. Until it is, you install it yourself, from a file, with your TV in LG's **Developer Mode**. This guide does it with a free desktop program and needs no command line.

**You need:**

- an LG TV from 2021 or later (webOS 6 or newer);
- a Silo server you can sign in to;
- a computer with Windows 10 or newer, macOS or Linux, on the same network as the TV;
- an LG developer account: sign up at [webostv.developer.lge.com](https://webostv.developer.lge.com).

It takes about 15 minutes the first time.

## 1. Turn on Developer Mode on the TV

1. On the TV, open the LG Content Store, search for **Developer Mode**, and install that app.
2. Open it and sign in with your LG developer account.
3. Switch **Dev Mode Status** on. The TV restarts.
4. Open the Developer Mode app again and switch **Key Server** on. Leave the app open: it shows a six-character **passphrase** at the bottom left. Case matters.
5. Look up the TV's **IP address**. It is in the TV's network settings, in the details of the connection, for example `192.168.1.50`.

LG's own description of these steps: [Developer Mode app](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app).

## 2. Install webOS Dev Manager on your computer

[webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) is a free, open-source program from the webOS Homebrew community. It installs apps on a TV in Developer Mode. It is not made or supported by LG.

1. Open its [latest release](https://github.com/webosbrew/dev-manager-desktop/releases/latest).
2. Download the file for your system:
   - Windows: the `.msi`;
   - macOS: the `.dmg`;
   - Linux: the `.AppImage`, `.deb` or `.rpm`.
3. Install it and start it. On a Mac, allow it to access the local network when asked.

## 3. Connect the TV

1. In Dev Manager, add a device.
2. Enter the TV's IP address and the passphrase from step 1, and keep the other fields as they are.
3. Dev Manager connects to the TV. If it does not, see [When something does not work](#when-something-does-not-work).

You do this only once. Key Server is needed only while adding the TV; you can switch it off afterwards.

## 4. Install silo-tv

1. Open the [latest silo-tv release](https://github.com/Thazzr/silo-tv/releases/latest).
2. Download the file ending in `.ipk`, e.g. `io.github.thazzr.silotv_0.3.0_all.ipk`.
3. In Dev Manager, choose to install an app and select the downloaded `.ipk`.
4. silo-tv appears among the TV's apps. Start it, enter your Silo server's address, and sign in: with the code the TV shows, confirmed on your phone, or with your password.

To check the download, compare the file with the `.sha256` file next to it on the release page. This step is optional.

## 5. Keep Developer Mode running

A Developer Mode session lasts **1000 hours**, a bit more than 41 days. The Developer Mode app shows the time left as "Remain Session".

**When it runs out, the TV turns Developer Mode off and removes silo-tv**, and with it your sign-in on this TV. To prevent that:

- open the Developer Mode app now and then and press **EXTEND** while the TV is online; or
- use **Renew session** in Dev Manager.

A session that has already run out cannot be extended. Then you turn Developer Mode on again and install silo-tv again.

Good to know:

- Developer Mode also switches off after the TV has started ten times without a network connection.
- One LG developer account can have Developer Mode on one TV at a time.

## Updating to a new version

Download the new `.ipk` from the [releases](https://github.com/Thazzr/silo-tv/releases) and install it the same way. It replaces the installed version. On our test TVs the sign-in survived updates.

## When something does not work

- **Dev Manager cannot connect:**
  - check that the TV and the computer are on the same network;
  - check that Key Server is on in the Developer Mode app, and the passphrase is typed exactly;
  - the TV's IP address may have changed: look it up again. A fixed IP address for the TV in your router avoids this.
- **The TV does not answer although Key Server is on:** open the Developer Mode app and accept LG's terms if it asks.
- **silo-tv disappeared:** the Developer Mode session ran out. See step 5.
- **A problem in silo-tv itself:** please [report it](https://github.com/Thazzr/silo-tv/issues/new/choose) with your TV model and webOS version.

## Other ways

- **Command line:** with LG's webOS CLI (`ares-install`), see [`development.md`](development.md#install-it-on-a-tv). It is the way for developers.
- **Homebrew Channel:** an app store of the webOS Homebrew community. It is not needed for silo-tv, and Developer Mode's time limit applies to it as well.
