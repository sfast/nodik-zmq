/**
 * Created by artak on 3/2/17.
 */
import debugFactory from 'debug';
let debug = debugFactory('node::sockets::dealer');

import zmq from 'zmq'
import Promise from 'bluebird'

import  Socket from './socket'
import { EnvelopType } from './enum'

let _private = new WeakMap();

export default class DealerSocket extends Socket {
    constructor() {
        let socket =  zmq.socket('dealer');
        super(socket);

        let _scope = {};
        _scope.socket = socket;
        _scope.socket.on(EnvelopType.SYNC , _syncEnvelopeHandler.bind(this));
        _scope.socket.on(EnvelopType.ASYNC , _asyncEnvelopeHandler.bind(this));
        _scope.routerAddress = null;
        _private.set(this, _scope);
    }

    getAddress() {
        let _scope = _private.get(this);
        return _scope.routerAddress;
    }

    setAddress(routerAddress) {
        let _scope = _private.get(this);
        if (typeof routerAddress == 'string' && routerAddress.length) {
            _scope.routerAddress = routerAddress;
        }
    }

    // ** not actually connected
    connect(routerAddress) {
        return new Promise((resolve, reject) => {
            let _scope = _private.get(this);

            if(this.isOnline()) {
                return resolve('dealer - already online');
            }

            if(routerAddress) {
                this.setAddress(routerAddress);
            }

            _scope.socket.connect(this.getAddress());
            this.setOnline();
            resolve(`dealer - trying connect ${routerAddress}`);
        });
    }

    // ** not actually disconnected
    disconnect() {
        let _scope = _private.get(this);
        new Promise((resolve, reject) => {
            let routerAddress = _scope.routerAddress;
            if (!this.isOnline()) {
                return resolve('dealer - already offline');
            }

            setImmediate(() => {
                try {
                        _scope.socket.removeAllListeners('message');
                        _scope.socket.disconnect(routerAddress);
                         let routerAddress = _scope.routerAddress;
                        _scope.routerAddress = null;
                        this.setOffline();
                        resolve(`dealer - disconnecting ${routerAddress}`);
                } catch(err) {
                    reject(err);
                }
            });
        });
    }

    request(event, data, timeout = 5000) {
        return super.request(event, data, timeout)
            .then(({envelop, request }) => {
                let _scope = _private.get(this);
                _scope.socket.send(envelop.getBuffer());
                return request;
            });
    }

    tick(event, data) {
        let _scope = _private.get(this);
        return super.tick(event, data)
            .then((envelop) => {
                _scope.socket.send(envelop.getBuffer());
                return true;
            });
    }
}

function _asyncEnvelopeHandler(envelop) {
    let eventName = envelop.getTag();
    this.emit(eventName, envelop.getData());
}

function _syncEnvelopeHandler(envelop) {
    let _scope = _private.get(this);

    let request = {
        body: envelop.getData(),
        reply : function(data) {
            envelop.setType(EnvelopType.RESPONSE);
            envelop.setData(data);
            _scope.socket.send(envelop.getBuffer());
        }
    };

    let eventName = "request-" + envelop.getTag();
    this.emit(eventName, request);
}