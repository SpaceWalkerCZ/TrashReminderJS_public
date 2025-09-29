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

// ---------- Utilities: use local-midnight "today" for comparisons ----------
function localMidnight(dt) {
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

// ---------- Papír (every 28 days) ----------
function getNextPapirDate(today) {
    const start = new Date(2025, 9, 15); // 15.10.2025
    const todayLocal = localMidnight(today);
    let next = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    while (next < todayLocal) next.setDate(next.getDate() + 28);
    return next;
}

// ---------- Plasty (every 21 days) ----------
function getNextPlastyDate(today) {
    const start = new Date(2025, 9, 6); // 06.10.2025
    const todayLocal = localMidnight(today);
    let next = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    while (next < todayLocal) next.setDate(next.getDate() + 21);
    return next;
}

// ---------- Bio (in-season weekly Friday, off-season every 21 days Friday) ----------
function getNextBioDate(today) {
    const year = today.getFullYear();
    const todayLocal = localMidnight(today);

    // Season boundaries (local midnight)
    const seasonStart = new Date(year, 2, 1);   // 01.03
    const seasonEnd = new Date(year, 10, 30);   // 30.11

    const offSeasonFrequency = 21; // days
    const collectionWeekday = 5;   // Friday (0 = Sunday)

    // --- In-season: next Friday (including today if Friday) ---
    if (todayLocal >= seasonStart && todayLocal <= seasonEnd) {
        const daysUntilNext = (collectionWeekday - todayLocal.getDay() + 7) % 7;
        // if daysUntilNext === 0 => today is Friday -> return today
        const nextDate = new Date(todayLocal);
        nextDate.setDate(nextDate.getDate() + daysUntilNext);
        return nextDate;
    }

    // --- Off-season: start from last in-season Friday (<= Nov 30) ---
    let nov30 = new Date(year, 10, 30);
    // if today is in Jan/Feb and we need previous year's Nov 30:
    if (today.getMonth() < 2) nov30 = new Date(year - 1, 10, 30);

    // roll nov30 back to the last Friday
    while (nov30.getDay() !== collectionWeekday) {
        nov30.setDate(nov30.getDate() - 1);
    }

    let nextDate = new Date(nov30.getFullYear(), nov30.getMonth(), nov30.getDate());
    while (nextDate < todayLocal) {
        nextDate.setDate(nextDate.getDate() + offSeasonFrequency);
    }
    return nextDate;
}

// ---------- Komunální (before switch weekly Monday; on/after switch every 14 days Monday) ----------
function getNextKomunalDate(today) {
    const switchDate = new Date(2025, 8, 29); // 29.09.2025
    const switchLocal = new Date(switchDate.getFullYear(), switchDate.getMonth(), switchDate.getDate());
    const weekday = 1;     // Monday
    const postSwitchFrequency = 14; // days

    const todayLocal = localMidnight(today);

    // Find next Monday (0..6 days ahead; 0 if today is Monday)
    const daysUntilMonday = (weekday - todayLocal.getDay() + 7) % 7;
    const nextMonday = new Date(todayLocal);
    nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);

    // If nextMonday is strictly before switch => weekly behaviour applies
    if (nextMonday < switchLocal) {
        return nextMonday;
    }

    // On/after switch: start cycles from the switch date (switchLocal),
    // advance in 14-day steps until >= todayLocal
    let cycle = new Date(switchLocal);
    while (cycle < todayLocal) {
        cycle.setDate(cycle.getDate() + postSwitchFrequency);
    }
    return cycle;
}

const transporter = nodemailer.createTransport({
    host: "smtp.seznam.cz",
    port: 465,
    secure: true,
    auth: {
        user: "",
        pass: "",
    },
    tls: { rejectUnauthorized: false }
});

async function sendEmailAlertForToday(alerts) {
    const message = {
        from: '"Svoz odpadů" <example@seznam.cz>',
        to: [],
        subject: "Dnes je svoz odpadu",
        html: `<p>Dnes se sváží následující druhy odpadu:</p>
               <ul>${alerts.map(a => `<li>${a}</li>`).join('')}</ul>`,
    };
    await transporter.sendMail(message);
}

const wasteNames = {
    papir: "Papír",
    plasty: "Plasty, drobné kovy, nápojové kartony",
    bio: "Bioodpad",
    komunal: "Komunální odpad"
};

