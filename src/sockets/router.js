/**
 * Created by artak on 3/2/17.
 */

import debugFactory from 'debug';
let debug = debugFactory('node::sockets::router');

import zmq from 'zmq'
import Promise from 'bluebird'

import  Socket  from './socket'
import {EnvelopType} from './enum'

let _private = new WeakMap();

export default class RouterSocket extends Socket {
    constructor() {
        let socket = zmq.socket('router');
        super(socket);

        let _scope = {};
        _scope.socket = socket;
        _scope.socket.on(EnvelopType.SYNC , _syncEnvelopeHandler.bind(this));
        _scope.socket.on(EnvelopType.ASYNC , _asyncEnvelopeHandler.bind(this));
        _scope.bindAddress = null;
        _private.set(this, _scope);
    }

    getAddress() {
        let _scope = _private.get(this);
        return _scope.bindAddress;
    }

    setAddress(bindAddress) {
        let _scope = _private.get(this);
        if (typeof bindAddress == 'string' && bindAddress.length) {
            _scope.bindAddress = bindAddress;
        }
    }

    // ** binded promise returns status
    bind(bindAddress) {
        return new Promise((resolve, reject) => {
            let _scope = _private.get(this);

            if(this.isOnline()) {
                return resolve('router - already online');
            }

            if(bindAddress) {
                this.setAddress(bindAddress);
            }

            return _scope.socket.bind(this.getAddress(), (err) => {
                if (err) {
                    console.error(err);
                    return reject(err);
                }

                this.setOnline();
                resolve('router - is online');
            });
        });
    }

    // ** returns status
    unbind() {
        let _scope = _private.get(this);
        new Promise((resolve, reject) => {
            if (!this.isOnline()) {
                return resolve(true);
            }

            setImmediate(() => {
                try
                {
                    _scope.socket.removeAllListeners('message');
                    _scope.socket.unbindSync(_scope.bindAddress);
                    _scope.bindAddress = null;
                    this.setOffline();
                    resolve("router - unbinded");

                } catch(err) {
                    console.error(err);
                    reject(err);
                }
            });
        });
    }

    request(to, event, data, timeout = 5000) {
        return super.request(event, data, timeout)
            .then(({envelop, request }) => {
                let _scope = _private.get(this);
                let toBuffer = Buffer.isBuffer(to) ? to : new Buffer(to);
                _scope.socket.send([toBuffer, '', envelop.getBuffer()]);
                return request;
            });
    }

    tick(to, event, data) {
        let _scope = _private.get(this);
        return super.tick(event, data)
            .then((envelop) => {
                let toBuffer = Buffer.isBuffer(to) ? to : new Buffer(to);
                _scope.socket.send([toBuffer, '', envelop.getBuffer()]);
                return true;
            });
    }

    proxyTick(event, to) {

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
            _scope.socket.send([envelop.getOwner(), '', envelop.getBuffer()]);
        }
    };

    let eventName = "request-" + envelop.getTag();
    this.emit(eventName, request);
}