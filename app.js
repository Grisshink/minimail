const express = require('express');
const session = require('express-session')
const MemoryStore = require('memorystore')(session)
const fs = require('fs');
const notifier = require('node-notifier');

const app = express();

const config = JSON.parse(fs.readFileSync('config.json').toString());

require('dotenv').config();

let mail;
try {
    mail = JSON.parse(fs.readFileSync('mail.json').toString());
} catch (e) {
    mail = [];
    fs.writeFileSync('mail.json', JSON.stringify(mail));
}

app.set('view engine', 'ejs');
app.use(express.static('static'),
        express.urlencoded({ extended: true }),
        session({
            cookie: { maxAge: 604800000 },
            store: new MemoryStore({
                checkPeriod: 604800000
            }),
            resave: false,
            saveUninitialized: false,
            secret: process.env.STORE_SECRET_KEY,
        }));

app.post('/send', (req, res) => {
    const content = req.body;
    if (!content.username || !content.message) {
        res.status(400)
           .redirect('/?error=true');
        return;
    }

    mail.push({
        name: content.username,
        message: content.message,
        timestamp: new Date().toISOString(),
    });

    try {
        fs.writeFileSync('mail.json', JSON.stringify(mail));
        notifier.notify({
            title: `${content.username} написал`,
            message: content.message,
            sound: true
        });
    } catch (e) {
        res.status(500)
           .redirect('/?error=true');
        return;
    }

    res.redirect('/?created=true');
});

app.get('/', (req, res) => {
    const rootState = {
        created: req.query.created ? true : false,
        error: req.query.error ? true : false,
        color: config.color,
        mailbox: config.mailboxName,
    };
    res.render('index', rootState);
});

app.get('/mail/:id', (req, res) => {
    let id = Number(req.params.id);
    let messageState = {
        color: config.color,
        msg: mail[id],
    };

    if (Number.isNaN(id) || !mail[id]) {
        res.render('404', messageState);
        return;
    }

    res.render('message', messageState);
});

app.get('/mail', (req, res) => {
    if (req.session.user != config.creds.name || !req.session.success) {
        res.redirect('/login');
        return;
    }

    const mailState = {
        color: config.color,
        mail: mail,
    };
    res.render('mail', mailState);
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login?logout=true');
    });
})

app.route('/login')
.get((req, res) => {
    const loginState = {
        color: config.color,
        unauthorised: req.query.unauthorised ? true : false,
        logout: req.query.logout ? true : false,
        defaultLogin: config.creds.defaultName ? config.creds.name : '',
    };
    res.render('login', loginState);
})
.post((req, res) => {
    const content = req.body;
    console.log('Got login');
    console.log(content);
    if (!content.name || 
        !content.password || 
        content.name.trim() != config.creds.name.trim() || 
        content.password.trim() != config.creds.password.trim())
    {
        res.status(401)
           .redirect('/login?unauthorised=true');
        return;
    }

    req.session.regenerate(() => {
        req.session.user = content.name.trim();
        req.session.success = true;
        res.redirect('/mail');
    });
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