import Promise from 'bluebird'
import {Node} from '../index'

const MESSAGE_COUNT = 1000;
const SETINTERVAL_COUNT = 100;
const SETINTERVAL_TIME = 100;

let dns = new Node({ bind: 'tcp://127.0.0.1:6000', layer : 'DNS' });

let layerA = new Node({ bind: 'tcp://127.0.0.1:6001', layer: 'A'});
let layerB = new Node({ bind: 'tcp://127.0.0.1:6002', layer: 'B'});

let errPrint = (err) => {console.log("error" , err)};

let all = [];

all.push(dns.bind());
all.push(layerA.bind());
all.push(layerB.bind());

let _intervals = [];

let _clearIntervals = () => {
    _intervals.forEach((tickIntervalItem) => {
        clearInterval(tickIntervalItem);
    });
}

let start = null;

let tickWithInterval = (t) => {
    let intervalCleaner = setInterval(()=>{
        if(!start) {
            start = Date.now();
        }
        layerA.tick(dns.getId(), "WELCOME", {node : layerA.getId(), name : "layerA"}).catch(errPrint);
        layerB.tick(dns.getId(), "WELCOME", {node : layerB.getId(), name : "layerB"}).catch(errPrint);
    }, t);

    _intervals.push(intervalCleaner);
};

let run = async () => {
    console.log("RUN");

    let i = 0;

    await Promise.all(all);
    console.log("All nodes are binded");
    await layerA.connect(dns.getAddress());
    console.log("Layer A connected");
    await layerB.connect(dns.getAddress());
    console.log("Layer B connected");

    dns.onTick("WELCOME", (data) => {
        i++;
        if(i == MESSAGE_COUNT) {
            _clearIntervals();
            console.log(`Time passed: ` , Date.now() - start);
        }
    });

    for(let j = 0; j < SETINTERVAL_COUNT; j++) {
        tickWithInterval(SETINTERVAL_TIME);
    }
};

run();