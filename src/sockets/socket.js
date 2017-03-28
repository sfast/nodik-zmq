import debugFactory from 'debug';
let debug = debugFactory('node::sockets::socket');

import crypto from 'crypto'
import { EventEmitter } from 'events'

import Envelop from './envelope'
import { EnvelopType } from './enum'

let _private = new WeakMap();

export default class Socket extends EventEmitter {
    constructor (socket) {
        super();
        let _scope = {};
        let randomId = crypto.randomBytes(20).toString("hex");
        _scope.id = randomId;
        _scope.socket = socket;
        _scope.socket.identity = _scope.id;
        _scope.online = false;
        _scope.requests = new Map();
        _scope.socket.on("message" , _onSocketMessage.bind(this));
        _scope.cache = new Map();
        _private.set(this, _scope);
    }

    getId() {
        let _scope = _private.get(this);
        return _scope.id;
    }

    setItem(key, value) {
        let _scope = _private.get(this);
        _scope.cache.set(key, value);
    }

    getItem(key) {
        let _scope = _private.get(this);
        return _scope.cache.get(key);
    }

    setOnline() {
        let _scope = _private.get(this);
        _scope.online = true;
    }

    setOffline() {
        let _scope = _private.get(this);
        _scope.online = false;
    }

    isOnline(){
        let _scope = _private.get(this);
        return _scope.online;
    }

    request(event, data, timeout = 5000) {
        return new Promise((resolve, reject) => {
            let _scope = _private.get(this);

            if(!this.isOnline()) {
                // ** how to handle it ?
                debug(`Sending failed as socket ${this.getId()} is not online`);
                return reject(`Sending failed as socket ${this.getId()} is not online`);
            }

            let envelop = new Envelop({type: EnvelopType.SYNC, tag : event, data : data , owner : this.getId()});
            let envelopId = envelop.getId();
            let clearRequestTimeout = null;

            let requestPromise = new Promise((resolveRequest, rejectRequest) => {
                if(timeout) {
                    clearRequestTimeout = setTimeout(() => {

                        if(_scope.requests.has(envelopId)) {
                            _scope.requests.delete(envelopId);
                            rejectRequest(`Request ${envelopId} timeout`);
                        }
                    }, timeout);
                }

                _scope.requests.set(envelopId, {resolve : resolveRequest, reject: rejectRequest, timeout : clearRequestTimeout});
            });

            resolve({ envelop, request: requestPromise });
        });
    }

    tick(event, data) {
        return new Promise((resolve, reject) => {
            if(!this.isOnline()) {
                // ** how to handle it ?
                console.error(`Sending failed as socket ${this.getId()} is not online`);
                return reject(`Sending failed as socket ${this.getId()} is not online`);
            }
            let envelop = new Envelop({type: EnvelopType.ASYNC, tag: event, data : data, owner : this.getId() });
            resolve(envelop);
        });
    }

    onRequest(endpoint, fn) {
        // ** function will called with argument  request = {body, reply}
        this.on("request-" + endpoint, fn);
    }

    offRequest(endpoint, fn){
        let eventName = "request-" + endpoint;

        if(_.isFunction(fn)) {
            this.removeEventListener(eventName, fn);
            return;
        }

        this.removeAllListeners(eventName);
    }

    onTick(event, fn) {
        this.on(event, fn);
    }

    offTick(event, fn) {
        if(_.isFunction(fn)) {
            this.removeEventListener(event, fn);
            return;
        }

        this.removeAllListeners(event);
    }
}


// ** when socket is dealer identity is empty
// ** when socket is router identity is the dealer which sends data
function _onSocketMessage(empty, envelopBuffer) {
    let _scope = _private.get(this);

    let {type, id, owner, tag} = Envelop.readMetaFromBuffer(envelopBuffer);
    let envelop = new Envelop({type, id, owner, tag});

    switch (type) {
        case EnvelopType.ASYNC:
        case EnvelopType.SYNC:
            envelop.setData(Envelop.readDataFromBuffer(envelopBuffer));
            _scope.socket.emit(type, envelop);
            break;
        case EnvelopType.RESPONSE:
            if(_scope.requests.has(id)) {
                //  ** requestObj is like {resolve, reject, timeout : clearRequestTimeout}
                let requestObj = _scope.requests.get(id);
                clearTimeout(requestObj.timeout);
                // ** resolving request promise with response data
                requestObj.resolve(Envelop.readDataFromBuffer(envelopBuffer));
                _scope.requests.delete(id);
            }
            else {
                console.error(`Response ${id} is probably time outed`);
            }
            break;
    }
}