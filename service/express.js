const express = require('express');
const bodyParser = require('body-parser');
const app = express();

app.use(bodyParser.json());

const webook = app.post('/webhook', (req, res) => {
  console.log('/webhook req.body.signal: ', req.body.signal) 
  let signal = req.body.signal;
  res.send('Hello World webhook working')
  res.status(200).end() 
});

const init = app.get('/', (req, res) => {
  res.send('The bot is working, lets do its job...')
})

const listen = app.listen(process.env.PORT, () => {
  console.log(`The server is running OK on port: ${process.env.PORT}`);
})


