import debugFactory from 'debug';
let debug = debugFactory('node::sockets::socket');

import _ from 'underscore';
import crypto from 'crypto'
import { EventEmitter } from 'events'

import Envelop from './envelope'
import { EnvelopType } from './enum'

let _private = new WeakMap();

class SocketIsNotOnline extends Error {
    constructor({socketId, error}) {
        super(error.message, error.lineNumber, error.fileName);
        this.socketId = socketId;
    }
}


export default class Socket extends EventEmitter {
    constructor (socket) {
        super();
        let _scope = {};
        let randomId = crypto.randomBytes(20).toString("hex");
        socket.identity = randomId;

        _scope.id = randomId;
        _scope.socket = socket;
        _scope.online = false;
        _scope.requests = new Map();
        _scope.socket.on("message" , this::onSocketMessage);
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

    async request(envelop, reqTimeout) {
        let _scope = _private.get(this);
        if(!this.isOnline()) {
            let err = new Error(`Sending failed as socket ${this.getId()} is not online`);
            throw new SocketIsNotOnline({socketId : _scope.id, error: err });
        }

        let envelopId = envelop.getId();
        let timeout = null;

        return new Promise((resolve, reject) => {
            if(reqTimeout) {
                timeout = setTimeout(() => {
                    if(_scope.requests.has(envelopId)) {
                        _scope.requests.delete(envelopId);
                        reject(`Request ${envelopId} timeouted on socket ${this.getId()}`);
                    }
                }, reqTimeout);
            }

            _scope.requests.set(envelopId, {resolve : resolve, reject: reject, timeout : timeout});
           this.sendEnvelop(envelop);
        });
    }

    async tick(envelop) {
        let _scope = _private.get(this);
        if (!this.isOnline()) {
            let err = new Error(`Sending failed as socket ${this.getId()} is not online`);
            throw new SocketIsNotOnline({socketId: _scope.id, error: err});
        }

        this.sendEnvelop(envelop);
        return Promise.resolve();
    }

    sendEnvelop(envelop) {
        let _scope = _private.get(this);
        _scope.socket.send(this.getSocketMsg(envelop));
    }

    async close(cleanup){
        if (!this.isOnline()) {
            return true;
        }

        let _scope = _private.get(this);
        _scope.socket.removeAllListeners('message');

        new Promise((resolve, reject) => {
            setImmediate(() => {
                try {
                    // ** closeSocket is overrided under dealer and router
                    cleanup();
                    this.setOffline();
                    resolve("router - unbinded");
                } catch(err) {
                    debug(err);
                    reject(err);
                }
            });
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

//** Handlers of specific envelop msg-es

//** when socket is dealer identity is empty
//** when socket is router identity is the dealer which sends data
function onSocketMessage(empty, envelopBuffer) {
    let context = this;
    let _scope = _private.get(context);

    let {type, id, owner, tag} = Envelop.readMetaFromBuffer(envelopBuffer);
    let envelop = new Envelop({type, id, owner, tag});
    let envelopData = Envelop.readDataFromBuffer(envelopBuffer);

    switch (type) {
        case EnvelopType.ASYNC:
            context.emit(tag, envelopData);
        case EnvelopType.SYNC:
            context::syncEnvelopHandler(envelop, envelopData);
            break;
        case EnvelopType.RESPONSE:
            context::responseEnvelopHandler(envelop, envelopData);
            break;
    }
}

function syncEnvelopHandler(envelop, envelopData) {
    let context = this;
    envelop.setData(envelopData);
    let request = {
        body: envelopData,
        reply : (data) => {
            envelop.setType(EnvelopType.RESPONSE);
            envelop.setData(data);
            context.sendEnvelop(envelop);
        }
    };

    let eventName = "request-" + envelop.getTag();
    context.emit(eventName, request);
}

function responseEnvelopHandler(envelop, envelopData) {
    let context = this;
    let _scope = _private.get(context);
    let id = envelop.getId();
    if(_scope.requests.has(id)) {
        //** requestObj is like {resolve, reject, timeout : clearRequestTimeout}
        let requestObj = _scope.requests.get(id);
        clearTimeout(requestObj.timeout);
        //** resolving request promise with response data
        requestObj.resolve(envelopData);
        _scope.requests.delete(id);
    }
    else {
        debug(`Response ${id} is probably time outed`);
    }
}