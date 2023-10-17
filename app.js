// Copyright (C) 2023  Grisshink
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

const express = require('express');
const session = require('express-session')
const fs = require('fs');
const notifier = require('node-notifier');

const MemoryStore = require('memorystore')(session)

const app = express();

const config = JSON.parse(fs.readFileSync('config.json').toString());
const ONE_WEEK = 604800000
const commonState = {
    color: config.color,
};

require('dotenv').config();

let mail = readFileOrDefault('mail.json', []);
let contacts = readFileOrDefault('contacts.json', []);

function readFileOrDefault(filename = '', defaultValue) {
    let data = defaultValue;

    try {
        data = JSON.parse(fs.readFileSync(filename).toString());
    } catch (e) {
        fs.writeFileSync(filename, JSON.stringify(data));
    }

    return data;
}

function isLoggedIn(req) {
    return req.session.user == config.creds.name && req.session.success;
}

function checkLogin(req, res, next) {
    if (!isLoggedIn(req)) {
        res.setHeader('Refresh', '0; /login').sendStatus(401);
        return;
    }
    next();
}

function addMail(data) {
    mail.push(data);
    fs.writeFileSync('mail.json', JSON.stringify(mail));

    if (config.enableNotifications) {
        notifier.notify({
            title: `${data.name} написал`,
            message: data.message,
            sound: true
        });
    }

    console.log(`${data.name} написал вам:`);
    console.log(data.message.slice(0, 150));
}

app.set('view engine', 'ejs');
app.use(express.static('static'),
        express.urlencoded({ extended: true }),
        session({
            cookie: { maxAge: ONE_WEEK },
            store: new MemoryStore({
                checkPeriod: ONE_WEEK
            }),
            resave: false,
            saveUninitialized: false,
            secret: process.env.STORE_SECRET_KEY,
        }));

app.post('/send', (req, res) => {
    const content = req.body;
    if (!content.username || !content.message) {
        res.setHeader('Refresh', '0; /?error=true').sendStatus(400);
        return;
    }

    try {
        addMail({
            name: content.username,
            message: content.message,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        res.setHeader('Refresh', '0; /?error=true').sendStatus(500);
        return;
    }

    res.redirect('/?created=true');
});

app.get('/', (req, res) => {
    const rootState = {
        created: req.query.created ? true : false,
        error: req.query.error ? true : false,
        mailbox: req.query.targetName || config.mailboxName,
        loggedIn: isLoggedIn(req),
        ...commonState
    };
    res.render('index', rootState);
});

app.get('/mail/:id', checkLogin, (req, res) => {
    let id = Number(req.params.id);
    let messageState = {
        msg: mail[id],
        loggedIn: true,
        ...commonState
    };

    if (Number.isNaN(id) || !mail[id]) {
        res.render('404', messageState);
        return;
    }

    res.render('message', messageState);
});

app.get('/mail', checkLogin, (req, res) => {
    const mailState = {
        mail: mail,
        loggedIn: true,
        ...commonState
    };
    res.render('mail', mailState);
});

app.get('/contacts', checkLogin, (req, res) => {
    const contactsState = {
        contacts: contacts,
        loggedIn: true,
        ...commonState
    };
    res.render('contacts', contactsState);
});

app.post('/contacts/delete', checkLogin, (req, res) => {
    const content = req.body;
    if (!content.number) {
        res.sendStatus(400);
        return;
    }

    contacts.splice(content.number, 1);
    fs.writeFileSync('contacts.json', JSON.stringify(contacts));

    res.redirect('/contacts');
});

app.route('/contacts/new')
.get(checkLogin, (req, res) => {
    const newContactState = {
        loggedIn: true,
        error: req.query.error || false,
        ...commonState
    };
    res.render('new-contact', newContactState);
})
.post(checkLogin, (req, res) => {
    const content = req.body;
    if (!content.username || !content.url) {
        res.setHeader('Refresh', '0; /contacts/new?error=true').sendStatus(400);
        return;
    }

    contacts.push({
        name: content.username,
        url: content.url
    });
    fs.writeFileSync('contacts.json', JSON.stringify(contacts));

    res.redirect('/contacts');
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login?logout=true');
    });
})

app.route('/login')
.get((req, res) => {
    const loginState = {
        unauthorised: req.query.unauthorised ? true : false,
        logout: req.query.logout ? true : false,
        defaultLogin: config.creds.defaultName ? config.creds.name : '',
        loggedIn: isLoggedIn(req),
        ...commonState
    };
    res.render('login', loginState);
})
.post((req, res) => {
    const content = req.body;
    if (!content.name || 
        !content.password || 
        content.name.trim() != config.creds.name.trim() || 
        content.password.trim() != config.creds.password.trim())
    {
        console.log('Got incorrect login');
        console.log(content);
        res.setHeader('Refresh', '0; /login?unauthorised=true').sendStatus(401);
        return;
    }

    req.session.regenerate(() => {
        req.session.user = content.name.trim();
        req.session.success = true;
        res.redirect('/mail');
    });
});

app.use((req, res) => {
    res.status(404).render('404', { loggedIn: isLoggedIn(req), ...commonState});
});

if (!process.env.STORE_SECRET_KEY) {
    console.log('Ошибка: Не задан ключ секретный ключ для аутентификации сессий! Создайте файл с названием .env в папке с сервером и запишите в него следующую строку:\n');
    console.log('STORE_SECRET_KEY=<ключ_сессий>\n');
    console.log('Ключ сессий может быть любым значением, как тот же пароль, только его не надо нигде вводить кроме этого места и нужно держать его в строжайшем секрете.');
    process.exit(1);
}

app.listen(config.port, () => {
    console.log(`Сайт запущен. Его можно посмотреть локально через эту ссылку -> http://127.0.0.1:${config.port}`);
    console.log(`Также письма можно посмотреть по этой ссылке -> http://127.0.0.1:${config.port}/mail`);
});