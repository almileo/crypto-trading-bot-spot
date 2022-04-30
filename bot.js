require('dotenv').config();
const Storage = require('node-storage');
const { colors, log, logColor } = require('./utils/logger');
const binance = require('./service/binance');

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
        `Global profits: ${parseFloat(store.get('profits')).toFixed(3)} ${PAIR_2}`);
    
    const pair1Balance = parseFloat(store.get(`${PAIR_1.toLocaleLowerCase()}_balance`));
    const pair2Balance = parseFloat(store.get(`${PAIR_2.toLocaleLowerCase()}_balance`));

    const initialBalance = parseFloat(store.get(`initial_${PAIR_2.toLocaleLowerCase()}_balance`));
    logColor(colors.gray, 
        `Balances: ${PAIR_1} ${pair2Balance.toFixed(2)} ${PAIR_2}, Current: ${parseFloat(pair1Balance * price + pair2Balance)} ${PAIR_2}, Initial: ${initialBalance.toFixed(2)} ${PAIR_2}`);
}
