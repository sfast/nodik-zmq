/**
 * Created by artak on 3/2/17.
 */
import debugFactory from 'debug';
let debug = debugFactory('node::sockets::dealer');

import zmq from 'zmq'

import  Socket from './socket'
import Envelop from './envelope'
import { EnvelopType } from './enum'

let _private = new WeakMap();

export default class DealerSocket extends Socket {
    constructor({id}) {
        let socket =  zmq.socket('dealer');
        super({id, socket});

        let _scope = {};
        _scope.socket = socket;
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
        let _scope = _private.get(this);

        if(this.isOnline()) {
            return true;
        }

        if(routerAddress) {
            this.setAddress(routerAddress);
        }

        _scope.socket.connect(this.getAddress());
        this.setOnline();
    }

    // ** not actually disconnected
    disconnect() {
        this.close();
    }

    //** Polymorfic Functions
    async request(event, data, timeout = 5000) {
        let envelop = new Envelop({type: EnvelopType.SYNC, tag : event, data : data , owner : this.getId()});
        return super.request(envelop, timeout);
    }

    async tick(event, data) {
        let envelop = new Envelop({type: EnvelopType.ASYNC, tag: event, data: data, owner: this.getId()});
        return super.tick(envelop);
    }

    close () {
        super.close();
        let _scope = _private.get(this);
        _scope.socket.disconnect(_scope.routerAddress);
        _scope.routerAddress = null;
        this.setOffline();
    }

    getSocketMsg(envelop) {
        return  envelop.getBuffer();
    }
}