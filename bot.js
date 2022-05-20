require('dotenv').config();
const Storage = require('node-storage');
const { colors, log, logColor } = require('./utils/logger');
const { dateFormat } = require('./utils/dateFormatter');
const bybit = require('./service/bybit');
const binance = require('./service/binance');
const telegramBot = require('./service/telegram');
const express = require('express');
const bodyParser = require('body-parser');
const app = express();

//Implementing webhook with ngrok

app.use(bodyParser.json());

app.post('/webhook', (req, res) => {
    console.log('/webhook req.body.signal: ', req.body.signal) 
    let signal = req.body.signal;
    res.send('Hello World webhook working')
    res.status(200).end() 
});

const start = app.get('/', (req, res) => {
  res.send('The bot is working, lets do its job...')
});

const listen = app.listen(process.env.PORT, () => {
  console.log(`The server is running OK on port: ${process.env.PORT}`);
});

const PAIR_1 = process.argv[2];
const PAIR_2 = process.argv[3];
const PAIR = PAIR_1 + PAIR_2;
const BUY_ORDER_AMOUT = process.argv[4]; //think 'n try with fix value fiat or portfolio percentaje
const sellEmoji = '\uD83D\uDCC9';
const buyEmoji = '\uD83D\uDCC8';
const exclamationEmoji = '\u203C';

const store = new Storage(`./data/${PAIR}.json`);

const sleep = (timeMS) => new Promise(resolve => setTimeout(resolve, timeMS));

async function _balances() {
    // return await binance.balance();
    return await bybit.getBalances();
}

function newPriceReset(_pair, balance, price) {
    const pair = _pair == 1 ? PAIR_1 : PAIR_2;
    if(!(parseFloat(store.get(`${pair.toLocaleLowerCase()}_balance`)) > balance)){
        store.put('start_price', price);
    }
}

async function _updateBalances() {
    const balances = await _balances();
    const pair1 = balances.result.balances.find((b) => b.coin === PAIR_1);
    const pair2 = balances.result.balances.find((b) => b.coin === PAIR_2);
    store.put(`${PAIR_1.toLocaleLowerCase()}_balance`, parseFloat(pair1.free));
    store.put(`${PAIR_2.toLocaleLowerCase()}_balance`, parseFloat(pair2.free));
    // store.put(`${PAIR_1.toLocaleLowerCase()}_balance`, parseFloat(balances[PAIR_1].available));
    // store.put(`${PAIR_2.toLocaleLowerCase()}_balance`, parseFloat(balances[PAIR_2].available));
    // store.put(`bnb_balance`, parseFloat(balances['BNB'].available));
}

async function _calculateProfits() {
    const orders = store.get('orders');
    const sold = orders.filter(order => {
        return order.status === 'sold';
    })

    const totalSoldProfits = sold.length > 0 ? sold.map(order => order.profit).reduce((prev, next) => parseFloat(prev) + parseFloat(next)) : 0;

    store.put('profits', totalSoldProfits + parseFloat(store.get('profits')));
}

function _logProfits(price) {
    const profits = parseFloat(store.get('profits'));
    let isGainerProfit = profits > 0 ? 1 : profits < 0 ? 2 : 0

    logColor(isGainerProfit == 1 ? colors.green : isGainerProfit == 2 ? colors.red : colors.gray, 
        `   Global Profits: ${parseFloat(store.get('profits')).toFixed(4)} ${PAIR_2}`);
    
    const pair1Balance = parseFloat(store.get(`${PAIR_1.toLocaleLowerCase()}_balance`));
    const pair2Balance = parseFloat(store.get(`${PAIR_2.toLocaleLowerCase()}_balance`));
    // const bnbBalance = parseFloat(store.get('bnb_balance'));
    const orders = store.get('orders');

    const initialBalance = parseFloat(store.get(`initial_${PAIR_2.toLocaleLowerCase()}_balance`));
    logColor(colors.gray, 
        `   Balances: ${pair1Balance} ${PAIR_1} | ${pair2Balance.toFixed(2)} ${PAIR_2}, Current: ${parseFloat(pair1Balance * price + pair2Balance).toFixed(3)} ${PAIR_2}, Initial: ${initialBalance.toFixed(2)} ${PAIR_2}`);
    logColor(colors.gray,
        `   Pending Orders: ${orders.length}`);
}