async function updateDataAndNotify() {
    const cache = await loadCache();
    const now = new Date();
    const todayStr = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;

    const types = [
        { key: "papir", getNext: getNextPapirDate },
        { key: "plasty", getNext: getNextPlastyDate },
        { key: "bio", getNext: getNextBioDate },
        { key: "komunal", getNext: getNextKomunalDate },
    ];

    const alerts = [];

    types.forEach(type => {
        const nextDate = type.getNext(now);
        const collectionDate = formatCzechDate(nextDate);

        // --- FIX: compute local ISO + timestamp ---
        const yyyy = nextDate.getFullYear();
        const mm = String(nextDate.getMonth() + 1).padStart(2, '0');
        const dd = String(nextDate.getDate()).padStart(2, '0');

        cache[type.key] = {
            lastUpdated: now.toISOString(),
            collectionDate,                          // "29.09.2025 (Po)"
            collectionISOLocal: `${yyyy}-${mm}-${dd}`, // "2025-09-29"
            collectionTS: nextDate.getTime()         // timestamp
        };

        if (collectionDate.startsWith(todayStr)) {
            alerts.push(`${wasteNames[type.key]}: ${collectionDate}`);
        }
    });

    await saveCache(cache);

    if (alerts.length > 0) {
        console.log("ALERT: Today is collection day for:", alerts.join(", "));
        // await sendEmailAlertForToday(alerts);
    } else {
        console.log("No collection today.");
    }
}

// cron
cron.schedule('30 6 * * *', () => {
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
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Svoz odpadu</title>
<style>
body { font-family: Arial; margin: 40px; background-color: #f5f5f5; }
.container { max-width: 500px; margin: 20px auto; padding: 20px; border-radius: 25px;
             box-shadow: 0 8px 16px rgba(0,0,0,0.2); text-align: center; }
.collectionDate { font-size: 1.5em; font-weight: bold; }
#plasty { background-color: #fff8b3; }
#papir { background-color: #b3d9ff; }
#komunal { background-color: #d9d9d9; }
#bio { background-color: #d9a6a6; }
#updated { background-color: white; text-align: center; font-style: italic; color: #333; }
</style>
</head>
<body>

<div class="container" id="plasty"><h2>Plasty</h2><p class="collectionDate"></p></div>
<div class="container" id="papir"><h2>Papír</h2><p class="collectionDate"></p></div>
<div class="container" id="komunal"><h2>Komunální odpad</h2><p class="collectionDate"></p></div>
<div class="container" id="bio"><h2>Bioodpad</h2><p class="collectionDate"></p></div>
<div class="container" id="updated"><p>Poslední aktualizace:</p><p class="updated">Načítám...</p></div>

<script>
function reorderBubbles() {
    const ids = ["plasty", "papir", "komunal", "bio"];
    const containers = ids.map(id => {
        const el = document.getElementById(id);
        const ts = el.getAttribute('data-iso-ts');
        return { el, date: ts ? new Date(Number(ts)) : null };
    });
    containers.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date - b.date;
    });
    const body = document.body;
    containers.forEach(c => body.appendChild(c.el));
}

async function loadData() {
    const res = await fetch('/data');
    const data = await res.json();

    function updateSection(id, info) {
        const el = document.getElementById(id);
        el.querySelector('.collectionDate').textContent = info.collectionDate || '-';
        if (info.collectionTS) {
            el.setAttribute('data-iso-ts', String(info.collectionTS));
            el.setAttribute('data-iso', info.collectionISOLocal || '');
        }
        // Highlight today
        const today = new Date();
        const dd = String(today.getDate()).padStart(2,"0");
        const mm = String(today.getMonth()+1).padStart(2,"0");
        const yyyy = today.getFullYear();
        const todayStr = \`\${dd}.\${mm}.\${yyyy}\`;
        if (info.collectionDate && info.collectionDate.startsWith(todayStr)) {
            el.querySelector('.collectionDate').style.color = 'darkred';
            el.querySelector('.collectionDate').style.textShadow = '0 0 8px #fff';
        } else {
            el.querySelector('.collectionDate').style.color = '';
            el.querySelector('.collectionDate').style.textShadow = '';
        }
    }

    if (data.plasty) updateSection('plasty', data.plasty);
    if (data.papir) updateSection('papir', data.papir);
    if (data.komunal) updateSection('komunal', data.komunal);
    if (data.bio) updateSection('bio', data.bio);

    const latest = Object.values(data).map(i => i.lastUpdated).sort().pop();
    if (latest) {
        document.querySelector('#updated .updated').textContent = new Date(latest).toLocaleString();
    }

    reorderBubbles();
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
