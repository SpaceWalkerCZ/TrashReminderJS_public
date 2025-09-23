# 🗑️ TrashReminderJS

A lightweight **Node.js + Express web app** that tracks and displays upcoming waste collection dates (Papír, Plasty, Bio, Komunální).  
Includes automatic updates, email alerts, and a simple frontend dashboard.

---

## ✨ Features
- 📅 Calculates next collection dates for:
  - **Papír** (every 28 days from 15.10.2025)
  - **Plasty, drobné kovy, nápojové kartony** (every 21 days from 06.10.2025)
  - **Bioodpad** (weekly in season, every 4 weeks off-season, on Fridays)
  - **Komunální odpad** (weekly → bi-weekly after 06.10.2025, Mondays)
- 💾 Persistent cache in `cache.json`
- 📧 Optional **email alerts** (Seznam.cz SMTP)
- 🕰️ Automatic daily updates at **06:30** (cron job)
- 🌗 Frontend with **day/night theme** and sorted collection bubbles

---

## 🚀 Getting Started

### 1. Clone repository
```bash
git clone https://github.com/SpaceWalkerCZ/TrashReminderJS.git
cd TrashReminderJS
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
auth: {
  user: "yourmail@seznam.cz",
  pass: "yourpassword"
}
```
(Adjust host, port, secure and tls parameters if choosing other host)

### 4. Run server
```bash
node index.js
```

---

## 📂 API Endpoints
- GET / -> Web dashboard
- GET /data -> Raw JSON cache


## 🔔 Email Alerts
- Triggered when today is collection day
- Sent automatically at 06:30 server time
- To enable: uncomment the `sendEmailAlertForToday(alerts)` line

## 🖥️ Frontend
- Cards for each waste type (colored background)
- Today’s collections are highlighted red/bold
- Cards are auto-sorted by nearest collection date
- Day/night mode based on local time

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
