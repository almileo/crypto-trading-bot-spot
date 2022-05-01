require('dotenv').config();
const Storage = require('node-storage');
const { colors, log, logColor } = require('./utils/logger');
const binance = require('./service/binance');
const telegramBot = require('./service/telegram');

const PAIR_1 = process.argv[2];
const PAIR_2 = process.argv[3];
const PAIR = PAIR_1 + PAIR_2;
const BUY_ORDER_AMOUT = process.argv[4]; //think 'n try with fix value and portfolio percentaje

const store = new Storage(`./data/${PAIR}.json`);

const sleep = (timeMS) => new Promise(resolve => setTimeout(resolve, timeMS));

async function _balances() {
    return await binance.balance();
}

function newPriceReset(_pair, balance, price) {
    const pair = _pair == 1 ? PAIR_1 : PAIR_2;
    if(!(parseFloat(store.get(`${pair.toLocaleLowerCase()}_balance`)) > balance)){
        store.put('start_price', price);
    }
}

async function _updateBalances() {
    const balances = await _balances();
    store.put(`${PAIR_1.toLocaleLowerCase()}_balance`, parseFloat(balances[PAIR_1].available));
    store.put(`${PAIR_2.toLocaleLowerCase()}_balance`, parseFloat(balances[PAIR_2].available));
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
        `Global profits: ${parseFloat(store.get('profits')).toFixed(4)} ${PAIR_2}`);
    
    const pair1Balance = parseFloat(store.get(`${PAIR_1.toLocaleLowerCase()}_balance`));
    const pair2Balance = parseFloat(store.get(`${PAIR_2.toLocaleLowerCase()}_balance`));

    const initialBalance = parseFloat(store.get(`initial_${PAIR_2.toLocaleLowerCase()}_balance`));
    logColor(colors.gray, 
        `Balances: ${pair1Balance} ${PAIR_1} | ${pair2Balance.toFixed(2)} ${PAIR_2}, Current: ${parseFloat(pair1Balance * price + pair2Balance)} ${PAIR_2}, Initial: ${initialBalance.toFixed(2)} ${PAIR_2}`);
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

        const res = await binance.marketBuy(PAIR, order.amount);
        if(res && res.status === 'FILLED') {
            order.status = 'bought';
            order.id = res.orderId;
            order.buy_price = parseFloat(res.fills[0].price);

            orders.push(order);
            store.put('start_price', order.buy_price);
            await _updateBalances();

            logColor(colors.green, '======================================================');
            logColor(colors.green, `Bought: ${BUY_ORDER_AMOUT} ${PAIR_1} for ${parseFloat(BUY_ORDER_AMOUT * price).toFixed(2)} ${PAIR_2}, Price: ${order.buy_price}\n`);
            logColor(colors.green, '======================================================');

            await _calculateProfits();

            telegramBot.sendMessage('1062229382', `Hey! I am buying ${BUY_ORDER_AMOUT} ${PAIR_1} for ${parseFloat(BUY_ORDER_AMOUT * price).toFixed(2)} ${PAIR_2}, Price: ${order.buy_price}`)
        } else newPriceReset(2, BUY_ORDER_AMOUT * price, price);
    } else {
        logColor(colors.gray, 'You do not have the sufficient balance for this trade');
        newPriceReset(2, BUY_ORDER_AMOUT * price, price);
    }
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
            
            const res = await binance.marketSell(PAIR, totalAmount);
            if (res && res.status === 'FILLED') {
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

                logColor(colors.red, '=====================================================================');
                logColor(colors.red, `Sold: ${totalAmount} ${PAIR_1} for ${parseFloat(totalAmount * _price).toFixed(2)} ${PAIR_2}, Price ${_price}\n`);
                logColor(colors.red, '=====================================================================');

                await _calculateProfits();

                let i = orders.length;
                while(i--) {    
                    if(orders[i].status === 'sold') {
                        orders.splice(i, 1);
                    }
                }

                telegramBot.sendMessage('1062229382', `Hey! I am selling ${totalAmount} ${PAIR_1} for ${parseFloat(totalAmount * _price).toFixed(2)} ${PAIR_2}, Price: ${_price}`)

            } else store.put('start_price', price);
        } else store.put('start_price', price);
    } else store.put('start_price', price);

}

async function listenPrice() {
    while (true) {
        try {
            let binancePrice = parseFloat((await binance.prices(PAIR))[PAIR]);

            if (binancePrice) {
                const startPrice = store.get('start_price');
                const marketPrice = binancePrice;

                console.clear();
                log('========================================================================================');
                _logProfits(marketPrice);
                log('========================================================================================');

                log(`Prev Price: ${startPrice}`);
                log(`New Price: ${marketPrice}`);

                if (marketPrice > startPrice) {
                    let factor = (marketPrice - startPrice);
                    let percent = 100 * factor / marketPrice;

                    logColor(colors.green, `Up: +${parseFloat(percent).toFixed(3)}% ==> +$${parseFloat(factor).toFixed(4)}`);
                    store.put('percent', `+${parseFloat(percent).toFixed(3)}`)

                    if (percent >= process.env.PRICE_PERCENT) {
                        await _sell(marketPrice);
                    }

                } else if (marketPrice < startPrice) {
                    let factor = (startPrice - marketPrice);
                    let percent = 100 * factor / startPrice;

                    logColor(colors.red, `Down: -${parseFloat(percent).toFixed(3)}% ==> -$${parseFloat(factor).toFixed(4)}`);
                    store.put('percent', `-${parseFloat(percent).toFixed(3)}`)

                    if (percent >= process.env.PRICE_PERCENT) {
                        await _buy(marketPrice, BUY_ORDER_AMOUT);
                    }
                } else {
                    logColor(colors.gray, 'Change: 0.000% ==> $0.0000');
                    store.put('percent', '0.000');
                }
            }
        } catch (error) {
            // console.log('error: ', error);
            telegramBot.sendMessage('1062229382', `Hey! Something went wrong with the bot`);
        }
        await sleep(process.env.SLEEP_TIME);
    }
}

async function init() {
    if (process.argv[5] !== 'resume') {
        const price = await binance.prices(PAIR);
        store.put('start_price', parseFloat(price[PAIR]));
        store.put('orders', []);
        store.put('profits', 0);
        const balances = await _balances();
        store.put(`${PAIR_1.toLocaleLowerCase()}_balance`, parseFloat(balances[PAIR_1].available));
        store.put(`${PAIR_2.toLocaleLowerCase()}_balance`, parseFloat(balances[PAIR_2].available));
        store.put(`initial_${PAIR_1.toLocaleLowerCase()}_balance`, store.get(`${PAIR_1.toLocaleLowerCase()}_balance`));
        store.put(`initial_${PAIR_2.toLocaleLowerCase()}_balance`, store.get(`${PAIR_2.toLocaleLowerCase()}_balance`));
    } 

    listenPrice();
}

init();