import Promise from 'bluebird'
import Node from '../src/node'

const MESSAGE_COUNT = 5000;

let runner = new Node({ bind: 'tcp://127.0.0.1:6000', layer: 'R'});

let layerA = new Node({ bind: 'tcp://127.0.0.1:6001', layer: 'A'});
let layerB = new Node({ bind: 'tcp://127.0.0.1:6002', layer: 'B'});
let layerC = new Node({ bind: 'tcp://127.0.0.1:6003', layer : 'C' });

let errPrint = (err) => {console.log("error" , err)};

let all = [];

all.push(runner.bind());
all.push(layerA.bind());
all.push(layerB.bind());
all.push(layerC.bind());

let start = null;


let runnerbomb = null;

let _clearIntervals = () => {
    layerA.offTick();
    layerB.offTick();
    layerC.offTick();
    runner.offTick();
};

let run = async () => {
    try {
        console.log("RUN");

        let i = 0;

        await Promise.all(all);
        console.log("All nodes are binded");
        await layerA.connect(layerB.getAddress());
        console.log("Layer A connected to B");
        await layerB.connect(layerC.getAddress());
        console.log("Layer B connected C");
        await layerC.connect(layerA.getAddress());
        console.log("Layer C connected to A");

        await runner.connect(layerA.getAddress());
        console.log("Runner connected to A");

        layerA.onTick("WELCOME", (data) => {
            i++;
            console.log("A", data);
            if (i > MESSAGE_COUNT) {
                _clearIntervals();
                console.log(`Time passed: `, Date.now() - start);
            } else {
                layerA.tick(layerB.getId(), "WELCOME", data + 1);
            }
        });

        layerB.onTick("WELCOME", (data) => {
            console.log("B", data);
            layerB.tick(layerC.getId(), "WELCOME", data + 1);
        });

        layerC.onTick("WELCOME", (data) => {
            console.log("C", data);
            layerC.tick(layerA.getId(), "WELCOME", data + 1);
        });

        start = Date.now();
        runner.tick(layerA.getId(), "WELCOME", 1).catch(errPrint);
    } catch (err) {
        console.log(err);
    }
}

run();