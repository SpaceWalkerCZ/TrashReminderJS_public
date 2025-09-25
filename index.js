const express = require('express');
const fs = require('fs').promises;
const cron = require('node-cron');
const nodemailer = require('nodemailer');

const PORT = 3000;
const CACHE_FILE = 'cache.json';

const app = express();

async function loadCache() {
    try {
        const data = await fs.readFile(CACHE_FILE, 'utf8');
        return JSON.parse(data);
    } catch {
        return {};
    }
}

async function saveCache(cache) {
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function formatCzechDate(date) {
    const days = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    const dayName = days[date.getDay()];
    return `${dd}.${mm}.${yyyy} (${dayName})`;
}

function getNextPapirDate(today) {
    const start = new Date(2025, 9, 15); //start 15.10.2025
    let next = new Date(start);
    while (next < today) next.setDate(next.getDate() + 28); //repeat 28 days
    return next;
}

function getNextPlastyDate(today) {
    const start = new Date(2025, 9, 6); //start 06.10.2025
    let next = new Date(start);
    while (next < today) next.setDate(next.getDate() + 21); //repeat 21 days
    return next;
}

function getNextBioDate(today) {
    const year = today.getFullYear();

    // Season boundaries
    const seasonStart = new Date(year, 2, 1);   // 01.03
    const seasonEnd = new Date(year, 10, 30); // 30.11

    // Frequencies
    const inSeasonFrequency = 7;   // weekly
    const offSeasonFrequency = 21; // every 3 weeks
    const collectionWeekday = 5;   // Friday (0 = Sunday)

    let nextDate = new Date(today);

    // --- In-season collections ---
    if (today >= seasonStart && today <= seasonEnd) {
        const daysUntilNext = (collectionWeekday - nextDate.getDay() + 7) % 7;
        nextDate.setDate(nextDate.getDate() + (daysUntilNext === 0 ? inSeasonFrequency : daysUntilNext));
        return nextDate;
    }

    // --- Off-season collections ---
    // Last in-season Friday
    const nov30 = new Date(today.getMonth() < 2 ? year - 1 : year, 10, 30);
    while (nov30.getDay() !== collectionWeekday) {
        nov30.setDate(nov30.getDate() - 1);
    }
    let lastSeasonCollection = nov30;

    // Step forward in 4-week intervals until > today
    nextDate = new Date(lastSeasonCollection);
    while (nextDate < today) {
        nextDate.setDate(nextDate.getDate() + offSeasonFrequency);
    }
    return nextDate;
}

function getNextKomunalDate(today) {
    const switchDate = new Date(2025, 8, 29); //start 2 week collection 29.09.2025
    const weekday = 1;     // Monday
    const preSwitchFrequency = 7;   // weekly
    const postSwitchFrequency = 14; // every 2 weeks

    let nextDate = new Date(today);

    // --- Find the next Monday ---
    const daysUntilMonday = (weekday - nextDate.getDay() + 7) % 7;
    if (daysUntilMonday > 0) {
        nextDate.setDate(nextDate.getDate() + daysUntilMonday);
    }

    // --- Before switch date → weekly ---
    if (nextDate < switchDate) {
        return nextDate;
    }

    // --- On/after switch date → every 2 weeks ---
    let cycleStart = new Date(switchDate);
    nextDate = new Date(cycleStart);

    while (nextDate < today) {
        nextDate.setDate(nextDate.getDate() + postSwitchFrequency);
    }

    return nextDate;
}

//email alert setup
const transporter = nodemailer.createTransport({
    host: "smtp.seznam.cz",
    port: 465,
    secure: true,
    auth: {
        user: "", //<--------------------------------------------------------- add your mail
        pass: "", //<--------------------------------------------------------- add your password
    },
    tls: {
        rejectUnauthorized: false
    }
});

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

const wasteNames = {
    papir: "Papír",
    plasty: "Plasty, drobné kovy, nápojové kartony",
    bio: "Bioodpad",
    komunal: "Komunální odpad"
};

//data update
async function updateDataAndNotify() {
    const cache = await loadCache();
    const now = new Date();
    const todayStr = `${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}.${now.getFullYear()}`;

    const types = [
        { key: "papir", getNext: getNextPapirDate, name: "Papír" },
        { key: "plasty", getNext: getNextPlastyDate, name: "Plasty" },
        { key: "bio", getNext: getNextBioDate, name: "Bioodpad" },
        { key: "komunal", getNext: getNextKomunalDate, name: "Komunální odpad" },
    ];

    const alerts = [];

    types.forEach(type => {
        const nextDate = type.getNext(now);
        const collectionDate = formatCzechDate(nextDate);

        cache[type.key] = {
            lastUpdated: now.toISOString(),
            collectionDate
        };

        //email alert if collection is today
        if (collectionDate.startsWith(todayStr)) {
            alerts.push(`${wasteNames[type.key]}: ${collectionDate}`);
        }
    });

    await saveCache(cache);

    if (alerts.length > 0) {
        console.log("ALERT: Today is collection day for:", alerts.join(", "));
        // await sendEmailAlertForToday(alerts); //<--------------------------------------------------------- uncomment to send mails
    } else {
        console.log("No collection today.");
    }
}

//cron job
//every day at 6:30 server time
cron.schedule('30 6 * * *', () => { //<--------------------------------------------------------- edit interval here
    console.log("Running scheduled update at 06:30");
    updateDataAndNotify().catch(console.error);
});

app.get('/data', async (req, res) => {
    const cache = await loadCache();
    res.json(cache);
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<head>
<meta charset="UTF-8">
<title>Svoz odpadu</title>

<style>
body {
    font-family: Arial;
    margin: 40px;
    background-color: #f5f5f5;
}
h1 { color: #2c3e50; text-align: center; }
.container {
    max-width: 500px;
    margin: 20px auto;
    padding: 20px;
    border-radius: 25px;
    box-shadow: 0 8px 16px rgba(0,0,0,0.2);
    transition: transform 0.2s, box-shadow 0.2s;
    text-align: center;
}
.container:hover {
    transform: translateY(-5px);
    box-shadow: 0 12px 24px rgba(0,0,0,0.3);
}
.label { font-weight: bold; }
.collectionDate { font-weight: bold !important; font-size: 1.5em; }

body.day { background-color: #f5f5f5; }
body.night { background-color: #1e1e2f; }

#plasty { background-color: #fff8b3; }
#papir { background-color: #b3d9ff; }
#komunal { background-color: #d9d9d9; }
#bio { background-color: #d9a6a6; }
#updated { background-color: white; text-align: center; font-style: italic; color: #333; }
</style>

</head>
<body>

<div class="container" id="plasty">
<h2>Plasty, drobné kovy, nápojové kartony</h2>
<p class="collectionDate"></p>
</div>

<div class="container" id="papir">
<h2>Papír</h2>
<p class="collectionDate"></p>
</div>

<div class="container" id="komunal">
<h2>Komunální odpad</h2>
<p class="collectionDate"></p>
</div>

<div class="container" id="bio">
<h2>Bioodpad</h2>
<p class="collectionDate"></p>
</div>

<div class="container" id="updated">
    <p>Poslední aktualizace:</p>
    <p class="updated">Načítám...</p>
</div>

<script>
function reorderBubbles() {
    const containerIds = ["plasty", "papir", "komunal", "bio"];
    const containers = containerIds.map(id => {
        const el = document.getElementById(id);
        const headingText = el.querySelector(".collectionDate").textContent.split(" ")[0]; 
        let date = null;
        if (headingText && headingText.includes(".")) {
            const [dd, mm, yyyy] = headingText.split(".");
            if (dd && mm && yyyy) {
                date = new Date(\`\${yyyy}-\${mm}-\${dd}\`);
            }
        }
        return { el, date };
    });
    containers.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date - b.date;
    });
    const body = document.body;
    containers.forEach(c => body.appendChild(c.el));
}

function setBackgroundByTime() {
    const hour = new Date().getHours();
    if (hour >= 18 || hour <= 6) {
        document.body.classList.add("night");
        document.body.classList.remove("day");
    } else {
        document.body.classList.add("day");
        document.body.classList.remove("night");
    }
}
setBackgroundByTime();

async function loadData() {
    try {
        const res = await fetch('/data');
        const data = await res.json();

        function updateSection(id, info) {
            const container = document.getElementById(id);
            container.querySelector('.collectionDate').textContent = info.collectionDate || '-';
            if (info.collectionDate) {
                const today = new Date();
                const dd = String(today.getDate()).padStart(2, "0");
                const mm = String(today.getMonth() + 1).padStart(2, "0");
                const yyyy = today.getFullYear();
                const todayStr = \`\${dd}.\${mm}.\${yyyy}\`;
                if (info.collectionDate.startsWith(todayStr)) {
                    container.querySelector('.collectionDate').style.fontWeight = 'bold';
                    container.querySelector('.collectionDate').style.color = 'darkred';
                    container.querySelector('.collectionDate').style.textShadow = 'rgb(255 255 255) 0px 0px 8px';
                } else {
                    container.querySelector('.collectionDate').style.fontWeight = 'normal';
                    container.querySelector('.collectionDate').style.color = '';
                    container.querySelector('.collectionDate').style.textShadow = '';
                }
            }
        }

        if (data.plasty) updateSection('plasty', data.plasty);
        if (data.papir) updateSection('papir', data.papir);
        if (data.komunal) updateSection('komunal', data.komunal);
        if (data.bio) updateSection('bio', data.bio);

        const latestUpdate = Object.values(data)
            .map(item => item.lastUpdated)
            .sort()
            .pop();
        if (latestUpdate) {
            document.querySelector('#updated .updated').textContent =
                 new Date(latestUpdate).toLocaleString();
        }

        reorderBubbles();

    } catch (err) {
        console.error(err);
        document.querySelectorAll('p.title, p.collectionDate')
            .forEach(el => el.textContent = 'Chyba při načítání dat');
        document.querySelector('#updated .updated').textContent = 'Chyba při načítání dat';
    }
}

loadData();
setInterval(loadData, 5 * 60 * 1000);
</script>
</body>
</html>
    `);
});

//start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    //cache update on server start -> sends mail (if uncommented)
    updateDataAndNotify().catch(console.error);
});
