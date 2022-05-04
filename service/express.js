const express = require('express');
const app = express();

const webook = app.get('/', function (req, res) {
  res.send('Hello World')
})

const listen = app.listen(process.env.PORT)

module.exports = {
    webook,
    listen
}

