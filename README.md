# 🗑️ TrashReminderJS

A lightweight **Node.js + Express web app** that tracks and displays upcoming waste collection dates (Papír, Plasty, Bio, Komunální).  
Includes automatic updates, email alerts, and a simple frontend dashboard.

---

## ✨ Features
- 📅 Calculates next collection dates for:
  - **Papír** (every 28 days from 15.10.2025)
  - **Plasty, drobné kovy, nápojové kartony** (every 21 days from 06.10.2025)
  - **Bioodpad** (weekly in season, every 3 weeks off-season, on Fridays)
  - **Komunální odpad** (weekly → bi-weekly after 29.09.2025, Mondays)
  - (Can be tailored for individual intervals)
- 💾 Persistent cache in `cache.json`
- 📧 Optional **email alerts** (Seznam.cz SMTP or host of your choice)
- 🕰️ Automatic daily updates at **06:30** (or at your desired time)
- 🌗 Frontend with **day/night theme** and sorted collection bubbles
- 🇨🇿 Czech localization

---

## 🚀 Getting Started

### 0. Node.js and npm
Please refer to official npm guide: [Downloading and installing Node.js and npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)

Project made @ node & npm version:
```bash
node -v
v22.19.0
npm -v
10.9.3
```

### 1. Clone repository
```bash
git clone https://github.com/SpaceWalkerCZ/TrashReminderJS_public.git
cd TrashReminderJS_public
```
Adjust start dates or frequencies in the functions if needed.
Runs fine on small VPS or home server (Raspberry Pi, NAS, etc.).

### 2. Install dependencies
```bash
npm install
npm fund
```

### 3. Configure email (optional)
Edit the transporter in `index.js`
```js
//email alert setup
const transporter = nodemailer.createTransport({
    host: "smtp.seznam.cz",
    port: 465,
    secure: true,
    auth: {
        user: "", //<- add your mail
        pass: "", //<- add your password
    },
    tls: {
        rejectUnauthorized: false
    }
});
```
(Adjust host, port, secure and tls parameters if choosing other host/service)

Add recipient(s) in `index.js`
```js
//email alert
async function sendEmailAlertForToday(alerts) {
    const message = {
        from: '"Svoz odpadů" <example@seznam.cz>', //<- edit your (sender) mail
        to: [], //<- add a recipient like "example@example.com" or recipients like ["example@example.com", "example2@example.com"]
        subject: "Dnes je svoz odpadu",
        html: `<p>Dnes se sváží následující druhy odpadu:</p>
               <ul>
                 ${alerts.map(a => `<li>${a}</li>`).join('')}
               </ul>`,
    };
    await transporter.sendMail(message);
}
```

Uncomment line in `index.js`
```js
//data update
async function updateDataAndNotify() {
    //irrelevant code not included

    if (alerts.length > 0) {
        console.log("ALERT: Today is collection day for:", alerts.join(", "));
        // await sendEmailAlertForToday(alerts); //<- uncomment to send mails
    } else {
        console.log("No collection today.");
    }
}
```

### 4. Configure cron-job (optional)
Edit schedule in `index.js`
```js
//cron job
//every day at 6:30 server time
cron.schedule('30 6 * * *', () => { //<- edit interval here
    console.log("Running scheduled update at 06:30");
    updateDataAndNotify().catch(console.error);
});
```

### 5. Run server
```bash
node index.js
```

---

## 📂 API Endpoints
- GET / -> Web dashboard
- GET /data -> Raw JSON cache

## 🔔 Email Alerts
- Triggered when today is collection day
- Sent automatically at 06:30 server time (configurable)
- To enable: uncomment the `sendEmailAlertForToday(alerts)` line

## 🖥️ Frontend
- Cards for each waste type (colored background)
- Today’s collections are highlighted red/bold
- Cards are auto-sorted by nearest collection date
- Day/night mode based on local time
<img width="355" height="454" alt="image" src="https://github.com/user-attachments/assets/095d6777-3071-4d3e-835b-2fbaa1b71325" />
<img width="361" height="451" alt="image" src="https://github.com/user-attachments/assets/e970db4c-b35d-4835-9272-019857a6318a" />

## ⚙️ Tech Stack
- [Express](https://expressjs.com/)
- [Node-cron](https://github.com/node-cron/node-cron)
- [Nodemailer](https://nodemailer.com/)
- [fs/promises](https://nodejs.org/api/fs.html#fspromises)

---

## 🔄 Run Automatically (systemd)
To keep the app running after reboot, set up a systemd service:
### 1. Create service file:
```bash
sudo nano /etc/systemd/system/trash.service
```
### 2. Add:
```shell
[Unit]
Description=TrashReminderJS APP
After=network.target

[Service]
ExecStart=/usr/bin/node /path/to/index.js
WorkingDirectory=/path/to/project
Restart=always
User=youruser
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```
### 3. Reload systemd and enable:
```bash
sudo systemctl daemon-reload
sudo systemctl enable trash
sudo systemctl start trash
```
### 4. Check logs
```bash
journalctl -u trash -f
```
Now the app starts automatically on boot.
