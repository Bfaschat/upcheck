require('dotenv').config();
var express = require('express');
var bodyParser = require('body-parser');
var app = express();
app.use(bodyParser.urlencoded({ extended: true }));

if (process.env.IS_IT_UP_TOKEN == undefined) {
    console.error("You have to set the environment variable IS_IT_UP_TOKEN with your telegram token.");
    process.exit(1);
}
app.use(express.static('public'));

// init sqlite db
var fs = require('fs');
var dbFile = './.data/sqlite.db';
var exists = fs.existsSync(dbFile);
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(dbFile);

// if ./.data/sqlite.db does not exist, create it, otherwise print records to console
db.serialize(function(){
  if (!exists) {
    db.run('CREATE TABLE Dreams (dream TEXT)');
    console.log('New table Dreams created!');
    
    // insert default dreams
    db.serialize(function() {
      db.run('INSERT INTO Dreams (dream) VALUES ("Find and count some sheep"), ("Climb a really tall mountain"), ("Wash the dishes")');
    });
  }
  else {
    console.log('Database "Dreams" ready to go!');
    db.each('SELECT * from Dreams', function(err, row) {
      if ( row ) {
        console.log('record:', row);
      }
    });
  }
});

// http://expressjs.com/en/starter/basic-routing.html
app.get('/', function(request, response) {
  response.sendFile(__dirname + '/views/index.html');
});

// endpoint to get all the dreams in the database
// currently this is the only endpoint, ie. adding dreams won't update the database
// read the sqlite3 module docs and try to add your own! https://www.npmjs.com/package/sqlite3
app.get('/getDreams', function(request, response) {
  db.all('SELECT * from Dreams', function(err, rows) {
    response.send(JSON.stringify(rows));
  });
});

let token = process.env.IS_IT_UP_TOKEN;
let trackFeature = process.env.IS_IT_UP_TRACK && process.env.IS_IT_UP_TRACK == 'true';

console.log("Running! \u{1F604}");

// listen for requests :)
var listener = app.listen(process.env.PORT, function() {
  console.log('Your app is listening on port ' + listener.address().port);
});
// External Modules
let TelegramBot = require('node-telegram-bot-api');
let telegram = new TelegramBot(token, {
    polling: true,
    onlyFirstMatch: true
});

// My Modules
let Regex = require('./util/Regex.js');
let Message = require('./util/Message.js');
let Verifier = require('./feature/Verifier.js');

// first message
telegram.onText(Regex.startOrHelpRegex, (msg, match) => {
    msgId = msg.chat.id;

    telegram.sendMessage(msgId, Message.welcomeFirstStep(msg.from.first_name));
    telegram.sendMessage(msgId, Message.welcomeSecondStep);
});

// verify urls
telegram.onText(Regex.urlRegex, (msg, match) => {
    Verifier.verifyUrl(msg, match, verifyCallback);
});
telegram.onText(Regex.verifyUrlRegex, (msg, match) => {
    match[0] = match[0].split(' ')[1];
    Verifier.verifyUrl(msg, match, verifyCallback);
});

function verifyCallback(msg, url, success, statusCode) {
    if (success) {
        //      status code of client or server error
        if (statusCode >= 400 && statusCode < 600) {
            telegram.sendMessage(
                msg.chat.id,
                Message.clientOrServerErrorStatus(url, statusCode)
            );
        } else {
            //      seems successful
            telegram.sendMessage(msg.chat.id, Message.successStatus(url));
        }
    } else {
        //      seems down
        telegram.sendMessage(msg.chat.id, Message.errorStatus(url));
    }
}

// wrong usage
telegram.onText(Regex.justVerifyRegex, (msg) => {
    telegram.sendMessage(msg.chat.id, Message.verifyHowToUse);
});

telegram.onText(Regex.justTrackRegex, (msg) => {
    telegram.sendMessage(msg.chat.id, Message.trackHowToUse);
});

// not found
telegram.on('message', msg => {
    let textMessage = msg.text;
    let chatId = msg.chat.id;

    // verify if match with any regex from user
    if (textMessage == undefined || Regex.isRegexMatch(textMessage)) return;


    // Verify if its a group call
    if (Regex.usernameCallRegex.exec(textMessage) &&
        (match = Regex.usernameCallLinkRegex.exec(textMessage))
    ) {
        match[0] = match[0].split(' ')[1];
        Verifier.verifyUrl(msg, match, verifyCallback);
    } else if (Regex.usernameCallRegex.exec(textMessage) || msg.chat.type != 'group') {
        // Group call without link or not a group call
        console.log("error: " + textMessage);
        telegram.sendMessage(chatId, Message.didntUnderstand);
    }
});


// track feature
if (trackFeature) {
    console.log("with track feature");
    var track = new(require('./feature/Track'))();

    //  receive a track request
    telegram.onText(Regex.trackUrlRegex, (msg, match) => {
        match[0] = match[0].split(' ')[1];
        Verifier.verifyUrl(msg, match, (msg, url, success, statusCode) => {
            verifyCallback(msg, url, success, statusCode);
            track.addUrl(url, msg.chat.id, success);

            console.log(`${url} added to track list`);
            telegram.sendMessage(msg.chat.id, Message.addedToTrackList(url));
            telegram.sendMessage(msg.chat.id, Message.trackListHowToUse);
        });
    });

    //receive a track list request
    telegram.onText(Regex.trackListRegex, (msg, match) => {
        track.getAllFromUser(msg.chat.id, (msgId, urls) => {
            telegram.sendMessage(msgId, Message.getListMessage(urls));
        });
    });

    // delete an url
    telegram.onText(Regex.deleteTrackRegex, function(msg, match) {
        track.getAllUrlsKeyBoard(msg.chat.id, keyboard => {
            if (keyboard != null) {
                telegram.sendMessage(msg.from.id, 'Choose an url to delete', keyboard);
            } else {
                telegram.sendMessage(msg.from.id, Message.urlNotFound);
            }
        })
    });

    // callback from custom keyboard(just when it is a delete action)
    telegram.on("callback_query", function(callbackQuery) {
        track.deleteUrl(callbackQuery.from.id, callbackQuery.data,
            (success, msgId) => {
                if (success) {
                    telegram.sendMessage(msgId, Message.deleteSuccess);
                } else {
                    telegram.sendMessage(msdId, Message.deleteError);
                }
            });
    });

    //  setup verification
    track.scheduleVerification((url, msgId, status) => {
        if (status) {
            telegram.sendMessage(msgId, Message.successStatus(url) + Message.checkedAt);
        } else {
            telegram.sendMessage(msgId, Message.errorStatus(url) + Message.checkedAt);
        }
    });
}