async function _buy(price, amount) {
    if (parseFloat(store.get(`${PAIR_2.toLocaleLowerCase()}_balance`)) >= BUY_ORDER_AMOUT * price) {
        let orders = store.get('orders');
        let factor = process.env.PRICE_PERCENT * price / 100;

        const order = {
            buy_price: price,
            amount,
            sell_price: price + factor,
            sold_price: 0,
            status: 'pending',
            profit: 0
        }

        log(`
            Buying ${PAIR_1}
            =================
            amountIn: ${parseFloat(BUY_ORDER_AMOUT * price).toFixed(2)} ${PAIR_2}
            amountOut: ${BUY_ORDER_AMOUT} ${PAIR_1}
        `)

        // const res = await binance.marketBuy(PAIR, order.amount);
        const res = await bybit.submitOrder({side: 'Buy', symbol: PAIR, type: 'MARKET', qty: order.amount});
        console.log('res _buy: ', res);
        if(res && res.result.status === 'NEW') {
            order.status = 'bought';
            order.id = res.orderId;
            order.buy_price = parseFloat(res.fills[0].price);

            orders.push(order);
            store.put('start_price', order.buy_price);
            await _updateBalances();

            logColor(colors.green, '======================================================\n');
            logColor(colors.green, `Bought: ${BUY_ORDER_AMOUT} ${PAIR_1} for ${parseFloat(BUY_ORDER_AMOUT * price).toFixed(2)} ${PAIR_2}, Price: ${order.buy_price}\n`);
            logColor(colors.green, '======================================================');

            await _calculateProfits();

            telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, `${buyEmoji} Hey! I am buying ${BUY_ORDER_AMOUT} ${PAIR_1} for ${parseFloat(BUY_ORDER_AMOUT * price).toFixed(2)} ${PAIR_2}, Price: ${order.buy_price}`)
        } else newPriceReset(2, BUY_ORDER_AMOUT * price, price);
    } else newPriceReset(2, BUY_ORDER_AMOUT * price, price);
    
}

async function _sell(price) {
    const orders = store.get('orders');
    const toSold = [];
    
    for(let i = 0; i < orders.length; i++) {
        let order = orders[i];
        if(price >= order.sell_price) {
            order.sold_price = price;
            order.status = 'selling';
            toSold.push(order);
        }
    }
    
    if (toSold.length > 0) {
        const totalAmount = parseFloat(toSold.map(order => order.amount).reduce((prev, next) => parseFloat(prev) + parseFloat(next)));
        if (totalAmount > 0 && parseFloat(store.get(`${PAIR_1.toLocaleLowerCase()}_balance`)) >= totalAmount) {
            log(`
                Selling ${PAIR_1}
                ===========================
                amountIn: ${totalAmount.toFixed(2)} ${PAIR_1}
                amountOut: ${parseFloat(totalAmount * price).toFixed(2)} ${PAIR_2}
            `)
            
            // const res = await binance.marketSell(PAIR, totalAmount);
            const res = bybit.submitOrder({side: 'Sell', symbol: PAIR, type: 'MARKET', qty: totalAmount});
            if (res && res.result.status === 'NEW') {
                const _price = parseFloat(res.fills[0].price);

                for(let i = 0; i < orders.length; i++) {
                    let order = orders[i]
                    for (let j = 0; j < toSold.length; j++) {
                        if (order.id == toSold[j].id) {
                            toSold[j].profit = (parseFloat(toSold[j].amount) * _price) - (parseFloat(toSold[j].amount) * parseFloat(toSold[j].buy_price));
                            toSold[j].status = 'sold';
                            orders[i] = toSold[j];
                        }
                    }
                }

                store.put('start_price', _price);
                await _updateBalances();

                logColor(colors.red, '=====================================================================\n');
                logColor(colors.red, `Sold: ${totalAmount} ${PAIR_1} for ${parseFloat(totalAmount * _price).toFixed(2)} ${PAIR_2}, Price ${_price}\n`);
                logColor(colors.red, '=====================================================================');

                await _calculateProfits();

                let i = orders.length;
                while(i--) {    
                    if(orders[i].status === 'sold') {
                        orders.splice(i, 1);
                    }
                }

                telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, `${sellEmoji} Hey! I am selling ${totalAmount} ${PAIR_1} for ${parseFloat(totalAmount * _price).toFixed(2)} ${PAIR_2}, Price: ${_price}`)

            } else store.put('start_price', price);
        } else store.put('start_price', price);
    } else store.put('start_price', price);

}

