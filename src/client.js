import debugFactory from 'debug';
let debug = debugFactory('node::client');

import {events} from './enum'
import ActorModel from './actor'
import {Dealer as DealerSocket} from './sockets'

let _private = new WeakMap();

let INTERVAL_CLIENT_PING = 2000;

export default class Client extends DealerSocket {
    constructor() {
        super();
        let _scope = {
            server : null,
            pingInterval : null
        };

        debug(`Client ${this.getId()} started`);
        _private.set(this, _scope);
    }

    getServerActor() {
        return _private.get(this).server;
    }

    // ** returns a promise which resolves with server model after server replies to events.CLIENT_CONNECTED
    async connect(serverAddress, {data, response}) {
        let connectData = { actor : this.getId()};
        if(data) {
            connectData.data = data;
        }

        if(response) {
            connectData.response = response;
        }

        let _scope = _private.get(this);
        await super.connect(serverAddress);
        let connectResponse = await this.request(events.CLIENT_CONNECTED, connectData);
        // ** creating server model and setting it online
        let actorModel = new ActorModel( {id: connectResponse.actor} );
        actorModel.setAddress(serverAddress);
        actorModel.setOnline();
        actorModel.setData(connectResponse.response);
        _scope.server = actorModel;
        this::_startServerPinging();
        return actorModel;
    }

    async disconnect(data) {
        let disconnectData = { actor : this.getId()};
        if(data) {
            disconnectData.data = data;
        }
        let _scope = _private.get(this);
        let response = await this.request(events.CLIENT_STOP, disconnectData);
        this::_stopServerPinging();
        await super.disconnect();
        let serverId = _scope.server ? _scope.server.getId() : null;
        _scope.server = null;
        return serverId;
    }
}

function _startServerPinging(){
    let context = this;
    let _scope = _private.get(context);

    if(_scope.pingInterval) {
        clearInterval(_scope.pingInterval);
    }

    _scope.pingInterval = setInterval(async ()=> {
        let pingRequest = { actor: context.getId(), stamp : Date.now()};
        let pingResponse = await context.request(events.CLIENT_PING, pingRequest);
        if(_scope.server) {
            _scope.server.ping(pingResponse);
        }
    } , INTERVAL_CLIENT_PING);
}

function _stopServerPinging() {
    let context = this;
    let _scope = _private.get(context);

    if(_scope.pingInterval) {
        clearInterval(_scope.pingInterval);
    }
}