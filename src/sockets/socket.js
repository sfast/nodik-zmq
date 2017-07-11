import debugFactory from 'debug';
let debug = debugFactory('node::sockets::socket');

import _ from 'underscore';
import animal from 'animal-id';
import EventEmitter from 'pattern-emitter'

import Envelop from './envelope'
import { EnvelopType } from './enum'
import { RequestWatcher} from './watchers'

let _private = new WeakMap();

class SocketIsNotOnline extends Error {
    constructor({socketId, error}) {
        super(error.message, error.lineNumber, error.fileName);
        this.socketId = socketId;
    }
}


export default class Socket extends EventEmitter {
    constructor ({id, socket}) {
        super();
        let _scope = {};
        let socketId = id || Socket.generateSocketId();
        socket.identity = socketId;

        _scope.id = socketId;
        _scope.socket = socket;
        _scope.online = false;
        _scope.requests = new Map();
        _scope.requestWatcherMap = new Map();
        _scope.tickEmitter = new EventEmitter();
        _scope.socket.on('message', this::onSocketMessage);
        _scope.options = {};
        _private.set(this, _scope);
    }

    getId() {
        let _scope = _private.get(this);
        return _scope.id;
    }

    static generateSocketId() {
        return animal.getId()
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

    setOptions(options) {
        let _scope = _private.get(this);
        _scope.options = options;
    }

    getOptions() {
        let _scope = _private.get(this);
        return _scope.options;
    }

    async request(envelop, reqTimeout = 5000) {
        let _scope = _private.get(this);
        if(!this.isOnline()) {
            let err = new Error(`Sending failed as socket ${this.getId()} is not online`);
            throw new SocketIsNotOnline({socketId : _scope.id, error: err });
        }

        let envelopId = envelop.getId();
        let timeout = null;

        return new Promise((resolve, reject) => {
            timeout = setTimeout(() => {
                if(_scope.requests.has(envelopId)) {
                    let requestObj = _scope.requests.get(envelopId);
                    _scope.requests.delete(envelopId);
                    requestObj.reject(`Request ${envelopId} timeouted on socket ${this.getId()}`);
                }
            }, reqTimeout);

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

    close(){
        let _scope = _private.get(this);
        _scope.socket.removeAllListeners('message');
    }

    onRequest(endpoint, fn) {
        // ** function will called with argument  request = {body, reply}
        let _scope = _private.get(this);
        let requestWatcher = _scope.requestWatcherMap.get(endpoint);

        if(!requestWatcher) {
            requestWatcher = new RequestWatcher(endpoint);
            _scope.requestWatcherMap.set(endpoint, requestWatcher);
        }
        if (typeof fn == 'function') {
            requestWatcher.addRequestListener(fn);
        }
    }

    offRequest(endpoint, fn){
        let _scope = _private.get(this);
        if(_.isFunction(fn)) {
            let endpointWatcher = _scope.requestWatcherMap.get(endpoint);
            if (!endpointWatcher) return;
            endpointWatcher.removeFn(fn)
            return;
        }

        _scope.requestWatcherMap.delete(endpoint);
    }

    onTick(event, fn) {
        let _scope = _private.get(this);
        _scope.tickEmitter.on(event, fn);
    }

    offTick(event, fn) {
        let _scope = _private.get(this);
        if(_.isFunction(fn)) {
            _scope.tickEmitter.removeListener(event, fn);
            return;
        }

        _scope.tickEmitter.removeAllListeners(event);
    }
}

//** Handlers of specific envelop msg-es

//** when socket is dealer identity is empty
//** when socket is router, identity is the dealer which sends data
function onSocketMessage(empty, envelopBuffer) {
    let _scope = _private.get(this);
    let {type, id, owner, recipient, tag} = Envelop.readMetaFromBuffer(envelopBuffer);
    let envelop = new Envelop({type, id, owner, recipient, tag});
    let envelopData = Envelop.readDataFromBuffer(envelopBuffer);

    switch (type) {
        case EnvelopType.ASYNC:
            _scope.tickEmitter.emit(tag, envelopData);
            break;
        case EnvelopType.SYNC:
            envelop.setData(envelopData);
            this::syncEnvelopHandler(envelop);
            break;
        case EnvelopType.RESPONSE:
            envelop.setData(envelopData);
            this::responseEnvelopHandler(envelop);
            break;
    }
}

function syncEnvelopHandler(envelop) {
    let self = this;
    let _scope = _private.get(this);

    let prevOwner = envelop.getOwner();
    let handlers = [];
    for (let endpoint of _scope.requestWatcherMap.keys()) {
        if (endpoint instanceof RegExp){
            if (endpoint.test(envelop.getTag())) {
                handlers = handlers.concat([..._scope.requestWatcherMap.get(endpoint).getFnSet()])
            }
        } else if(endpoint == envelop.getTag()) {
            handlers = handlers.concat([..._scope.requestWatcherMap.get(endpoint).getFnSet()]);
        }
    }
    let request = {
        body: envelop.getData(),
        reply : (data) => {
            envelop.setRecipient(prevOwner);
            envelop.setOwner(this.getId());
            envelop.setType(EnvelopType.RESPONSE);
            envelop.setData(data);
            self.sendEnvelop(envelop);
        },
        next: (data) => {
            if (!handlers.length) {
                return this.reply(data);
            }
            this.body = data;
            handlers.pop()(this);
        }
    };
    if (handlers.length) {
        handlers.pop()(request);
    }
}

function responseEnvelopHandler(envelop) {
    let _scope = _private.get(this);

    let id = envelop.getId();
    if(_scope.requests.has(id)) {
        //** requestObj is like {resolve, reject, timeout : clearRequestTimeout}
        let requestObj = _scope.requests.get(id);
        clearTimeout(requestObj.timeout);
        //** resolving request promise with response data
        requestObj.resolve(envelop.getData());
        _scope.requests.delete(id);
    }
    else {
        debug(`Response ${id} is probably time outed`);
    }
}