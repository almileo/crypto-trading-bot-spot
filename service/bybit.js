const { SpotClient } = require('bybit-api');

const API_KEY = process.env.BYBIT_API_KEY;
const PRIVATE_KEY = process.env.BYBIT_API_SECRET;
const useLivenet = true;

const bybit = new SpotClient(
  API_KEY,
  PRIVATE_KEY,
  useLivenet
);

// bybit.getApiKeyInfo()
// .then(res => console.log('apiKey res: ', res))
// .catch(err => console.error("apiKey error: ", err));
// bybit.getOrderBook({ symbol: 'BTCUSD' })
// .then(result => {
//   console.log("getOrderBook inverse result: ", result);
// })
// .catch(err => {
//   console.error("getOrderBook inverse error: ", err);
// });

module.exports = bybit;