async function listenPrice() {
    while (true) {
        try {
            // let binancePrice = parseFloat((await binance.prices(PAIR))[PAIR]);
            const lastTradePrice = await bybit.getLastTradedPrice(PAIR);
            const bybitPrice = parseFloat(lastTradePrice.result.price);
            // let bnbPrice = parseFloat((await binance.prices('BNBUSDT'))['BNBUSDT']);

            let runningTime = dateFormat(process.uptime());

            if (bybitPrice) {
                const startPrice = store.get('start_price');
                const marketPrice = bybitPrice;

                console.clear();
                log('========================================================================================');
                logColor(colors.yellow, `   ${new Date()} | The bot has been running for ${runningTime}`);
                log('========================================================================================');
                _logProfits(marketPrice);
                log('========================================================================================');

                log(`   Prev Price: ${startPrice}`);
                log(`   New Price: ${marketPrice}`);

                if (marketPrice > startPrice) {
                    let factor = (marketPrice - startPrice);
                    let percent = 100 * factor / marketPrice;

                    logColor(colors.green, `   Up: +${parseFloat(percent).toFixed(3)}% ==> +$${parseFloat(factor).toFixed(4)}`);
                    store.put('percent', `+${parseFloat(percent).toFixed(3)}`)

                    if (percent >= process.env.PRICE_PERCENT) {
                        await _sell(marketPrice);
                    }

                } else if (marketPrice < startPrice) {
                    let factor = (startPrice - marketPrice);
                    let percent = 100 * factor / startPrice;

                    logColor(colors.red, `   Down: -${parseFloat(percent).toFixed(3)}% ==> -$${parseFloat(factor).toFixed(4)}`);
                    store.put('percent', `-${parseFloat(percent).toFixed(3)}`)

                    if (percent >= process.env.PRICE_PERCENT) {
                        await _buy(marketPrice, BUY_ORDER_AMOUT);
                    }
                } else {
                    logColor(colors.gray, '   Change: 0.000% ==> $0.0000');
                    store.put('percent', '0.000');
                }
            }
        } catch (error) {
            console.log('error: ', error);
            telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, `${exclamationEmoji} Hey! Something went wrong with the bot`);
        }
        await sleep(process.env.SLEEP_TIME);
    }
}

async function init() {
    if (process.argv[5] !== 'resume') {
        // const price = await binance.prices(PAIR);
        const lastTradePrice = await bybit.getLastTradedPrice(PAIR);
        const price = lastTradePrice.result.price;
        store.put('start_price', parseFloat(price));
        store.put('orders', []);
        store.put('profits', 0);
        const balances = await _balances();
        const pair1 = balances.result.balances.find((b) => b.coin === PAIR_1);
        const pair2 = balances.result.balances.find((b) => b.coin === PAIR_2);
        store.put(`${PAIR_1.toLocaleLowerCase()}_balance`, parseFloat(pair1.free));
        store.put(`${PAIR_2.toLocaleLowerCase()}_balance`, parseFloat(pair2.free));
        // store.put(`${PAIR_1.toLocaleLowerCase()}_balance`, parseFloat(balances[PAIR_1].available));
        // store.put(`${PAIR_2.toLocaleLowerCase()}_balance`, parseFloat(balances[PAIR_2].available));
        // store.put(`bnb_balance`, parseFloat(balances['BNB'].available));
        store.put(`initial_${PAIR_1.toLocaleLowerCase()}_balance`, store.get(`${PAIR_1.toLocaleLowerCase()}_balance`));
        store.put(`initial_${PAIR_2.toLocaleLowerCase()}_balance`, store.get(`${PAIR_2.toLocaleLowerCase()}_balance`));
        // store.put(`initial_bnb_balance`, store.get(`bnb_balance`));
    } 

    listenPrice();
}

init();




// async function testBybit() {
//     console.log('PAIR: ', PAIR);
//     const balanceBybit = await _balances();
//     const usdt = balanceBybit.result.balances.find((b) => b.coin === PAIR_2)
//     const lastTradePrice = await bybit.getLastTradedPrice(PAIR);
//     const price = lastTradePrice.result.price;
//     const balanceBinance = await binance.balance();
//     const res = await bybit.submitOrder({symbol: PAIR, qty: BUY_ORDER_AMOUT, side: 'Buy',  type: 'MARKET'});
//     console.log('res: ', res);

// }
// testBybit();