import Promise from 'bluebird'
import {Node} from '../index'

const MESSAGE_COUNT = 10000;
const SETINTERVAL_COUNT = 1000;
const SETINTERVAL_TIME = 50;

let dns = new Node({ bind: 'tcp://127.0.0.1:6000', layer : 'DNS' });

let layerA = new Node({ bind: 'tcp://127.0.0.1:6001', layer: 'A'});
let layerB = new Node({ bind: 'tcp://127.0.0.1:6002', layer: 'B'});

let errPrint = (err) => {console.log("error" , err)};

let all = [];

all.push(dns.bind());
all.push(layerA.bind());
all.push(layerB.bind());

let _intervals = [];

function _clearIntervals() {
    _intervals.forEach((tickIntervalItem) => {
        clearInterval(tickIntervalItem);
    });
}

let start = null;

function tickWithInterval (t) {
    let intervalCleaner = setInterval(()=>{
        if(!start) {
            start = Date.now();
        }
        layerA.tick(dns.getId(), "WELCOME", {node : layerA.getId(), name : "layerA"}).catch(errPrint);
        layerB.tick(dns.getId(), "WELCOME", {node : layerB.getId(), name : "layerB"}).catch(errPrint);
    }, t);

    _intervals.push(intervalCleaner);
}

Promise.all(all)
    .then(() => {
        return layerA.connect(dns.getAddress());
    })
    .then(() => {
        return layerB.connect(dns.getAddress())
    })
    .then(() => {
        let i = 0;


        dns.onTick("WELCOME", function(data) {
            i++;

            if(i == MESSAGE_COUNT) {
                _clearIntervals();
                console.log(`Time passed: ` , Date.now() - start);
            }
        });

        for(let j = 0; j < SETINTERVAL_COUNT; j++) {
            tickWithInterval(SETINTERVAL_TIME);
        }
    });